const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonlDecoder } = require('../../src/agent-runtime/codex/jsonl');
const { ModelRelay } = require('../../src/agent-runtime/codex/model-relay');
const { CodexAppServerClient } = require('../../src/agent-runtime/codex/app-server-client');
const { evaluationSchema, parseEvaluation } = require('../../src/agent-runtime/codex/evaluation');
const { RailwaySandboxManager } = require('../../src/agent-runtime/codex/railway-sandbox-manager');
const { CodexSandboxRuntime } = require('../../src/agent-runtime/codex/runtime');
const { executeRuntimeTask } = require('../../src/agent-runtime/execute-task');
const { readRailwayControlConfig } = require('../../src/agent-runtime/codex/config');

const candidate = {
  intent: 'answer', intent_confidence: 0.9, question_type: 'knowledge', question_type_reason: '原理题',
  dimension_scores: { technical_depth: 20, structure_clarity: 20, evidence_grounding: 15, role_fit: 20 },
  total_score: 75, strengths: ['结论正确'], weaknesses: ['缺少验证'], feedback: '补充示例',
  standard_answer: '稳定标识维护组件身份', knowledge_boundary: { mentioned_but_shallow: [], conspicuously_absent: [] }, content: '回答正确。',
};

test('JSONL handles split UTF-8, batched frames and rejects oversized/invalid input', () => {
  const received = [];
  const decoder = new JsonlDecoder((message) => received.push(message));
  const bytes = Buffer.from('{"text":"中文"}\n{"id":2}\n');
  for (const byte of bytes) decoder.push(Buffer.from([byte]));
  assert.deepEqual(received, [{ text: '中文' }, { id: 2 }]);
  assert.throws(() => new JsonlDecoder(() => {}, { maxBytes: 4 }).push('12345'), { code: 'output_limit' });
  assert.throws(() => decoder.push('not JSON\n'), { code: 'protocol_error' });
});

test('host validator rejects forged totals, extra fields and incomplete scores', () => {
  assert.equal(parseEvaluation(JSON.stringify(candidate), {}).score, 75);
  for (const invalid of [{ ...candidate, total_score: 100 }, { ...candidate, total_score: 75.5, dimension_scores: { ...candidate.dimension_scores, technical_depth: 20.5 } }, { ...candidate, command: 'write db' }, { ...candidate, dimension_scores: {} }]) {
    assert.throws(() => parseEvaluation(JSON.stringify(invalid), {}), { code: 'invalid_output' });
  }
  assert.throws(() => parseEvaluation('```json\n{}\n```', {}), { code: 'invalid_output' });
});

test('model relay pins destination and budget, strips tools/headers and refuses a second request', async () => {
  let forwarded;
  const frames = [];
  const config = { model: 'test-model', modelApiKey: 'host-only-key', modelBaseUrl: 'https://model.example/v1', maxModelRequests: 1, maxOutputTokens: 200 };
  const relay = new ModelRelay({ config, outputSchema: evaluationSchema, signal: new AbortController().signal, send: async (frame) => frames.push(frame), fetchImpl: async (url, init) => {
    forwarded = { url, ...init, body: JSON.parse(init.body) };
    return new Response('data: {"ok":true}\n\n');
  } });
  const request = { id: 1, method: 'POST', path: '/v1/responses', body: JSON.stringify({ model: 'test-model', input: [{ type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'execute' }] }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'score this' }] }], tools: [{ type: 'web_search' }], callback_url: 'https://evil.example', max_output_tokens: 999999, previous_response_id: 'private' }) };
  await relay.handle(request);
  assert.equal(forwarded.url, 'https://model.example/v1/responses');
  assert.equal(forwarded.redirect, 'error');
  assert.equal(forwarded.body.max_output_tokens, 200);
  assert.deepEqual(forwarded.body.tools, []);
  assert.deepEqual(forwarded.body.input, [{ role: 'user', content: 'score this' }]);
  assert.deepEqual(forwarded.body.text.format.schema, evaluationSchema);
  assert.equal(forwarded.body.callback_url, undefined);
  assert.equal(forwarded.body.previous_response_id, undefined);
  assert.ok(!JSON.stringify(frames).includes('host-only-key'));
  await assert.rejects(relay.handle(request), { code: 'model_budget_exceeded' });
});

