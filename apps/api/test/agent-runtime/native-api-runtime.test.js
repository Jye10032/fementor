const assert = require('node:assert/strict');
const test = require('node:test');
const { AGENT_RUNTIME_IDS, AgentRuntimeError } = require('../../src/agent-runtime/contracts');
const { executeRuntimeTask } = require('../../src/agent-runtime/execute-task');
const { NativeApiRuntime } = require('../../src/agent-runtime/native-api-runtime');

const createRuntime = (executor) => new NativeApiRuntime({
  executors: { evaluate: executor },
  createId: () => 'session-1',
  now: () => Date.parse('2026-08-26T00:00:00.000Z'),
});

const createRunRequest = (overrides = {}) => ({
  runId: 'run-1',
  taskType: 'evaluate',
  input: { answer: 'test answer' },
  contextRefs: [],
  skillRefs: [],
  outputSchema: null,
  budget: { deadlineMs: 1000, maxSteps: 1 },
  ...overrides,
});

test('native runtime exposes the bounded baseline capabilities', async () => {
  const runtime = createRuntime(async () => ({}));
  assert.deepEqual(await runtime.capabilities(), {
    tools: false,
    skills: false,
    openViking: false,
    filesystem: false,
    sandbox: false,
    structuredOutput: true,
    sessionResume: false,
  });
});

test('native runtime emits stable streaming events and a completed result', async () => {
  const runtime = createRuntime(async ({ input, emitStatus, emitOutputDelta }) => {
    emitStatus('evaluating');
    emitOutputDelta('first');
    emitOutputDelta(' second');
    return { score: 80, answer: input.answer };
  });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const events = [];

  for await (const event of runtime.runTurn({
    ...createRunRequest(),
    session,
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), [
    'started',
    'status',
    'output_delta',
    'output_delta',
    'completed',
  ]);
  assert.equal(events[0].data.runtimeId, AGENT_RUNTIME_IDS.NATIVE_API);
  assert.equal(events[2].data.delta, 'first');
  assert.deepEqual(events.at(-1).data.output, { score: 80, answer: 'test answer' });
  assert.ok(events.every((event) => event.runId === 'run-1' && event.sessionId === 'session-1'));
});

test('executeRuntimeTask forwards events, returns output, and closes the session', async () => {
  const runtime = createRuntime(async ({ emitOutputDelta }) => {
    emitOutputDelta('token');
    return { ok: true };
  });
  const eventTypes = [];

  const output = await executeRuntimeTask({
    runtime,
    sessionRequest: { interviewSessionId: 'interview-1' },
    runRequest: createRunRequest(),
    onEvent: (event) => eventTypes.push(event.type),
  });

  assert.deepEqual(output, { ok: true });
  assert.deepEqual(eventTypes, ['started', 'output_delta', 'completed']);
  await assert.rejects(
    runtime.resumeSession({ id: 'session-1', runtimeId: AGENT_RUNTIME_IDS.NATIVE_API }),
    (error) => error instanceof AgentRuntimeError && error.code === 'session_closed',
  );
});

test('runtime reports executor failures without leaking implementation errors', async () => {
  const runtime = createRuntime(async () => {
    throw new Error('provider exploded');
  });

  await assert.rejects(
    executeRuntimeTask({
      runtime,
      sessionRequest: { interviewSessionId: 'interview-1' },
      runRequest: createRunRequest(),
    }),
    (error) => error instanceof AgentRuntimeError
      && error.code === 'execution_failed'
      && error.message === 'provider exploded',
  );
});

test('runtime rejects unknown task types before execution', async () => {
  const runtime = createRuntime(async () => ({}));
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });

  await assert.rejects(
    async () => {
      for await (const event of runtime.runTurn({
        ...createRunRequest({ taskType: 'unknown' }),
        session,
      })) {
        void event;
      }
    },
    (error) => error instanceof AgentRuntimeError && error.code === 'unsupported_task',
  );
});

test('cancelTurn marks an active run as failed', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const runtime = createRuntime(async ({ signal }) => {
    await waiting;
    if (signal.aborted) throw new AgentRuntimeError('run_cancelled', 'run_cancelled');
    return { ok: true };
  });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const events = [];
  const consume = (async () => {
    for await (const event of runtime.runTurn({ ...createRunRequest(), session })) {
      events.push(event);
    }
  })();

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await runtime.cancelTurn('run-1'), true);
  release();
  await consume;

  assert.equal(events.at(-1).type, 'failed');
  assert.equal(events.at(-1).data.code, 'run_cancelled');
});

test('deadline aborts an executor that observes the runtime signal', async () => {
  const runtime = createRuntime(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted by signal')), { once: true });
    void resolve;
  }));
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const events = [];

  for await (const event of runtime.runTurn({
    ...createRunRequest({ budget: { deadlineMs: 10, maxSteps: 1 } }),
    session,
  })) {
    events.push(event);
  }

  assert.equal(events.at(-1).type, 'failed');
  assert.equal(events.at(-1).data.code, 'deadline_exceeded');
});
