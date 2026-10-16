const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-codex-route-'));
Object.assign(process.env, { DATABASE_URL: '', SUPABASE: '', DB_PATH: path.join(directory, 'fixture.db'),
  AGENT_RUNTIME: 'codex', CODEX_SANDBOX_ENABLED: '1', CODEX_RUN_JOURNAL_DIR: path.join(directory, 'runs'),
  APP_RUNTIME_MODE: 'local', PUBLIC_SOURCE_DRIVER: 'sqlite', INTERVIEW_PIPELINE_VERSION: 'unified',
  RAILWAY_API_TOKEN: 'fixture', RAILWAY_ENVIRONMENT_ID: 'fixture', RAILWAY_TOKEN: '',
  CODEX_MODEL: 'fixture', CODEX_MODEL_API_KEY: 'fixture', CODEX_MODEL_BASE_URL: 'https://model.example/v1' });
const db = require('../../src/db');
const { CodexSandboxRuntime } = require('../../src/agent-runtime/codex/runtime');
const { parseEvaluation } = require('../../src/agent-runtime/codex/evaluation');
const { buildApp } = require('../../src/app');
const { assertNoPendingCleanup } = require('../../src/agent-runtime/codex/interview-runner');
const originalRun = CodexSandboxRuntime.prototype.runTurn;
const candidate = { intent: 'answer', intent_confidence: 1, question_type: 'knowledge', question_type_reason: '概念题',
  total_score: 80, dimension_scores: { technical_depth: 20, structure_clarity: 20, evidence_grounding: 20, role_fit: 20 },
  strengths: [], weaknesses: [], feedback: '评价', standard_answer: '参考答案', content: '经校验的评价',
  knowledge_boundary: { mentioned_but_shallow: [], conspicuously_absent: [] } };