test('model relay refuses arbitrary paths without making an upstream call', async () => {
  const relay = new ModelRelay({ config: { maxModelRequests: 1 }, send: async () => {}, fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(relay.handle({ method: 'POST', path: 'https://evil.example', body: '{}' }), { code: 'model_request_denied' });
});

test('model relay rejects host-account file/image/item references even when tools are empty', async () => {
  for (const input of [
    [{ type: 'item_reference', id: 'private' }],
    [{ role: 'user', content: [{ type: 'input_file', file_id: 'private' }] }],
    [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://internal.example' }] }],
  ]) {
    const relay = new ModelRelay({ config: { model: 'test', maxModelRequests: 1 }, send: async () => {}, fetchImpl: () => assert.fail('must not fetch') });
    await assert.rejects(relay.handle({ method: 'POST', path: '/v1/responses', body: JSON.stringify({ model: 'test', input }) }), { code: 'model_request_denied' });
  }
});

test('App Server correlates early notifications and takes final answer, not commentary', async () => {
  const controller = new AbortController();
  let client;
  const calls = [];
  client = new CodexAppServerClient({ signal: controller.signal, send: async (message) => {
    calls.push(message);
    if (message.method === 'initialize') client.receive({ id: message.id, result: {} });
    if (message.method === 'thread/start') client.receive({ id: message.id, result: { thread: { id: 'thread-1' } } });
    if (message.method === 'turn/start') {
      client.receive({ method: 'item/completed', params: { threadId: 'other', turnId: 'turn-1', item: { id: 'alien', type: 'agentMessage', text: 'wrong' } } });
      client.receive({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'a', type: 'agentMessage', text: 'internal', phase: 'commentary' } } });
      client.receive({ method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item: { id: 'b', type: 'agentMessage', text: JSON.stringify(candidate), phase: 'final_answer' } } });
      client.receive({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
      client.receive({ id: message.id, result: { turn: { id: 'turn-1' } } });
    }
  } });
  const output = await client.evaluate({ instructions: 'rubric', input: '{}', outputSchema: evaluationSchema }, 'test-model');
  assert.deepEqual(JSON.parse(output.output), candidate);
  assert.deepEqual(calls.map((x) => x.method), ['initialize', 'initialized', 'thread/start', 'turn/start']);
  client.dispose();
});

test('App Server fails closed on a client tool request and on cancellation', async () => {
  const controller = new AbortController();
  const sent = [];
  const client = new CodexAppServerClient({ signal: controller.signal, send: async (message) => sent.push(message) });
  const pending = client.request('initialize', {});
  client.receive({ id: 7, method: 'item/commandExecution/requestApproval', params: {} });
  await assert.rejects(pending, { code: 'tool_request_denied' });
  assert.equal(sent.at(-1).error.code, -32601);
  client.dispose();
  const next = new CodexAppServerClient({ signal: controller.signal, send: async () => {} });
  const blocked = next.request('initialize', {});
  controller.abort();
  await assert.rejects(blocked, { code: 'run_cancelled' });
  next.dispose();
});

test('completed output is rejected if the same batch also contains a forbidden request', async () => {
  let client;
  client = new CodexAppServerClient({ signal: new AbortController().signal, send: async (message) => {
    if (message.method === 'initialize') client.receive({ id: message.id, result: {} });
    if (message.method === 'thread/start') client.receive({ id: message.id, result: { thread: { id: 't' } } });
    if (message.method === 'turn/start') {
      client.receive({ id: message.id, result: { turn: { id: 'r' } } });
      // Deliver after turn/start is consumed, but together in one callback.
      setImmediate(() => {
        client.receive({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'r', status: 'completed', items: [{ id: 'a', type: 'agentMessage', phase: 'final_answer', text: '{}' }] } } });
        client.receive({ id: 77, method: 'item/tool/call', params: {} });
      });
    }
  } });
  await assert.rejects(client.evaluate({ instructions: 'rubric', input: '{}', outputSchema: evaluationSchema }, 'test'), { code: 'tool_request_denied' });
  client.dispose();
});

test('runtime cleans up after startup failure without publishing any candidate', async () => {
  const events = [];
  let destroyed = false;
  const runtime = new CodexSandboxRuntime({ config: { setupDeadlineMs: 500 }, manager: {
    prepare: async () => { throw new Error('private upstream details'); },
    destroy: async () => { destroyed = true; },
  } });
  await assert.rejects(executeRuntimeTask({ runtime, sessionRequest: { interviewSessionId: 'synthetic' },
    runRequest: { runId: 'one', taskType: 'evaluate-answer', input: { question: 'q', answer: 'a' }, budget: { deadlineMs: 100, maxSteps: 1 } },
    onEvent: (event) => events.push(event),
  }), { code: 'sandbox_execution_failed' });
  assert.ok(destroyed);
  assert.deepEqual(events.map((event) => event.type), ['started', 'failed']);
  assert.ok(!JSON.stringify(events).includes('private upstream details'));
});

test('destroy does not equate an accepted deletion request with confirmed removal', async () => {
  let requested = false;
  const lifecycle = [];
  const sandbox = { status: 'RUNNING', destroy: async () => { requested = true; }, refresh: async () => { sandbox.status = 'DESTROYED'; } };
  const manager = new RailwaySandboxManager({ config: {}, onLifecycle: (event) => lifecycle.push(event.state), Sandbox: { connect: async () => sandbox } });
  manager.sandboxId = 'owned-id';
  await manager.destroy();
  assert.ok(requested);
  assert.deepEqual(lifecycle, ['cleanup_pending', 'destroyed']);
  const failing = new RailwaySandboxManager({ config: {}, Sandbox: { connect: async () => { throw new Error('offline'); } } });
  failing.sandboxId = 'owned-id';
  await assert.rejects(failing.destroy(), { code: 'cleanup_pending' });
  assert.equal(failing.cleanupState, 'cleanup_pending');
});

