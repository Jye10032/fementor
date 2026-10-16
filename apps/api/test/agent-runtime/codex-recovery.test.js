const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCodexRecovery } = require('../../src/agent-runtime/codex/recovery');
const { PROFILE_ID } = require('../../src/agent-runtime/codex/config');
const { saveRunRecord } = require('../../src/agent-runtime/codex/run-journal');
const { RailwaySandboxManager } = require('../../src/agent-runtime/codex/railway-sandbox-manager');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { environmentId: 'staging', railwayToken: 'fixture' };
  const add = (overrides = {}) => {
    const record = { runId: randomUUID(), sandboxId: randomUUID(), environmentId: 'staging',
      profileId: PROFILE_ID, cleanup: 'pending', status: 'running', lifecycle: [], ...overrides };
    const file = path.join(directory, `${record.runId}.json`);
    saveRunRecord(file, record);
    return { record, file, read: () => JSON.parse(fs.readFileSync(file)) };
  };
  return { directory, config, add };
}

test('restart recovers only valid inactive owned records and preserves validated results', async (t) => {
  const f = fixture(t), orphan = f.add(), validated = f.add({ status: 'validated' }), active = f.add();
  const unknown = f.add({ cleanup: 'create_unknown', sandboxId: undefined });
  const foreign = f.add({ environmentId: 'production' });
  const malformed = path.join(f.directory, `${randomUUID()}.json`);
  fs.writeFileSync(malformed, '{partial');
  const deleted = [];
  const recovery = createCodexRecovery({ ...f, isActive: (id) => id === active.record.runId, onResult: () => {},
    managerFactory: () => ({ async destroy() { deleted.push(this.sandboxId); this.cleanupState = 'destroyed'; } }) });
  await recovery.start(); await recovery.stop();
  assert.deepEqual(new Set(deleted), new Set([orphan.record.sandboxId, validated.record.sandboxId]));
  assert.equal(orphan.read().status, 'interrupted');
  assert.equal(orphan.read().errorCode, 'owner_process_exited');
  assert.equal(orphan.read().cleanup, 'destroyed');
  assert.equal(validated.read().status, 'validated');
  assert.equal(active.read().cleanup, 'pending');
  assert.equal(unknown.read().cleanup, 'create_unknown');
  assert.equal(foreign.read().environmentId, 'production');
  assert.equal(recovery.status().pending, 3);
  assert.equal(recovery.status().manual, 3);
});

test('failed cleanup stays blocked, persists backoff, and a later sweep recovers it', async (t) => {
  const f = fixture(t), orphan = f.add();
  let clock = Date.now(), calls = 0;
  const recovery = createCodexRecovery({ ...f, now: () => clock, isActive: () => false, onResult: () => {},
    managerFactory: () => ({ async destroy() {
      if (++calls === 1) throw new Error('provider unavailable');
      this.cleanupState = 'destroyed';
    } }) });
  await recovery.sweep();
  assert.equal(orphan.read().cleanup, 'cleanup_pending');
  assert.equal(recovery.status().state, 'recovery_required');
  assert.equal(Date.parse(orphan.read().recovery.nextAttemptAt), clock + 30000);
  await recovery.sweep(); assert.equal(calls, 1);
  clock += 30001;
  await recovery.sweep();
  assert.equal(calls, 2);
  assert.equal(orphan.read().cleanup, 'destroyed');
  assert.equal(recovery.status().state, 'ready');
  await recovery.sweep(); assert.equal(calls, 2);
  await recovery.stop();
});

test('sweeps serialize and shutdown waits for confirmation without starting another attempt', async (t) => {
  const f = fixture(t); f.add();
  let release, calls = 0;
  const wait = new Promise((resolve) => { release = resolve; });
  const recovery = createCodexRecovery({ ...f, isActive: () => false, onResult: () => {},
    managerFactory: () => ({ async destroy() { calls++; await wait; this.cleanupState = 'destroyed'; } }) });
  const first = recovery.sweep(), second = recovery.sweep();
  assert.equal(first, second);
  let closed = false;
  const stop = recovery.stop().then(() => { closed = true; });
  await Promise.resolve(); assert.equal(closed, false);
  release(); await stop;
  await recovery.sweep(); assert.equal(calls, 1);
});

