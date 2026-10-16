const { randomUUID } = require('node:crypto');
const { AgentRuntimeError, normalizeRunRequest, normalizeSessionRequest, createAgentEvent } = require('../contracts');
const { RailwaySandboxManager } = require('./railway-sandbox-manager');
const { CodexAppServerClient } = require('./app-server-client');
const { JsonlDecoder } = require('./jsonl');
const { ModelRelay } = require('./model-relay');
const { buildEvaluationBundle, parseEvaluation } = require('./evaluation');
const { ToolGateway } = require('./tool-gateway');
const { withAbort } = require('./abort');

// Each invocation owns a fresh VM and one turn; no cross-user session reuse.
class CodexSandboxRuntime {
  constructor({ config, manager, taskSpec, toolGateway, onLifecycle = () => {}, fetchImpl = fetch }) {
    this.id = 'codex';
    Object.assign(this, { config, taskSpec, toolGateway, onLifecycle, fetchImpl });
    this.manager = manager || new RailwaySandboxManager({ config, onLifecycle });
    this.session = null;
    this.controller = null;
    this.audit = { modelRequests: 0, stderrBytes: 0 };
  }

  async capabilities() {
    return { tools: Boolean(this.toolGateway), skills: 'host-injected', sandbox: 'railway', structuredOutput: true, sessionResume: false, network: 'loopback-only', networkVerifiedPerRun: true };
  }

  async startSession(request) {
    normalizeSessionRequest(request);
    if (this.session) throw new AgentRuntimeError('session_reuse_denied', 'Only one session is permitted');
    this.session = { id: randomUUID(), runtimeId: this.id };
    return this.session;
  }

  async *runTurn(request) {
    const run = normalizeRunRequest(request);
    if (run.session.id !== this.session?.id || run.session.runtimeId !== this.id || this.controller) {
      throw new AgentRuntimeError('invalid_session', 'Only one turn in its own session is permitted');
    }
    const taskSpec = this.taskSpec || { taskType: 'evaluate-answer', buildBundle: buildEvaluationBundle, parseOutput: parseEvaluation };
    if (run.taskType !== taskSpec.taskType) throw new AgentRuntimeError('unsupported_task', 'Task does not match the host profile');
    const bundle = taskSpec.buildBundle(run.input);
    if (bundle.dynamicTools?.length && !this.toolGateway) throw new AgentRuntimeError('tool_request_denied', 'Specialists cannot receive tools');
    this.audit.capabilityHash = bundle.capabilityHash;
    this.audit.capabilityRef = bundle.capabilityRef;
    const emit = (type, data) => createAgentEvent({ type, data, runId: run.runId, sessionId: run.session.id });
    this.controller = new AbortController();
    if (this.cancelled) this.controller.abort();
    const controller = this.controller;
    const gateway = this.toolGateway ? new ToolGateway({ specs: bundle.dynamicTools || [], onTool: this.toolGateway.onTool, signal: controller.signal }) : null;
    let timeout = setTimeout(() => controller.abort(), this.config.setupDeadlineMs);
    let client;
    let channel;
    let closed;
    let relay;
    const relayTasks = new Set();
    try {
      yield emit('started', { runtimeId: this.id, taskType: run.taskType });
      await this.manager.prepare(bundle, controller.signal);
      clearTimeout(timeout);
      const deadlineMs = Math.min(run.budget.deadlineMs, this.config.turnDeadlineMs);
      timeout = setTimeout(() => controller.abort(), deadlineMs);
      let writeChain = Promise.resolve();
      const send = (frame) => {
        writeChain = writeChain.then(() => channel.stdin.write(JSON.stringify(frame) + '\n'));
        return writeChain;
      };
      const fail = (error) => { client.fail(error); controller.abort(); };
      client = new CodexAppServerClient({
        signal: controller.signal, toolGateway: gateway,
        send: (message) => send({ channel: 'rpc', data: JSON.stringify(message) + '\n' }),
      });
      relay = new ModelRelay({
        config: { ...this.config, maxModelRequests: Math.min(run.budget.maxSteps, this.config.maxModelRequests) },
        send, toolGateway: gateway, signal: controller.signal, fetchImpl: this.fetchImpl, outputSchema: bundle.outputSchema,
      });
      let readyResolve;
      let readyReject;
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      ready.catch(() => {}); // A synchronous transport failure may abort before the wait is attached.
      let bytes = 0;
      const decoder = new JsonlDecoder((frame) => {
        if (frame.channel === 'ready') readyResolve();
        else if (frame.channel === 'rpc') client.decoder.push(Buffer.from(frame.data, 'base64'));
        else if (frame.channel === 'stderr') this.audit.stderrBytes += frame.bytes;
        else if (frame.channel === 'exit') fail(new AgentRuntimeError('codex_process_exited', 'Codex exited before the channel was closed'));
        else if (frame.channel === 'model') {
          const task = relay.handle(frame).catch(fail);
          relayTasks.add(task);
          task.finally(() => relayTasks.delete(task));
        } else fail(new AgentRuntimeError('protocol_error', 'Unknown Sandbox bridge channel'));
      });
      channel = this.manager.openChannel({
        signal: controller.signal, timeoutSec: Math.ceil(deadlineMs / 1000),
        onStdout: (chunk) => {
          bytes += Buffer.byteLength(chunk);
          try {
            if (bytes > 8 * 1024 * 1024) throw new AgentRuntimeError('output_limit', 'Sandbox output exceeds limit');
            decoder.push(chunk);
          } catch (error) { readyReject(error); fail(error); }
        },
        onStderr: (chunk) => { this.audit.stderrBytes += Buffer.byteLength(chunk); },
      });
      closed = Promise.resolve(channel).then(() => {
        const error = new AgentRuntimeError('channel_closed', 'Sandbox process channel closed');
        readyReject(error);
        fail(error);
      }, (error) => { readyReject(error); fail(new AgentRuntimeError('channel_failed', 'Sandbox control channel failed')); });
      await withAbort(() => ready, controller.signal);
      yield emit('status', { status: 'evaluating' });
      const result = await client.evaluate(bundle, this.config.model);
      if (controller.signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Evaluation was cancelled');
      const output = taskSpec.parseOutput(result.output, run.input);
      Object.assign(this.audit, { threadId: result.threadId, turnId: result.turnId });
      // Raw model deltas, internal reasoning and tool events never leave this adapter.
      yield emit('completed', { output });
    } catch (error) {
      this.audit.failureType = error?.name || 'unknown';
      // Machine-readable networking diagnostics, never the raw provider body.
      this.audit.failureCode = error?.cause?.code || error?.code || null;
      const safe = error instanceof AgentRuntimeError ? error : new AgentRuntimeError('sandbox_execution_failed', 'Sandbox evaluation failed');
      yield emit('failed', { code: safe.code, message: safe.message });
    } finally {
      clearTimeout(timeout);
      this.audit.modelRequests = relay?.requests || 0;
      this.audit.toolCalls = gateway?.records.size || 0;
      client?.dispose();
      controller.abort();
      gateway?.close();
      await gateway?.drain();
      // The signal terminates the remote process group; resource destruction is
      // still mandatory even if termination acknowledgement cannot be obtained.
      await Promise.allSettled([...relayTasks]);
      if (closed) await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1000).unref())]);
    }
  }

  async cancelTurn() { this.cancelled = true; this.controller?.abort(); }
  async closeSession() { this.controller?.abort(); await this.manager.destroy(); }
}

module.exports = { CodexSandboxRuntime };
