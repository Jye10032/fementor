const { randomUUID } = require('crypto');
const { AsyncEventQueue } = require('./async-event-queue');
const {
  AGENT_RUNTIME_IDS,
  AgentRuntimeError,
  createAgentEvent,
  normalizeRunRequest,
  normalizeSessionRequest,
} = require('./contracts');

const defaultHarnessFactory = async (options) => {
  const { DeepSeekHarness } = await import('@deepseek-ai/dsh-sdk-client');
  return new DeepSeekHarness(options);
};

const defaultPromptBuilder = (input) => typeof input === 'string' ? input : JSON.stringify(input);

const classifyDshError = (error) => {
  if (error instanceof AgentRuntimeError) return error;
  const name = String(error?.name || '');
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  if (code === 'ENOENT' || code === 'EACCES') {
    return new AgentRuntimeError('runtime_unavailable', error.message, { cause: error });
  }
  if (name === 'RequestTimeoutError') {
    return new AgentRuntimeError('deadline_exceeded', error.message, { cause: error });
  }
  if (name === 'TransportClosedError') {
    return new AgentRuntimeError('runtime_unavailable', error.message, { cause: error });
  }
  if (name === 'JsonRpcResponseError' || name === 'SdkProtocolError') {
    return new AgentRuntimeError('runtime_protocol_error', error.message, { cause: error });
  }
  return new AgentRuntimeError('execution_failed', error?.message || String(error), { cause: error });
};

const notificationToEvents = (notification) => {
  if (!notification || typeof notification !== 'object') return [];
  if (notification.method === 'session.status') {
    return [{ type: 'status', data: { status: notification.params?.status || 'unknown' } }];
  }
  if (notification.method !== 'session.event') return [];

  const event = notification.params?.event;
  if (event?.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
    return [{ type: 'output_delta', data: { delta: String(event.data.chunk.text || '') } }];
  }
  if (event?.type === 'tool/call') {
    return [{ type: 'tool_call', data: event.data || {} }];
  }
  if (event?.type === 'tool/result') {
    return [{ type: 'tool_result', data: event.data || {} }];
  }
  return [];
};

class DshRuntime {
  constructor({
    harnessOptions,
    harnessFactory = defaultHarnessFactory,
    promptBuilders = {},
    outputParsers = {},
    maxConcurrentRuns = 1,
    now = Date.now,
    createId = randomUUID,
  } = {}) {
    if (!harnessOptions?.launch?.command) {
      throw new AgentRuntimeError('invalid_config', 'DSH harness launch command is required');
    }
    this.id = AGENT_RUNTIME_IDS.DSH;
    this.harnessOptions = harnessOptions;
    this.harnessFactory = harnessFactory;
    this.promptBuilders = new Map(Object.entries(promptBuilders));
    this.outputParsers = new Map(Object.entries(outputParsers));
    if (Number(maxConcurrentRuns) !== 1) {
      throw new AgentRuntimeError(
        'invalid_config',
        'DSH_MAX_CONCURRENT_RUNS must be 1 because cancellation closes the shared subprocess',
      );
    }
    this.maxConcurrentRuns = 1;
    this.now = now;
    this.createId = createId;
    this.sessions = new Map();
    this.runs = new Map();
    this.harness = null;
    this.harnessPromise = null;
    this.harnessGeneration = 0;
    this.harnessClosePromise = null;
  }

  async capabilities() {
    return {
      tools: true,
      skills: true,
      openViking: false,
      filesystem: false,
      sandbox: false,
      structuredOutput: false,
      sessionResume: true,
    };
  }

  status() {
    return {
      state: this.harnessClosePromise
        ? 'stopping'
        : this.harness
          ? 'ready'
          : this.harnessPromise
            ? 'starting'
            : 'idle',
      activeRuns: [...this.runs.values()].filter((run) => run.status === 'running').length,
      activeSessions: this.sessions.size,
    };
  }

  async startSession(request) {
    const normalized = normalizeSessionRequest(request);
    await this.#getHarness();
    const internalId = this.createId();
    const session = { id: internalId, runtimeId: this.id };
    this.sessions.set(internalId, {
      ...normalized,
      externalSessionId: `fementor-${internalId.replaceAll('-', '')}`,
      status: 'active',
    });
    return session;
  }

  async resumeSession(session) {
    this.#getActiveSession(session);
    await this.#getHarness();
  }