test('periodic recovery retries a failed deletion without an HTTP request', async (t) => {
  const f = fixture(t), orphan = f.add(); let calls = 0;
  const recovery = createCodexRecovery({ ...f, intervalMs: 10, isActive: () => false, onResult: () => {},
    managerFactory: () => ({ async destroy() {
      if (++calls === 1) throw new Error('transient');
      this.cleanupState = 'destroyed';
    } }) });
  try {
    await recovery.start();
    const deadline = Date.now() + 1000;
    while (orphan.read().cleanup !== 'destroyed' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(orphan.read().cleanup, 'destroyed');
    assert.equal(calls, 2);
  } finally { await recovery.stop(); }
});

test('provider ownership mismatch never destroys the target; already missing is idempotent', async () => {
  let deletions = 0;
  const manager = new RailwaySandboxManager({ config: { environmentId: 'staging' },
    Sandbox: { connect: async () => ({ environmentId: 'production', destroy: async () => { deletions++; } }) } });
  manager.sandboxId = randomUUID();
  await assert.rejects(manager.destroy(), { code: 'sandbox_ownership_mismatch' });
  assert.equal(deletions, 0);
  const missing = new RailwaySandboxManager({ config: { environmentId: 'staging' },
    Sandbox: { connect: async () => { throw Object.assign(new Error(), { name: 'SandboxNotFoundError' }); } } });
  missing.sandboxId = randomUUID();
  await missing.destroy();
  assert.equal(missing.cleanupState, 'destroyed');
  const destroyed = new RailwaySandboxManager({ config: { environmentId: 'staging' },
    Sandbox: { connect: async () => ({ environmentId: 'staging', status: 'DESTROYED',
      destroy: async () => { throw new Error('must not delete twice'); } }) } });
  destroyed.sandboxId = randomUUID();
  await destroyed.destroy();
  assert.equal(destroyed.cleanupState, 'destroyed');
});

test('journal write failure does not veto deletion, and remains blocked until persistence recovers', async (t) => {
  const f = fixture(t), orphan = f.add(); let deletions = 0;
  fs.mkdirSync(`${orphan.file}.tmp`);
  const recovery = createCodexRecovery({ ...f, isActive: () => false, onResult: () => {},
    managerFactory: () => ({ async destroy() { deletions++; this.cleanupState = 'destroyed'; } }) });
  await recovery.sweep();
  assert.equal(deletions, 1);
  assert.equal(recovery.status().state, 'journal_unavailable');
  assert.equal(orphan.read().cleanup, 'pending');
  fs.rmdirSync(`${orphan.file}.tmp`);
  await recovery.sweep();
  assert.equal(orphan.read().cleanup, 'destroyed');
  assert.equal(recovery.status().state, 'ready');
  await recovery.stop();
});

test('post-rename directory sync failure remains blocked until a write is confirmed', async (t) => {
  const f = fixture(t), orphan = f.add(); let deletions = 0;
  const sync = fs.fsyncSync;
  const mock = t.mock.method(fs, 'fsyncSync', (fd) => {
    if (fs.fstatSync(fd).isDirectory()) throw new Error('directory sync failed');
    return sync(fd);
  });
  const recovery = createCodexRecovery({ ...f, isActive: () => false, onResult: () => {},
    managerFactory: () => ({ async destroy() { deletions++; this.cleanupState = 'destroyed'; } }) });
  await recovery.sweep();
  assert.equal(orphan.read().cleanup, 'destroyed');
  assert.equal(recovery.status().state, 'journal_unavailable');
  await recovery.sweep();
  assert.equal(recovery.status().state, 'journal_unavailable');
  assert.equal(deletions, 1);
  mock.mock.restore();
  await recovery.sweep();
  assert.equal(recovery.status().state, 'ready');
  await recovery.stop();
});
