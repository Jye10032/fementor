const { randomUUID } = require('crypto');
const { AsyncEventQueue } = require('./async-event-queue');
const {
  AGENT_RUNTIME_IDS,
  AgentRuntimeError,
  createAgentEvent,
  normalizeRunRequest,
  normalizeSessionRequest,
} = require('./contracts');

class NativeApiRuntime {
  constructor({ executors = {}, now = Date.now, createId = randomUUID } = {}) {
    this.id = AGENT_RUNTIME_IDS.NATIVE_API;
    this.executors = new Map(Object.entries(executors));
    this.now = now;
    this.createId = createId;
    this.sessions = new Map();
    this.runs = new Map();
  }

  async capabilities() {
    return {
      tools: false,
      skills: false,
      openViking: false,
      filesystem: false,
      sandbox: false,
      structuredOutput: true,
      sessionResume: false,
    };
  }

  async startSession(request) {
    const normalized = normalizeSessionRequest(request);
    const session = {
      id: this.createId(),
      runtimeId: this.id,
    };
    this.sessions.set(session.id, {
      ...normalized,
      status: 'active',
    });
    return session;
  }

  async resumeSession(session) {
    this.#getActiveSession(session);
  }

  async *runTurn(request) {
    const normalized = normalizeRunRequest(request);
    const sessionRecord = this.#getActiveSession(normalized.session);
    const executor = this.executors.get(normalized.taskType);
    if (!executor) {
      throw new AgentRuntimeError('unsupported_task', `unsupported native-api task: ${normalized.taskType}`);
    }
    if (this.runs.has(normalized.runId)) {
      throw new AgentRuntimeError('duplicate_run', `run already exists: ${normalized.runId}`);
    }

    const queue = new AsyncEventQueue();
    const controller = new AbortController();
    this.runs.set(normalized.runId, { controller, status: 'running' });

    const emit = (type, data = {}) => {
      queue.push(createAgentEvent({
        type,
        runId: normalized.runId,
        sessionId: normalized.session.id,
        data,
        now: this.now,
      }));
    };

    emit('started', {
      runtimeId: this.id,
      taskType: normalized.taskType,
    });

    void (async () => {
      const timeout = setTimeout(() => controller.abort('deadline_exceeded'), normalized.budget.deadlineMs);
      try {
        const output = await executor({
          input: normalized.input,
          session: normalized.session,
          sessionRecord,
          budget: normalized.budget,
          signal: controller.signal,
          emitStatus: (status, detail = {}) => emit('status', { status, ...detail }),
          emitOutputDelta: (delta) => {
            if (controller.signal.aborted) {
              throw new AgentRuntimeError('run_cancelled', String(controller.signal.reason || 'run cancelled'));
            }
            emit('output_delta', { delta: String(delta || '') });
          },
        });
        if (controller.signal.aborted) {
          throw new AgentRuntimeError('run_cancelled', String(controller.signal.reason || 'run cancelled'));
        }
        this.runs.get(normalized.runId).status = 'completed';
        emit('completed', { output });
      } catch (error) {
        const run = this.runs.get(normalized.runId);
        if (run) run.status = 'failed';
        const runtimeError = controller.signal.aborted
          ? new AgentRuntimeError(
            String(controller.signal.reason || 'run_cancelled'),
            String(controller.signal.reason || 'run cancelled'),
            { cause: error },
          )
          : error instanceof AgentRuntimeError
            ? error
            : new AgentRuntimeError('execution_failed', error?.message || String(error), { cause: error });
        emit('failed', { code: runtimeError.code, message: runtimeError.message });
      } finally {
        clearTimeout(timeout);
        queue.close();
      }
    })();

    for await (const event of queue) {
      yield event;
    }
  }

  async cancelTurn(runId) {
    const run = this.runs.get(String(runId || '').trim());
    if (!run || run.status !== 'running') return false;
    run.controller.abort('run_cancelled');
    return true;
  }

  async closeSession(session) {
    const record = this.#getSession(session);
    record.status = 'closed';
  }

  #getSession(session) {
    if (!session || session.runtimeId !== this.id) {
      throw new AgentRuntimeError('invalid_session', 'session does not belong to native-api runtime');
    }
    const record = this.sessions.get(session.id);
    if (!record) {
      throw new AgentRuntimeError('session_not_found', `runtime session not found: ${session.id}`);
    }
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

module.exports = { NativeApiRuntime };
