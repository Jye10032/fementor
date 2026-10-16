const test = require('node:test');
const assert = require('node:assert/strict');
const postgresPath = require.resolve('../../src/postgres');
const postgres = require(postgresPath);
const original = { ...postgres };
let clientFactory;
Object.assign(postgres, { isPostgresEnabled: () => true, initPostgres: async () => {}, getPool: () => ({ connect: () => clientFactory() }) });
const { saveArtifact } = require('../../src/interview/director/artifact-store');
const submission = { id: 'submission', session_id: 'session', attempt_id: 'attempt', question_id: 'question', question: '题目', answer: '原始回答' };
const options = { submission, expert: 'evaluate_answer', callId: 'call', result: { intent: 'answer', score: 80 } };
test('cancelling blocked PostgreSQL INSERT destroys transaction without a late commit', async () => {
  const controller = new AbortController(), calls = [], releases = [];
  let inserted;
  const blocked = new Promise((resolve) => { inserted = resolve; });
  clientFactory = async () => ({
    query: async (config) => {
      calls.push(config);
      if (/^INSERT/.test(config.text)) { inserted(); return new Promise(() => {}); }
      return { rows: [{ id: 'submission' }] };
    },
    release: (destroy) => releases.push(destroy),
  });
  const pending = saveArtifact({ ...options, signal: controller.signal });
  await blocked; controller.abort();
  await assert.rejects(pending, { code: 'run_cancelled' });
  assert.deepEqual(releases, [true]);
  assert.ok(calls.every((config) => config.query_timeout === 5000));
  assert.ok(calls.some((config) => /statement_timeout/.test(config.text)));
  assert.ok(calls.some((config) => /FOR UPDATE/.test(config.text)));
  assert.ok(!calls.some((config) => config.text === 'COMMIT'));
});
test('aborted pool admission is bounded and a late connection is destroyed once', async () => {
  let connect; const releases = [], controller = new AbortController();
  const admitted = new Promise((resolve) => { connect = resolve; });
  clientFactory = () => admitted;
  const pending = saveArtifact({ ...options, signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve)); controller.abort();
  await assert.rejects(pending, { code: 'run_cancelled' });
  connect({ release: (destroy) => releases.push(destroy) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(releases, [true]);
});
test('superseded PostgreSQL attempt fails before INSERT', async () => {
  const calls = [], releases = [];
  clientFactory = async () => ({ query: async (config) => { calls.push(config.text); return { rows: [] }; }, release: (destroy) => releases.push(destroy) });
  await assert.rejects(saveArtifact(options), { code: 'interview_state_changed' });
  assert.ok(!calls.some((sql) => /^INSERT/.test(sql))); assert.deepEqual(releases, [true]);
});
test.after(() => Object.assign(postgres, original));
