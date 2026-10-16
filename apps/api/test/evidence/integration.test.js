const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-evidence-test-'));
Object.assign(process.env, { DATABASE_URL: '', SUPABASE: '', DB_PATH: path.join(dir, 'fixture.db'),
  APP_RUNTIME_MODE: 'local', AGENT_RUNTIME: 'native-api', INTERVIEW_EVIDENCE_SHADOW: '1' });
const db = require('../../src/db');
const { db: sqlite } = require('../../src/db/core');
const { createStore } = require('../../src/interview/evidence/store');
const { createEvaluator } = require('../../src/interview/evidence/service');
const { VERSION } = require('../../src/interview/evidence/contract');
let store, evaluator, args, calls, mode;
function snapshot() { return JSON.stringify(['interview_session','interview_question','interview_turn'].map(t => sqlite.prepare(`SELECT * FROM ${t}`).all())); }
const result = { version: VERSION, intent: 'answer', observations: [{ dimension: 'correctness', assessment: 'strength',
  claim: '本轮能够解释词法作用域', basis: 'answer_demonstration', evidence: [{ turn_id: 't', question_id: 'q', quote: '词法作用域' }] }],
  uncertainties: [], suggestion: { purpose: 'verify', direction: 'stay', reason: '可用一个代码场景验证' } };
test.before(() => {
  db.init(); db.upsertUser({ id: 'local:11111111-1111-4111-8111-111111111111', name: 'fixture' });
  db.createInterviewSession({ id: 's', userId: 'local:11111111-1111-4111-8111-111111111111' });
  db.saveInterviewQuestions({ sessionId: 's', items: [{ id: 'q', order_no: 1, stem: '什么是闭包', status: 'answered' }] });
  db.addInterviewTurn({ id: 't', sessionId: 's', questionId: 'q', turnIndex: 1, question: '什么是闭包', answer: '可以访问词法作用域中的变量', score: 70, strengths: [], weaknesses: [], evidenceRefsCount: 0 });
  store = createStore({ sqlite }); args = { sessionId: 's', userId: 'local:11111111-1111-4111-8111-111111111111', turnId: 't' };
  evaluator = createEvaluator({ store, config: () => ({ apiKey: 'fixture', model: 'fixture' }), complete: async () => {
    calls++;
    if (mode === 'failure') throw new Error('model unavailable');
    if (mode === 'stale') sqlite.prepare('UPDATE interview_turn SET answer = ? WHERE id = ?').run('changed', 't');
    if (mode === 'invalid') return JSON.stringify({ ...result, total_score: 100 });
    return JSON.stringify(result);
  } });
});
test.beforeEach(() => { calls = 0; mode = 'ok'; process.env.INTERVIEW_EVIDENCE_SHADOW = '1'; process.env.AGENT_RUNTIME = 'native-api';
  sqlite.prepare('DELETE FROM interview_evidence_evaluation').run();
  sqlite.prepare('UPDATE interview_turn SET answer = ? WHERE id = ?').run('可以访问词法作用域中的变量', 't'); });
test('shadow persists once, does not advance or rescore and remains readable after disabled', async () => {
  const before = snapshot(); const first = await evaluator.evaluate(args); const again = await evaluator.evaluate(args);
  assert.equal(calls, 1); assert.deepEqual(first.evaluation, again.evaluation); assert.equal(snapshot(), before);
  assert.equal(first.evaluation.provenance.assistance, 'unknown');
  process.env.INTERVIEW_EVIDENCE_SHADOW = '0'; assert.ok((await evaluator.read(args)).evaluation);
});
test('foreign owner, turn and missing question cannot read or generate', async () => {
  await assert.rejects(evaluator.evaluate({ ...args, userId: 'other' }), /accessible/);
  await assert.rejects(evaluator.read({ ...args, turnId: 'other' }), /not found/);
  assert.equal(calls, 0);
});
test('disabled or unsupported runtime fails closed without fallback', async () => {
  process.env.INTERVIEW_EVIDENCE_SHADOW = '0'; await assert.rejects(evaluator.evaluate(args), /disabled/);
  process.env.INTERVIEW_EVIDENCE_SHADOW = '1'; process.env.AGENT_RUNTIME = 'codex';
  await assert.rejects(evaluator.evaluate(args), /unsupported/); assert.equal(calls, 0);
});
test('failed, malformed and stale outputs never persist', async () => {
  for (const value of ['failure','invalid','stale']) {
    mode = value; await assert.rejects(evaluator.evaluate(args));
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM interview_evidence_evaluation').get().n, 0);
  }
});
test('concurrent generation is bounded and retry reuses committed result', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const e = createEvaluator({ store, config: () => ({ apiKey: 'fixture', model: 'fixture' }), complete: async () => { await gate; return JSON.stringify(result); } });
  const first = e.evaluate(args); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(e.evaluate(args), /busy/); release(); await first;
  assert.ok((await e.evaluate(args)).evaluation);
});
test('real authenticated routes isolate ownership and reject client-supplied evaluation', async () => {
  const app = require('fastify')();
  await require('../../src/plugins/error-handler').errorHandlerPlugin(app);
  await app.register(require('../../src/routes/interview-evidence-routes').registerInterviewEvidenceRoutes, { evaluator });
  const url = '/v1/interview/sessions/s/turns/t/evidence';
  const headers = { cookie: 'fementor_local_user=11111111-1111-4111-8111-111111111111' };
  assert.equal((await app.inject({ url, headers })).statusCode, 200);
  assert.equal((await app.inject({ url, headers: { cookie: 'fementor_local_user=other' } })).statusCode, 403);
  const response = await app.inject({ method: 'POST', url, headers, payload: {} });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().evaluation.contract_version, VERSION);
  assert.equal((await app.inject({ method: 'POST', url, headers, payload: { result } })).statusCode, 400);
  await app.close();
});
test.after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