  async *runTurn(request) {
    const normalized = normalizeRunRequest(request);
    const sessionRecord = this.#getActiveSession(normalized.session);
    const promptBuilder = this.promptBuilders.get(normalized.taskType);
    if (!promptBuilder) {
      throw new AgentRuntimeError('unsupported_task', `unsupported dsh task: ${normalized.taskType}`);
    }
    if (this.runs.has(normalized.runId)) {
      throw new AgentRuntimeError('duplicate_run', `run already exists: ${normalized.runId}`);
    }
    const activeRunCount = [...this.runs.values()].filter((run) => run.status === 'running').length;
    if (activeRunCount >= this.maxConcurrentRuns) {
      throw new AgentRuntimeError('runtime_busy', 'dsh runtime has reached its active run limit');
    }

    const queue = new AsyncEventQueue();
    const controller = new AbortController();
    this.runs.set(normalized.runId, { controller, status: 'running' });
    const emit = (type, data = {}) => queue.push(createAgentEvent({
      type,
      runId: normalized.runId,
      sessionId: normalized.session.id,
      data,
      now: this.now,
    }));
    emit('started', { runtimeId: this.id, taskType: normalized.taskType });

    void (async () => {
      const timeout = setTimeout(() => controller.abort('deadline_exceeded'), normalized.budget.deadlineMs);
      const onAbort = () => { void this.#disposeHarness(); };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const harness = await this.#getHarness();
        const session = harness.session(sessionRecord.externalSessionId);
        const prompt = await promptBuilder(normalized.input, normalized);
        const result = await session.run(prompt, {
          onNotification: (notification) => {
            for (const mapped of notificationToEvents(notification)) emit(mapped.type, mapped.data);
          },
        });
        if (controller.signal.aborted) {
          throw new AgentRuntimeError(
            String(controller.signal.reason || 'run_cancelled'),
            String(controller.signal.reason || 'run cancelled'),
          );
        }
        const parser = this.outputParsers.get(normalized.taskType);
        const output = parser ? await parser(result.finalResponse, result, normalized) : result.finalResponse;
        this.runs.get(normalized.runId).status = 'completed';
        emit('completed', {
          output,
          externalSessionId: result.sessionId,
        });
      } catch (error) {
        const run = this.runs.get(normalized.runId);
        if (run) run.status = 'failed';
        const runtimeError = controller.signal.aborted
          ? new AgentRuntimeError(
            String(controller.signal.reason || 'run_cancelled'),
            String(controller.signal.reason || 'run cancelled'),
            { cause: error },
          )
          : classifyDshError(error);
        if (runtimeError.code === 'runtime_unavailable' || runtimeError.code === 'runtime_protocol_error') {
          await this.#disposeHarness();
        }
        emit('failed', { code: runtimeError.code, message: runtimeError.message });
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', onAbort);
        queue.close();
        this.runs.delete(normalized.runId);
      }
    })();

    for await (const event of queue) yield event;
  }

  async cancelTurn(runId) {
    const run = this.runs.get(String(runId || '').trim());
    if (!run || run.status !== 'running') return false;
    run.controller.abort('run_cancelled');
    await this.#disposeHarness();
    return true;
  }

  async closeSession(session) {
    this.#getSession(session);
    this.sessions.delete(session.id);
  }

  async dispose() {
    for (const run of this.runs.values()) {
      if (run.status === 'running') run.controller.abort('runtime_disposed');
    }
    await this.#disposeHarness();
  }

  async #getHarness() {
    if (this.harnessClosePromise) await this.harnessClosePromise;
    if (this.harness) return this.harness;
    if (!this.harnessPromise) {
      const generation = this.harnessGeneration;
      const harnessPromise = Promise.resolve(this.harnessFactory(this.harnessOptions))
        .then(async (harness) => {
          await harness.start();
          return harness;
        });
      this.harnessPromise = harnessPromise;
      this.harnessPromise.generation = generation;
    }

    const harnessPromise = this.harnessPromise;
    const generation = harnessPromise.generation;
    try {
      const harness = await harnessPromise;
      if (generation !== this.harnessGeneration || this.harnessPromise !== harnessPromise) {
        throw new AgentRuntimeError('runtime_unavailable', 'dsh runtime was closed during startup');
      }
      this.harness = harness;
      return harness;
    } catch (error) {
      if (this.harnessPromise === harnessPromise) this.harnessPromise = null;
      throw classifyDshError(error);
    }
  }

  async #disposeHarness() {
    if (this.harnessClosePromise) return this.harnessClosePromise;

    const harness = this.harness;
    const harnessPromise = this.harnessPromise;
    this.harnessGeneration += 1;
    this.harness = null;
    this.harnessPromise = null;
    const closePromise = (async () => {
      const ownedHarness = harness || (harnessPromise ? await harnessPromise.catch(() => null) : null);
      if (ownedHarness) await ownedHarness.close();
    })();
    this.harnessClosePromise = closePromise;
    try {
      await closePromise;
    } finally {
      if (this.harnessClosePromise === closePromise) this.harnessClosePromise = null;
    }
  }

  #getSession(session) {
    if (!session || session.runtimeId !== this.id) {
      throw new AgentRuntimeError('invalid_session', 'session does not belong to dsh runtime');
    }
    const record = this.sessions.get(session.id);
    if (!record) throw new AgentRuntimeError('session_not_found', `runtime session not found: ${session.id}`);
    return record;
  }

  #getActiveSession(session) {
    const record = this.#getSession(session);
    if (record.status !== 'active') {
      throw new AgentRuntimeError('session_closed', `runtime session is ${record.status}`);
    }
    return record;
  }
}

module.exports = {
  DshRuntime,
  classifyDshError,
  notificationToEvents,
};
