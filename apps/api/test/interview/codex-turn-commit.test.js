const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-turn-commit-'));
process.env.DATABASE_URL = '';
process.env.SUPABASE = '';
process.env.DB_PATH = path.join(directory, 'test.db');
const db = require('../../src/db');
const { createInterviewTurnPlan } = require('../../src/interview/turn-commit');
db.init();
function seed() {
  const sessionId = randomUUID(), questionId = randomUUID();
  db.upsertUser({ id: 'fixture-user', name: 'fixture', resume_summary: '' });
  db.createInterviewSession({ id: sessionId, userId: 'fixture-user' });
  db.saveInterviewQuestions({ sessionId, items: [{ id: questionId, order_no: 1, stem: 'fixture', status: 'asked' }] });
  return { sessionId, questionId };
}
async function propose(plan, questionId, id = randomUUID()) {
  await plan.addInterviewTurn({ id, questionId, turnIndex: 1, question: 'fixture', answer: 'answer', score: 75, strengths: [], weaknesses: [], evidenceRefsCount: 0 });
  await plan.updateInterviewQuestionStatus({ questionId, status: 'answered' });
}
test('a planned turn has no business effects until atomic commit; concurrent stale plan is rejected', async () => {
  const { sessionId, questionId } = seed();
  const first = await createInterviewTurnPlan(sessionId), second = await createInterviewTurnPlan(sessionId);
  await propose(first, questionId); await propose(second, questionId);
  assert.equal(db.listInterviewTurns(sessionId).length, 0);
  assert.equal(db.getInterviewQuestionById(questionId).status, 'asked');
  await first.commit();
  await assert.rejects(second.commit(), { code: 'interview_state_changed' });
  assert.equal(db.listInterviewTurns(sessionId).length, 1);
  assert.equal(db.getInterviewQuestionById(questionId).status, 'answered');
});
test('cancelled and finished sessions cannot receive a late score', async () => {
  for (const finish of [false, true]) {
    const { sessionId, questionId } = seed();
    const controller = new AbortController();
    const plan = await createInterviewTurnPlan(sessionId, { signal: controller.signal });
    await propose(plan, questionId);
    if (finish) db.finishInterviewSession({ sessionId, summary: '' }); else controller.abort();
    await assert.rejects(plan.commit());
    assert.equal(db.listInterviewTurns(sessionId).length, 0);
    assert.equal(db.getInterviewQuestionById(questionId).status, 'asked');
  }
});
test('failure after an insertion rolls back score and question status together', async () => {
  const { sessionId, questionId } = seed();
  const plan = await createInterviewTurnPlan(sessionId);
  await propose(plan, questionId);
  await plan.insertInterviewQuestionAfter({ afterOrderNo: 1, item: { id: questionId, stem: 'duplicate', status: 'asked' } });
  await assert.rejects(plan.commit());
  assert.equal(db.listInterviewTurns(sessionId).length, 0);
  assert.equal(db.getInterviewQuestionById(questionId).status, 'asked');
});
test('skip advances past skipped items without creating a score', async () => {
  const { sessionId, questionId } = seed();
  const plan = await createInterviewTurnPlan(sessionId);
  await plan.updateInterviewQuestionStatus({ questionId, status: 'skipped' });
  assert.equal(await plan.getNextInterviewQuestion(), null);
  await plan.commit();
  assert.equal(db.listInterviewTurns(sessionId).length, 0);
  assert.equal(db.getInterviewQuestionById(questionId).status, 'skipped');
});
test('submission completion and score commit together, and a superseded attempt cannot commit', async () => {
  const { saveSubmission, claimSubmission, getSubmission, recoverSubmissions } = require('../../src/interview/answer-submission');
  for (const failure of ['none', 'insertion', 'superseded']) {
    const { sessionId, questionId } = seed();
    const saved = await saveSubmission({ sessionId, body: { answer: 'answer' }, question: { id: questionId, stem: 'fixture' } });
    const claimed = await claimSubmission(saved);
    const plan = await createInterviewTurnPlan(sessionId, { submission: claimed });
    await propose(plan, questionId);
    if (failure === 'insertion') await plan.insertInterviewQuestionAfter({ afterOrderNo: 1, item: { id: questionId, stem: 'duplicate' } });
    if (failure === 'superseded') {
      await recoverSubmissions();
      await claimSubmission(saved);
    }
    const result = { submission_id: saved.id, evaluation_text: '完整评价' };
    if (failure === 'none') {
      await plan.commit(result);
      assert.equal((await getSubmission(sessionId, saved.id)).status, 'completed');
      assert.deepEqual(JSON.parse((await getSubmission(sessionId, saved.id)).result_json), result);
      assert.equal(db.listInterviewTurns(sessionId).length, 1);
    } else {
      await assert.rejects(plan.commit(result));
      assert.equal((await getSubmission(sessionId, saved.id)).status, 'running');
      assert.equal((await getSubmission(sessionId, saved.id)).result_json, '');
      assert.equal(db.listInterviewTurns(sessionId).length, 0);
      assert.equal(db.getInterviewQuestionById(questionId).status, 'asked');
    }
  }
});
test.after(() => { require('../../src/db/core').getDb().close(); fs.rmSync(directory, { recursive: true }); });
