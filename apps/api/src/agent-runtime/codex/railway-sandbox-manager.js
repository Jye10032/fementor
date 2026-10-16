const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { AgentRuntimeError } = require('../contracts');
const { CODEX_VERSION, buildCodexConfig } = require('./config');
const { withAbort } = require('./abort');

const AGENT_PREFIX = 'unshare --net --pid --fork --mount-proc --kill-child=SIGKILL /bin/sh /capabilities/network-entrypoint.sh';
const BOOTSTRAP = `set -eu
test "$(id -u)" = 0
command -v setpriv >/dev/null
command -v unshare >/dev/null
command -v nsenter >/dev/null
command -v ip >/dev/null
useradd --user-group --no-create-home --home-dir /work/home --shell /usr/sbin/nologin fementor
mkdir -p /input /capabilities /work/home/.codex /opt/fementor
npm install --global --prefix /opt/fementor --no-audit --no-fund @openai/codex@${CODEX_VERSION}
# Railway's base image resolves Node through mise; copy the actual executable,
# not its root-user shim, into the unprivileged process's allowlisted PATH.
install -m 0755 "$(node -p 'process.execPath')" /opt/fementor/bin/node
/opt/fementor/bin/codex --version
`;
const LOCKDOWN = `set -eu
chown -R root:root /input /capabilities /opt/fementor
chmod -R a+rX /input /capabilities /opt/fementor
chmod -R a-w /input /capabilities /opt/fementor
chown -R fementor:fementor /work
${AGENT_PREFIX} probe
`;

class RailwaySandboxManager {
  constructor({ config, onLifecycle = () => {}, Sandbox, fetchImpl = fetch }) {
    Object.assign(this, { config, onLifecycle, Sandbox, fetchImpl });
    this.sandbox = null;
    this.sandboxId = null;
    this.cleanupState = 'not_created';
  }

  async sdk() {
    if (!this.Sandbox) this.Sandbox = (await import('railway')).Sandbox;
    return this.Sandbox;
  }

