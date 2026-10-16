const { AgentRuntimeError } = require('../contracts');
const { JsonlDecoder } = require('./jsonl');

class CodexAppServerClient {
  constructor({ send, signal, onNotification = () => {}, toolGateway }) {
    Object.assign(this, { send, signal, onNotification });
    this.toolGateway = toolGateway;
    this.toolTasks = new Set();
    this.pending = new Map();
    this.sequence = 0;
    this.error = null;
    this.decoder = new JsonlDecoder((message) => this.receive(message));
    this.abort = () => this.fail(new AgentRuntimeError('run_cancelled', 'Codex operation cancelled or deadline exceeded'));
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }

  receive(message) {
    if (this.error) return;
    if (message.method && message.id !== undefined) {
      if (message.method !== 'item/tool/call' || !this.toolGateway || !this.toolReady || this.toolTasks.size >= 3) {
        void this.send({ id: message.id, error: { code: -32601, message: 'FEMentor capability unavailable' } }).catch(() => {});
        this.fail(new AgentRuntimeError('tool_request_denied', 'Codex requested an unavailable capability'));
        return;
      }
      const task = (async () => {
        await this.toolReady;
        if (this.error) throw this.error;
        const result = await this.toolGateway.handle(message.params || {});
        if (this.error || this.signal.aborted) return;
        await this.send({ id: message.id, result });
      })().catch((error) => {
        void this.send({ id: message.id, error: { code: -32602, message: 'FEMentor tool request denied' } }).catch(() => {});
        this.fail(error);
      });
      this.toolTasks.add(task);
      task.finally(() => this.toolTasks.delete(task));
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new AgentRuntimeError('codex_request_failed', `Codex rejected ${pending.method}`));
      else pending.resolve(message.result);
    } else if (message.method) {
      try { this.onNotification(message); } catch (error) { this.fail(error); }
    }
  }

  request(method, params) {
    if (this.error) return Promise.reject(this.error);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      // Register before writing: fast servers can reply before stdin.write settles.
      Promise.resolve(this.send({ id, method, params })).catch((error) => this.fail(error));
    });
  }

  fail(error) {
    if (this.error) return;
    this.error = error;
    this.rejectToolReady?.(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.onFailure?.(error);
  }

  async evaluate(bundle, model) {
    let threadId;
    let turnId;
    const notifications = [];
    let completed;
    let rejected;
    const done = new Promise((resolve, reject) => { completed = resolve; rejected = reject; });
    // A transport failure can arrive while a request is still awaited.
    done.catch(() => {});
    this.onFailure = rejected;
    const messages = new Map();
    const consume = ({ method, params }) => {
      if (params?.threadId !== threadId || (params.turnId && params.turnId !== turnId)) return;
      if (method === 'item/completed' && params.item?.type === 'agentMessage') {
        messages.set(params.item.id, params.item);
      }
      if (method === 'turn/completed' && params.turn?.id === turnId) {
        if (params.turn.status !== 'completed') {
          rejected(new AgentRuntimeError('codex_turn_failed', 'Codex did not complete the evaluation'));
          return;
        }
        for (const item of params.turn.items || []) if (item.type === 'agentMessage') messages.set(item.id, item);
        const finals = [...messages.values()].filter((item) => item.phase === 'final_answer' || item.phase == null);
        const last = finals.at(-1);
        if (!last?.text) rejected(new AgentRuntimeError('missing_output', 'Codex completed without a final answer'));
        else completed(last.text);
      }
    };
    this.onNotification = (event) => {
      if (!turnId) notifications.push(event);
      else consume(event);
    };
    await this.request('initialize', { clientInfo: { name: 'fementor', title: 'FEMentor', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    await this.send({ method: 'initialized', params: {} });
    const started = await this.request('thread/start', {
      model, modelProvider: 'fementor', cwd: '/work',
      approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true,
      developerInstructions: bundle.instructions,
      dynamicTools: this.toolGateway?.dynamicTools() || [],
    });
    threadId = started.thread.id;
    let toolsReady;
    this.toolReady = new Promise((resolve, reject) => { toolsReady = resolve; this.rejectToolReady = reject; });
    this.toolReady.catch(() => {});
    const turn = await this.request('turn/start', {
      threadId, input: [{ type: 'text', text: bundle.input }],
      outputSchema: bundle.outputSchema,
      approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false },
      effort: 'low',
    });
    turnId = turn.turn.id;
    this.toolGateway?.bind(threadId, turnId);
    toolsReady();
    for (const notification of notifications) consume(notification);
    const output = await done;
    if (this.toolTasks.size) throw new AgentRuntimeError('tool_request_denied', 'Codex completed with pending tools');
    this.toolGateway?.close();
    if (this.error) throw this.error;
    return { output, threadId, turnId };
  }

  dispose() {
    this.toolGateway?.close();
    this.signal.removeEventListener('abort', this.abort);
    this.fail(new AgentRuntimeError('session_closed', 'Codex control channel closed'));
  }
}

module.exports = { CodexAppServerClient };