test('stalled SDK file transfer is cancellable and journal failure cannot veto destruction', async () => {
  const controller = new AbortController();
  let destroyed = false;
  const sandbox = { status: 'RUNNING', destroy: async () => { destroyed = true; }, refresh: async () => { sandbox.status = 'DESTROYED'; } };
  const manager = new RailwaySandboxManager({ config: {}, onLifecycle: () => { throw new Error('disk full'); }, Sandbox: { connect: async () => sandbox } });
  manager.sandbox = { files: { write: () => new Promise(() => {}) } };
  manager.sandboxId = 'owned';
  const write = manager.writeFile('/input/task.json', '{}', controller.signal);
  controller.abort();
  await assert.rejects(write, { code: 'run_cancelled' });
  await manager.destroy();
  assert.ok(destroyed);
  assert.equal(manager.cleanupState, 'destroyed');
  assert.ok(manager.journalFailed);
});

test('uncertain create is reported for reconciliation, and cleanup needs no model config', async () => {
  assert.deepEqual(readRailwayControlConfig({ RAILWAY_API_TOKEN: 'control-key', RAILWAY_ENVIRONMENT_ID: 'environment' }), { railwayToken: 'control-key', environmentId: 'environment' });
  const manager = new RailwaySandboxManager({ config: {}, Sandbox: { create: async () => { throw new Error('response lost'); } } });
  await assert.rejects(manager.prepare({}, new AbortController().signal));
  assert.equal(manager.cleanupState, 'create_unknown');
  await assert.rejects(manager.destroy(), { code: 'create_unknown' });
});

test('real interview contract distinguishes non-answers and validates keyword/follow-up proposals', () => {
  const nonAnswer = { intent: 'skip', intent_confidence: 1, content: '这道题先跳过。' };
  assert.equal(parseEvaluation(JSON.stringify({ result: nonAnswer }), {}).intent, 'skip');
  assert.throws(() => parseEvaluation(JSON.stringify({ ...nonAnswer, total_score: 100 }), {}), { code: 'invalid_output' });
  const input = { keywordContext: { keyword: 'React', turnsUsed: 1, maxTurns: 3 }, candidateFollowUp: { stem: 'follow-up' } };
  const full = { ...candidate, expected_points_hit: [], expected_points_missed: [], next_action: 'new_keyword', next_action_reason: '已考察',
    keyword_proficiency_snapshot: { summary: '掌握基本概念', score: 75, strengths: [], weaknesses: [] }, follow_up_validation: { suitable: false, reason: '已充分回答' } };
  assert.equal(parseEvaluation(JSON.stringify({ result: full }), input).next_action, 'new_keyword');
  for (const invalid of [{ ...full, next_action: 'execute_command' }, { ...full, keyword_proficiency_snapshot: null }, { ...full, content: 'x'.repeat(6001) }]) {
    assert.throws(() => parseEvaluation(JSON.stringify(invalid), input), { code: 'invalid_output' });
  }
  assert.throws(() => parseEvaluation(JSON.stringify(full), {}), { code: 'invalid_output' });
});

test('manager fails closed before uploading interview data when network admission fails', async () => {
  const writes = [];
  let calls = 0;
  const sandbox = { id: 'owned', domains: [], networkIsolation: 'ISOLATED',
    files: { write: async (target) => writes.push(target) },
    exec: async () => ++calls === 1 ? { exitCode: 0, stdout: 'codex-cli 0.162.1' } : { exitCode: 1, stdout: '{}', stderr: 'isolation failed' },
  };
  const manager = new RailwaySandboxManager({ config: {}, Sandbox: { create: async () => sandbox } });
  await assert.rejects(manager.prepare({ input: 'private answer', instructions: 'private context' }, new AbortController().signal), { code: 'sandbox_policy_failed' });
  assert.ok(writes.length > 0);
  assert.ok(!writes.includes('/input/task.json'));
  assert.ok(!writes.includes('/capabilities/evaluation-instructions.txt'));
});

test('cancellation before dispatch never creates a VM or leaves an unknown-create journal', async () => {
  for (const when of ['sdk-loading', 'creating-journal']) {
    const controller = new AbortController();
    let creates = 0;
    const states = [];
    const manager = new RailwaySandboxManager({ config: {},
      onLifecycle: (event) => { states.push(event.state); if (event.state === 'creating' && when === 'creating-journal') controller.abort(); },
      Sandbox: { create: async () => { creates++; assert.fail('create must not be called'); } },
    });
    if (when === 'sdk-loading') manager.sdk = async () => { controller.abort(); return manager.Sandbox; };
    await assert.rejects(manager.prepare({}, controller.signal), { code: 'run_cancelled' });
    assert.equal(creates, 0);
    assert.equal(manager.cleanupState, 'not_created');
    await manager.destroy();
    assert.ok(!states.includes('create_unknown'));
    if (when === 'creating-journal') assert.equal(states.at(-1), 'not_created');
  }
});