  options(signal) {
    return {
      token: this.config.railwayToken,
      authType: 'bearer',
      environmentId: this.config.environmentId,
      verbose: false,
      fetch: async (url, init) => {
        const response = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]),
        });
        // Persist ownership as soon as create is acknowledged, before SDK boot
        // polling; even a later startup failure must be recoverable by ID.
        const data = await response.clone().json().catch(() => null);
        if (data?.data?.sandboxCreate?.id) {
          this.sandboxId = data.data.sandboxCreate.id;
          this.cleanupState = 'pending';
          this.onLifecycle({ state: 'created', sandboxId: this.sandboxId });
        }
        return response;
      },
    };
  }

  async prepare(bundle, signal) {
    const Sandbox = await this.sdk();
    if (signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Sandbox setup was cancelled');
    this.cleanupState = 'create_unknown';
    let dispatched = false;
    try {
      this.onLifecycle({ state: 'creating' });
      this.sandbox = await withAbort(() => {
        dispatched = true;
        return Sandbox.create({
          ...this.options(signal), networkIsolation: 'ISOLATED',
          resources: { cpu: 1, memoryGB: 2 }, idleTimeoutMinutes: 5, env: {}, domains: [],
        });
      }, signal);
    } catch (error) {
      if (!dispatched) {
        this.cleanupState = 'not_created';
        try { this.onLifecycle({ state: 'not_created' }); } catch { /* No remote resource exists. */ }
      }
      throw error;
    }
    this.sandboxId = this.sandbox.id;
    this.cleanupState = 'pending';
    this.onLifecycle({ state: 'bootstrapping', sandboxId: this.sandbox.id });
    if (this.sandbox.networkIsolation !== 'ISOLATED' || this.sandbox.domains.length) {
      throw new AgentRuntimeError('sandbox_policy_failed', 'Sandbox does not match isolation profile');
    }
    const bootstrap = await withAbort(() => this.sandbox.exec(BOOTSTRAP, { signal, timeoutSec: 180, maxOutputBytes: 16384, ephemeral: true }), signal);
    if (bootstrap.exitCode !== 0 || !bootstrap.stdout.includes(`codex-cli ${CODEX_VERSION}`)) {
      throw new AgentRuntimeError('sandbox_bootstrap_failed', 'Fixed Codex version could not be installed in Sandbox');
    }
    // Install only public, host-owned programs before isolation admission.
    for (const file of ['sandbox-bridge.cjs', 'network-entrypoint.sh', 'network-probe.cjs']) {
      await this.writeFile(`/capabilities/${file}`, fs.readFileSync(path.join(__dirname, file), 'utf8'), signal);
    }
    const locked = await withAbort(() => this.sandbox.exec(LOCKDOWN, { signal, timeoutSec: 20, maxOutputBytes: 4096, ephemeral: true }), signal);
    if (locked.exitCode !== 0) {
      // This is our fixed pre-agent probe, before model input or credentials.
      this.onLifecycle({ state: 'policy_probe_failed', exitCode: locked.exitCode, diagnostic: locked.stderr.slice(0, 2000), probe: locked.stdout.slice(0, 2000) });
      throw new AgentRuntimeError('sandbox_policy_failed', 'Sandbox identity, filesystem or network isolation verification failed');
    }
    this.proof = JSON.parse(locked.stdout.trim());
    if (!this.proof.egressDenied) throw new AgentRuntimeError('sandbox_policy_failed', 'Outbound network isolation is not verified');
    // Do not transfer interview data until the real kernel policy has passed.
    await this.writeFile('/input/task.json', bundle.input, signal);
    await this.writeFile('/capabilities/evaluation-instructions.txt', bundle.instructions, signal);
    await this.writeFile('/capabilities/output-schema.json', JSON.stringify(bundle.outputSchema), signal);
    await this.writeFile('/work/home/.codex/config.toml', buildCodexConfig(this.config.model), signal);
    const sealed = await withAbort(() => this.sandbox.exec('chmod -R a+rX,a-w /input /capabilities', { signal, timeoutSec: 10, ephemeral: true }), signal);
    if (sealed.exitCode !== 0) throw new AgentRuntimeError('sandbox_policy_failed', 'Task bundle could not be sealed');
    this.onLifecycle({ state: 'ready', sandboxId: this.sandbox.id, proof: this.proof });
  }

  async writeFile(target, contents, signal) {
    // SDK 3.13 file transfers do not accept a signal. Stop waiting on abort so
    // the owner can destroy the VM, which also closes any stalled transfer.
    await withAbort(() => this.sandbox.files.write(target, contents), signal);
  }

  openChannel(options) {
    return this.sandbox.exec(`${AGENT_PREFIX} bridge`, {
      ...options, stdin: true, captureOutput: false, ephemeral: true,
    });
  }

  async destroy() {
    if (!this.sandboxId && this.cleanupState === 'create_unknown') {
      this.onLifecycle({ state: 'create_unknown' });
      throw new AgentRuntimeError('create_unknown', 'Sandbox create outcome is unknown; inspect the target Railway environment before retrying');
    }
    if (!this.sandboxId || this.cleanupState === 'destroyed') return;
    this.cleanupState = 'cleanup_pending';
    // A full disk or failed audit writer must never veto resource destruction.
    const notify = (event) => { try { this.onLifecycle(event); } catch { this.journalFailed = true; } };
    notify({ state: 'cleanup_pending', sandboxId: this.sandboxId });
    const Sandbox = await this.sdk();
    const cleanupSignal = AbortSignal.timeout(45000);
    try {
      // Use a fresh handle: the original handle may carry an aborted run signal.
      const sandbox = await Sandbox.connect(this.sandboxId, this.options(cleanupSignal));
      if (sandbox.environmentId !== this.config.environmentId) {
        throw new AgentRuntimeError('sandbox_ownership_mismatch', 'Sandbox environment does not match the recorded owner');
      }
      if (sandbox.status !== 'DESTROYED') {
        await sandbox.destroy();
        while (!cleanupSignal.aborted) {
          await sandbox.refresh();
          if (sandbox.status === 'DESTROYED') break;
          await delay(500, undefined, { signal: cleanupSignal });
        }
      }
      if (sandbox.status !== 'DESTROYED') throw new Error('destroy_unconfirmed');
    } catch (error) {
      if (error?.code === 'sandbox_ownership_mismatch') throw error;
      if (error?.name !== 'SandboxNotFoundError') {
        throw new AgentRuntimeError('cleanup_pending', `Sandbox destruction is unconfirmed; retry cleanup for ${this.sandboxId}`);
      }
    }
    this.cleanupState = 'destroyed';
    notify({ state: 'destroyed', sandboxId: this.sandboxId });
  }
}

module.exports = { RailwaySandboxManager };