let lastInput, evaluations = 0;
let mode = 'answer', onStarted = () => {}, onClosed = () => {};
CodexSandboxRuntime.prototype.runTurn = async function* (request) {
  evaluations++; lastInput = request.input;
  this.controller = new AbortController();
  try {
    yield { type: 'started', data: {} };
    if (mode === 'wait') {
      onStarted();
      await new Promise((resolve) => this.controller.signal.addEventListener('abort', resolve, { once: true }));
      yield { type: 'failed', data: { code: 'run_cancelled', message: 'cancelled' } };
      return;
    }
    const raw = mode === 'invalid' ? { ...candidate, total_score: 100 }
      : mode === 'skip' ? { intent: 'skip', intent_confidence: 1, content: '跳过此题。' } : candidate;
    const output = parseEvaluation(JSON.stringify(raw), request.input);
    if (mode === 'stale') db.finishInterviewSession({ sessionId: current.sessionId, summary: 'finished during evaluation' });
    yield { type: 'completed', data: { output } };
  } finally { onClosed(); }
};
let app, current;
function seed() {
  const cookie = randomUUID(), userId = `local:${cookie}`, sessionId = randomUUID(), questionId = randomUUID(), nextId = randomUUID();
  db.upsertUser({ id: userId, name: 'fixture', resume_summary: '' });
  db.createInterviewSession({ id: sessionId, userId });
  db.saveInterviewQuestions({ sessionId, items: [
    { id: questionId, order_no: 1, stem: 'fixture question', status: 'asked', question_type: 'knowledge' },
    { id: nextId, order_no: 2, stem: 'next question', status: 'pending', question_type: 'knowledge' },
  ] });
  current = { cookie, userId, sessionId, questionId, nextId };
  return current;
}
function request(fixture, stream = true, overrides = {}) {
  return app.inject({ method: 'POST', url: `/v1/interview/sessions/${fixture.sessionId}/turns${stream ? '/stream' : ''}`,
    headers: { cookie: `fementor_local_user=${fixture.cookie}` }, payload: { question_id: fixture.questionId, answer: 'fixture answer', ...overrides } });
}
test.before(async () => { app = await buildApp(); });
test('real route publishes only validated committed content, ignores client runtime and rejects duplicate/cross-user requests', async () => {
  mode = 'answer'; const fixture = seed();
  const response = await request(fixture, true, { runtime: 'native-api', model: 'arbitrary' });
  assert.match(response.body, /event: result/);
  assert.match(response.body, /"id":"codex"/);
  assert.match(response.body, /"standard_answer":""/);
  assert.doesNotMatch(response.body, /参考答案/);
  assert.equal((response.body.match(/event: token/g) || []).length, 1);
  assert.equal(db.listInterviewTurns(fixture.sessionId).length, 1);
  assert.equal(db.getInterviewQuestionById(fixture.nextId).status, 'asked');
  assert.ok((await request(fixture, false)).statusCode >= 400);
  assert.equal((await request({ ...fixture, cookie: randomUUID() }, false)).statusCode, 403);
  assert.equal((await request({ ...fixture, cookie: randomUUID() }, true)).statusCode, 403);
  assert.equal(db.listInterviewTurns(fixture.sessionId).length, 1);
});
test('invalid scores and stale state never publish content or mutate interview state', async () => {
  for (const behavior of ['invalid', 'stale']) {
    mode = behavior; const fixture = seed();
    const response = await request(fixture);
    assert.match(response.body, /event: error/);
    assert.doesNotMatch(response.body, /event: token|event: result/);
    assert.equal(db.listInterviewTurns(fixture.sessionId).length, 0);
    assert.equal(db.getInterviewQuestionById(fixture.questionId).status, 'asked');
  }
});
test('skip follows the real route without storing a fabricated score', async () => {
  mode = 'skip'; const fixture = seed();
  const response = await request(fixture, false);
  assert.equal(response.json().handled_as, 'skip');
  assert.equal(response.json().next_question.id, fixture.nextId);
  assert.equal(db.listInterviewTurns(fixture.sessionId).length, 0);
  assert.equal(db.getInterviewQuestionById(fixture.questionId).status, 'skipped');
  const history = await app.inject({ url: `/v1/interview/sessions/${fixture.sessionId}/turns`, headers: { cookie: `fementor_local_user=${fixture.cookie}` } });
  assert.equal(history.json().submissions[0].result.handled_as, 'skip');
  assert.equal(history.json().submissions[0].answer, 'fixture answer');
  assert.equal(history.json().items.length, 0);
});
test('disconnect cancels the run; concurrent requests are refused without a second evaluation', async () => {
  mode = 'wait'; const fixture = seed();
  let startedResolve, closedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const closed = new Promise((resolve) => { closedResolve = resolve; });
  onStarted = startedResolve; onClosed = closedResolve;
  await app.listen({ host: '127.0.0.1', port: 0 });
  const requestBody = JSON.stringify({ question_id: fixture.questionId, answer: 'fixture answer' });
  const req = http.request({ host: '127.0.0.1', port: app.server.address().port, method: 'POST',
    path: `/v1/interview/sessions/${fixture.sessionId}/turns/stream`,
    headers: { cookie: `fementor_local_user=${fixture.cookie}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(requestBody) } });
  req.on('error', () => {}); req.on('response', (response) => response.resume()); req.end(requestBody);
  await started;
  const busy = await request(fixture, false);
  assert.equal(busy.statusCode, 429);
  req.destroy();
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(db.listInterviewTurns(fixture.sessionId).length, 0);
  assert.equal(db.getInterviewQuestionById(fixture.questionId).status, 'asked');
  onStarted = () => {}; onClosed = () => {};
});
test('pending cleanup survives process state and blocks subsequent runs', () => {
  const runId = randomUUID();
  const file = path.join(directory, 'runs', `${runId}.json`);
  fs.writeFileSync(file, JSON.stringify({ runId, cleanup: 'cleanup_pending' }));
  assert.throws(() => assertNoPendingCleanup(), { code: 'recovery_required' });
  fs.rmSync(file);
});
test('failed evaluation preserves complete input; retry by ID commits once and replays a lost response', async () => {
  const fixture = seed(), submissionId = randomUUID();
  const answer = '说明'.repeat(2200) + '完整回答结尾';
  mode = 'invalid';
  const failed = await request(fixture, false, { submission_id: submissionId, answer });
  assert.ok(failed.statusCode >= 400);
  assert.equal(lastInput.answer, answer);
  const { buildEvaluationBundle } = require('../../src/agent-runtime/codex/evaluation');
  assert.equal(JSON.parse(buildEvaluationBundle(lastInput).input).answer, answer);
  const path = `/v1/interview/sessions/${fixture.sessionId}/submissions`;
  const saved = await app.inject({ url: path, headers: { cookie: `fementor_local_user=${fixture.cookie}` } });
  assert.equal(saved.json().items[0].answer, answer);
  assert.equal(saved.json().items[0].status, 'retryable');
  const foreign = await app.inject({ url: path, headers: { cookie: `fementor_local_user=${randomUUID()}` } });
  assert.equal(foreign.statusCode, 403);
  mode = 'answer';
  const retry = await request(fixture, false, { submission_id: submissionId, answer: undefined, question_id: undefined });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().submission_id, submissionId);
  const count = evaluations;
  const replay = await request(fixture, false, { submission_id: submissionId, answer: undefined, question_id: undefined });
  assert.equal(replay.json().replayed, true);
  assert.equal(replay.json().turn_id, retry.json().turn_id);
  assert.equal(evaluations, count);
  assert.equal(db.listInterviewTurns(fixture.sessionId).length, 1);
  const history = await app.inject({ url: `/v1/interview/sessions/${fixture.sessionId}/turns`, headers: { cookie: `fementor_local_user=${fixture.cookie}` } });
  assert.equal(history.json().submissions[0].result.evaluation_text, retry.json().evaluation_text);
  assert.equal(history.json().submissions[0].answer, answer);
  assert.equal((await request(fixture, false, { submission_id: submissionId, answer: 'changed' })).statusCode, 409);
});

test('startup marks an abandoned submission retryable without scoring; retained input can be resumed', async () => {
  const fixture = seed(), store = require('../../src/interview/answer-submission');
  const saved = await store.saveSubmission({ sessionId: fixture.sessionId,
    question: db.getInterviewQuestionById(fixture.questionId), body: { answer: 'saved before crash' } });
  await store.claimSubmission(saved);
  const count = evaluations;
  await store.recoverSubmissions();
  const restored = await store.getSubmission(fixture.sessionId, saved.id);
  assert.equal(restored.status, 'retryable');
  assert.equal(restored.answer, 'saved before crash');
  assert.equal(evaluations, count);
  mode = 'answer';
  const retry = await request(fixture, false, { submission_id: saved.id, answer: undefined, question_id: undefined });
  assert.equal(retry.statusCode, 200);
  assert.equal(lastInput.answer, 'saved before crash');
});

test.after(async () => {
  CodexSandboxRuntime.prototype.runTurn = originalRun;
  await app.close();
  require('../../src/db/core').getDb().close();
  fs.rmSync(directory, { recursive: true });
});
