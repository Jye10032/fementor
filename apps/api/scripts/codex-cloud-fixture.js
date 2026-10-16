// Run over Railway SSH in the isolated staging API, never as a public route.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function assertStaging() {
  assert.equal(process.env.FEMENTOR_DEPLOYMENT_TIER, 'staging');
  assert.ok(process.env.FEMENTOR_STAGING_ENVIRONMENT_ID);
  assert.equal(process.env.RAILWAY_ENVIRONMENT_ID, process.env.FEMENTOR_STAGING_ENVIRONMENT_ID);
  assert.equal(process.env.APP_RUNTIME_MODE, 'cloud');
  assert.equal(process.env.AGENT_RUNTIME, 'codex');
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, 'codex-staging-db.railway.internal');
  assert.equal(database.pathname, '/fementor_test');
}

async function main() {
  assertStaging();
  const db = require('../src/db');
  const pg = require('../src/postgres');
  const root = '/data/cloud-smoke';
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    await pg.initPostgres();
    if (['seed', 'seed-director'].includes(process.argv[2])) {
      const director = process.argv[2] === 'seed-director';
      if (director) assert.equal(process.env.INTERVIEW_ORCHESTRATOR, 'director');
      const testId = randomUUID();
      const fixture = { testId, userId: `user_staging_${testId}`, strangerId: `user_staging_other_${testId}`,
        sessionId: randomUUID(), questionId: randomUUID(), nextId: randomUUID(),
        question: 'React 列表渲染为什么需要稳定的 key？使用数组下标会出现什么问题？',
        answer: 'key 帮助 React 在同级列表更新时识别组件身份。列表插入、删除或排序后，如果用下标，原组件状态可能对应到另一条数据，例如输入框内容错位。我会用数据的稳定唯一 ID；纯静态且顺序永远不变的列表才考虑下标。key 只需要在兄弟节点间唯一，不是全局唯一。' };
      await db.upsertUser({ id: fixture.userId, name: 'Synthetic cloud fixture', resume_summary: '合成材料，无真实候选人信息。' });
      await db.createInterviewSession({ id: fixture.sessionId, userId: fixture.userId });
      await db.saveInterviewQuestions({ sessionId: fixture.sessionId, items: [
        { id: fixture.questionId, order_no: 1, stem: fixture.question, question_type: 'knowledge', status: 'asked', ...(director ? { keyword: 'React key' } : {}) },
        { id: fixture.nextId, order_no: 2, stem: '请解释事件委托。', question_type: 'knowledge', status: 'pending', ...(director ? { keyword: '事件委托' } : {}) },
      ] });
      await db.updateSessionKeywordQueue({ sessionId: fixture.sessionId, keywordQueueJson: JSON.stringify({
        max_turns_per_keyword: director ? 3 : 1, entries: [{ keyword: 'React key', turns_used: 0, status: 'active' },
          ...(director ? [{ keyword: '事件委托', turns_used: 0, status: 'pending' }] : [])],
      }) });
      fs.writeFileSync(path.join(root, `${testId}.json`), JSON.stringify(fixture), { mode: 0o600 });
      console.log(JSON.stringify({ fixture }));
      return;
    }
    const testId = process.argv[3];
    assert.match(testId || '', /^[a-f0-9-]{36}$/);
    const fixture = JSON.parse(fs.readFileSync(path.join(root, `${testId}.json`)));
    const turns = await db.listInterviewTurns(fixture.sessionId);
    const questions = await db.listInterviewQuestions(fixture.sessionId);
    const queue = await db.getSessionKeywordQueue(fixture.sessionId);
    const journalDir = process.env.CODEX_RUN_JOURNAL_DIR;
    const runs = fs.readdirSync(journalDir).filter((file) => /^[a-f0-9-]{36}\.json$/.test(file))
      .map((file) => JSON.parse(fs.readFileSync(path.join(journalDir, file))))
      .filter((run) => run.interviewSessionId === fixture.sessionId);
    const artifacts = process.env.INTERVIEW_ORCHESTRATOR === 'director'
      ? (await pg.getPool().query('SELECT id, submission_id, attempt_id, call_id, expert, created_at FROM interview_agent_artifact WHERE session_id = $1 ORDER BY created_at', [fixture.sessionId])).rows : [];
    let directorChecks;
    if (process.argv[2] === 'verify') {
      assert.equal(turns.length, 1);
      assert.equal(questions.find((q) => q.id === fixture.questionId).status, 'answered');
      assert.equal(questions.find((q) => q.id === fixture.nextId).status, 'asked');
      assert.equal(queue.entries[0].status, 'completed');
      assert.ok(runs.length > 0);
      for (const run of runs) assert.equal(run.cleanup, 'destroyed');
      const successful = runs.find((run) => run.status === 'validated');
      assert.ok(successful);
      assert.ok(successful.lifecycle.find((event) => event.state === 'ready')?.proof.egressDenied);
    } else if (process.argv[2] === 'verify-director') {
      assert.equal(process.env.INTERVIEW_ORCHESTRATOR, 'director');
      const submissions = (await pg.getPool().query('SELECT * FROM interview_answer_submission WHERE session_id = $1 ORDER BY created_at, id', [fixture.sessionId])).rows;
      assert.equal(submissions.length, 3);
      assert.equal(turns.length, 1);
      assert.equal((await db.getInterviewSession(fixture.sessionId)).status, 'completed');
      assert.equal(questions.find((q) => q.id === fixture.nextId).status, 'pending');
      const results = submissions.map((submission) => {
        assert.equal(submission.status, 'completed');
        assert.equal(submission.attempts, 1);
        return JSON.parse(submission.result_json);
      });
      assert.deepEqual(results.map((result) => result.agent_decision.action), ['clarify', 'follow_up', 'finish']);
      const roots = runs.filter((run) => !run.parentRunId);
      assert.equal(roots.length, 3);
      for (const [index, submission] of submissions.entries()) {
        const result = results[index];
        const rootRun = roots.find((run) => run.runId === result.agent_runtime.run_id);
        assert.ok(rootRun);
        assert.equal(rootRun.rootRunId, rootRun.runId);
        assert.equal(rootRun.profileId, 'codex-railway-interview-director-v1');
        assert.equal(rootRun.taskType, 'direct-interview');
        const children = runs.filter((run) => run.parentRunId === rootRun.runId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        assert.ok(children.length <= 2);
        for (const [childIndex, child] of children.entries()) {
          assert.equal(child.rootRunId, rootRun.runId);
          assert.ok(child.startedAt >= rootRun.startedAt && child.completedAt <= rootRun.completedAt);
          if (childIndex) assert.ok(children[childIndex - 1].completedAt <= child.startedAt);
        }
        if (index === 1) {
          assert.deepEqual(children.map((child) => child.taskType).sort(), ['design-question', 'evaluate-answer']);
          assert.deepEqual(children.map((child) => child.profileId).sort(), ['codex-railway-interview-question-v1', 'codex-railway-interview-v1']);
        }
        for (const [field, expert] of [['evaluation_ref', 'evaluate_answer'], ['question_ref', 'design_question']]) {
          const ref = result.agent_decision[field];
          if (!ref) continue;
          const artifact = artifacts.find((item) => item.id === ref);
          assert.ok(artifact);
          assert.equal(artifact.submission_id, submission.id);
          assert.equal(artifact.attempt_id, submission.attempt_id);
          assert.equal(artifact.expert, expert);
        }
      }
      for (const artifact of artifacts) assert.ok(submissions.some((row) => row.id === artifact.submission_id && row.attempt_id === artifact.attempt_id));
      const scoreResult = results[1];
      const evaluationRow = (await pg.getPool().query('SELECT result_json FROM interview_agent_artifact WHERE id = $1', [scoreResult.agent_decision.evaluation_ref])).rows[0];
      assert.equal(JSON.parse(evaluationRow.result_json).score, turns[0].score);
      assert.equal(turns[0].id, scoreResult.turn_id);
      assert.equal(turns[0].question, submissions[1].question);
      assert.equal(turns[0].answer, submissions[1].answer);
      assert.equal(turns[0].score, scoreResult.score);
      for (const run of runs) {
        assert.equal(run.status, 'validated');
        assert.equal(run.cleanup, 'destroyed');
        assert.ok(run.lifecycle.find((event) => event.state === 'ready')?.proof.egressDenied);
        assert.ok(run.sandboxId);
      }
      directorChecks = { attemptBoundArtifacts: true, persistedOriginalAnswer: true, oneAtomicScore: true,
        rootChildProfiles: true, serialSpecialists: true, allJournalsDestroyed: true, allEgressProbesDenied: true,
        noExpertsForClarifyOrFinish: artifacts.length === 2 && runs.length === 5 };
    } else {
      assert.equal(process.argv[2], 'inspect');
    }
    const migrations = (await pg.getPool().query('SELECT version FROM schema_migrations ORDER BY version')).rows;
    console.log(JSON.stringify({ testId, score: turns[0]?.score, turns: turns.length,
      questions: questions.map(({ id, status }) => ({ id, status })), queue, runs, artifacts, migrations, directorChecks }));
  } finally {
    await pg.getPool()?.end();
  }
}
main().catch((error) => { console.error(JSON.stringify({ error: error.code || 'fixture_failed', message: error.message })); process.exitCode = 1; });
