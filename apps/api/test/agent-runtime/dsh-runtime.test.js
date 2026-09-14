const assert = require('node:assert/strict');
const test = require('node:test');
const { AgentRuntimeError } = require('../../src/agent-runtime/contracts');
const { DshRuntime } = require('../../src/agent-runtime/dsh-runtime');

const createRunRequest = (session, overrides = {}) => ({
  runId: 'run-1',
  session,
  taskType: 'evaluate',
  input: { answer: 'test answer' },
  contextRefs: [],
  skillRefs: [],
  outputSchema: 'test-result-v1',
  budget: { deadlineMs: 1000, maxSteps: 1 },
  ...overrides,
});

const collectEvents = async (events) => {
  const collected = [];
  for await (const event of events) collected.push(event);
  return collected;
};

const createFakeHarness = ({ run, start } = {}) => {
  const calls = { close: 0, sessionIds: [], start: 0 };
  const harness = {
    calls,
    async start() {
      calls.start += 1;
      if (start) await start();
    },
    session(sessionId) {
      calls.sessionIds.push(sessionId);
      return {
        run: run || (async () => ({ sessionId, finalResponse: 'done', events: [], notifications: [] })),
      };
    },
    async close() {
      calls.close += 1;
    },
  };
  return harness;
};

const createRuntime = ({ harnessFactory, promptBuilder, outputParser, maxConcurrentRuns } = {}) => new DshRuntime({
  harnessOptions: { launch: { command: 'fake-dsh' } },
  harnessFactory,
  promptBuilders: { evaluate: promptBuilder || ((input) => JSON.stringify(input)) },
  outputParsers: outputParser ? { evaluate: outputParser } : {},
  maxConcurrentRuns,
  createId: () => 'session-1',
  now: () => Date.parse('2026-08-26T00:00:00.000Z'),
});

test('dsh runtime starts once and reuses its named session', async () => {
  const harness = createFakeHarness();
  const runtime = createRuntime({ harnessFactory: async () => harness });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });

  await collectEvents(runtime.runTurn(createRunRequest(session)));
  await collectEvents(runtime.runTurn(createRunRequest(session, { runId: 'run-2' })));

  assert.equal(harness.calls.start, 1);
  assert.deepEqual(harness.calls.sessionIds, [
    'fementor-session1',
    'fementor-session1',
  ]);
  assert.deepEqual(runtime.status(), {
    state: 'ready',
    activeRuns: 0,
    activeSessions: 1,
  });

  await runtime.closeSession(session);
  assert.equal(runtime.status().activeSessions, 0);
});

test('dsh runtime maps notifications in wire order and parses final response', async () => {
  const parserCalls = [];
  const harness = createFakeHarness({
    run: async (_prompt, { onNotification }) => {
      onNotification({ method: 'session.status', params: { status: 'busy' } });
      onNotification({
        method: 'session.event',
        params: { event: { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: 'hello' } } } },
      });
      onNotification({
        method: 'session.event',
        params: { event: { type: 'tool/call', data: { callId: 'call-1', name: 'lookup', arguments: '{}' } } },
      });
      onNotification({
        method: 'session.event',
        params: { event: { type: 'tool/result', data: { message: { toolCallId: 'call-1' } } } },
      });
      return { sessionId: 'external-1', finalResponse: '{"score":80}', events: [], notifications: [] };
    },
  });
  const runtime = createRuntime({
    harnessFactory: async () => harness,
    outputParser: async (finalResponse, result) => {
      parserCalls.push({ finalResponse, result });
      return JSON.parse(finalResponse);
    },
  });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const events = await collectEvents(runtime.runTurn(createRunRequest(session)));

  assert.deepEqual(events.map((event) => event.type), [
    'started',
    'status',
    'output_delta',
    'tool_call',
    'tool_result',
    'completed',
  ]);
  assert.equal(events[2].data.delta, 'hello');
  assert.deepEqual(events.at(-1).data.output, { score: 80 });
  assert.equal(events.at(-1).data.externalSessionId, 'external-1');
  assert.equal(parserCalls[0].finalResponse, '{"score":80}');
});

test('dsh runtime rejects unsupported tasks before calling the harness', async () => {
  const harness = createFakeHarness();
  const runtime = createRuntime({ harnessFactory: async () => harness });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });

  await assert.rejects(
    collectEvents(runtime.runTurn(createRunRequest(session, { taskType: 'unknown' }))),
    (error) => error instanceof AgentRuntimeError && error.code === 'unsupported_task',
  );
  assert.deepEqual(harness.calls.sessionIds, []);
});

test('dsh runtime discards a failed transport and rebuilds it on the next run', async () => {
  const error = new Error('pipe closed');
  error.name = 'TransportClosedError';
  const failedHarness = createFakeHarness({ run: async () => { throw error; } });
  const recoveredHarness = createFakeHarness();
  const harnesses = [failedHarness, recoveredHarness];
  const runtime = createRuntime({ harnessFactory: async () => harnesses.shift() });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const events = await collectEvents(runtime.runTurn(createRunRequest(session)));

  assert.equal(events.at(-1).type, 'failed');
  assert.equal(events.at(-1).data.code, 'runtime_unavailable');
  assert.equal(events.at(-1).data.message, 'pipe closed');
  assert.equal(failedHarness.calls.close, 1);
  assert.equal(runtime.status().state, 'idle');

  const recoveredEvents = await collectEvents(runtime.runTurn(createRunRequest(session, { runId: 'run-2' })));
  assert.equal(recoveredHarness.calls.start, 1);
  assert.equal(recoveredEvents.at(-1).type, 'completed');
  assert.equal(runtime.status().state, 'ready');
});

test('cancel closes the subprocess once and the next run creates a new harness', async () => {
  let rejectFirstRun;
  const firstHarness = createFakeHarness({
    run: () => new Promise((_resolve, reject) => { rejectFirstRun = reject; }),
  });
  firstHarness.close = async () => {
    firstHarness.calls.close += 1;
    rejectFirstRun(new Error('closed'));
  };
  const secondHarness = createFakeHarness();
  const harnesses = [firstHarness, secondHarness];
  const runtime = createRuntime({ harnessFactory: async () => harnesses.shift() });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const firstEventsPromise = collectEvents(runtime.runTurn(createRunRequest(session)));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await runtime.cancelTurn('run-1'), true);
  const firstEvents = await firstEventsPromise;
  const secondEvents = await collectEvents(runtime.runTurn(createRunRequest(session, { runId: 'run-2' })));

  assert.equal(firstEvents.at(-1).data.code, 'run_cancelled');
  assert.equal(firstHarness.calls.close, 1);
  assert.equal(secondHarness.calls.start, 1);
  assert.equal(secondEvents.at(-1).type, 'completed');
});

test('deadline closes the subprocess and reports deadline_exceeded', async () => {
  let rejectRun;
  const harness = createFakeHarness({
    run: () => new Promise((_resolve, reject) => { rejectRun = reject; }),
  });
  harness.close = async () => {
    harness.calls.close += 1;
    rejectRun(new Error('closed'));
  };
  const runtime = createRuntime({ harnessFactory: async () => harness });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const events = await collectEvents(runtime.runTurn(createRunRequest(session, {
    budget: { deadlineMs: 10, maxSteps: 1 },
  })));

  assert.equal(events.at(-1).data.code, 'deadline_exceeded');
  assert.equal(harness.calls.close, 1);
});

test('dsh runtime rejects concurrent runs that share the subprocess', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const harness = createFakeHarness({ run: async () => {
    await waiting;
    return { sessionId: 'external-1', finalResponse: 'done', events: [], notifications: [] };
  } });
  const runtime = createRuntime({ harnessFactory: async () => harness });
  const session = await runtime.startSession({ interviewSessionId: 'interview-1' });
  const firstEventsPromise = collectEvents(runtime.runTurn(createRunRequest(session)));

  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    collectEvents(runtime.runTurn(createRunRequest(session, { runId: 'run-2' }))),
    (error) => error instanceof AgentRuntimeError && error.code === 'runtime_busy',
  );
  release();
  await firstEventsPromise;
});

test('dsh runtime rejects unsafe subprocess concurrency configuration', () => {
  assert.throws(
    () => createRuntime({ harnessFactory: async () => createFakeHarness(), maxConcurrentRuns: 2 }),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_config',
  );
});

test('dispose closes the owned subprocess and is idempotent', async () => {
  const harness = createFakeHarness();
  const runtime = createRuntime({ harnessFactory: async () => harness });
  await runtime.startSession({ interviewSessionId: 'interview-1' });

  await Promise.all([runtime.dispose(), runtime.dispose()]);

  assert.equal(harness.calls.close, 1);
});
