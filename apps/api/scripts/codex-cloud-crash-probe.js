// Management-only fault drill: run over SSH in the dedicated staging container.
// Never copied into the API image or exposed as an HTTP endpoint.
// Usage from /app/apps/api: node <probe> <synthetic-fixture-test-id>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  assert.equal(process.cwd(), '/app/apps/api');
  assert.equal(process.env.FEMENTOR_DEPLOYMENT_TIER, 'staging');
  assert.equal(process.env.RAILWAY_ENVIRONMENT_ID, '2e5766f9-5428-46cf-a063-383ad74fb165');
  assert.equal(process.env.RAILWAY_ENVIRONMENT_ID, process.env.FEMENTOR_STAGING_ENVIRONMENT_ID);
  assert.equal(process.env.APP_RUNTIME_MODE, 'cloud');
  assert.equal(process.env.AGENT_RUNTIME, 'codex');
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, 'codex-staging-db.railway.internal');
  assert.equal(database.pathname, '/fementor_test');
  const testId = process.argv[2];
  assert.match(testId || '', /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  const fixture = JSON.parse(fs.readFileSync(`/data/cloud-smoke/${testId}.json`));
  assert.equal(fixture.testId, testId);
  assert.equal(fixture.userId, `user_staging_${testId}`);
  const proofFile = `/data/cloud-smoke/${testId}-before-crash.json`;
  assert.ok(!fs.existsSync(proofFile), 'A fixture may only be crashed once');
  const directory = process.env.CODEX_RUN_JOURNAL_DIR;
  const readRun = () => fs.readdirSync(directory).filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(directory, name))))
    .find((run) => run.interviewSessionId === fixture.sessionId && run.status === 'running'
      && run.lifecycle.some((event) => event.state === 'ready' && event.proof?.egressDenied));
  const deadline = Date.now() + 240000;
  let run;
  while (!(run = readRun()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(run, 'No ready active sandbox observed');
  // Let the app-server handshake begin, then verify the run is still active.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  assert.equal(readRun()?.runId, run.runId);
  const pg = require(path.join(process.cwd(), 'src/postgres'));
  const db = require(path.join(process.cwd(), 'src/db'));
  await pg.initPostgres();
  try {
    const turns = await db.listInterviewTurns(fixture.sessionId);
    const questions = await db.listInterviewQuestions(fixture.sessionId);
    assert.equal(turns.length, 0);
    assert.equal(questions.find((q) => q.id === fixture.questionId).status, 'asked');
    assert.equal(questions.find((q) => q.id === fixture.nextId).status, 'pending');
    let submission;
    if (fixture.submissionId) {
      const saved = await require(path.join(process.cwd(), 'src/interview/answer-submission')).getSubmission(fixture.sessionId, fixture.submissionId);
      assert.equal(saved.status, 'running');
      assert.equal(saved.answer, fixture.answer);
      submission = { id: saved.id, status: saved.status, attempts: saved.attempts, answerLength: saved.answer.length,
        answerSha256: require('node:crypto').createHash('sha256').update(saved.answer).digest('hex') };
    }
    const init = fs.readFileSync('/proc/1/cmdline', 'utf8').split('\0').filter(Boolean);
    assert.equal(init[0], '/usr/bin/tini');
    const pids = fs.readdirSync('/proc').filter((pid) => /^\d+$/.test(pid)).filter((pid) => {
      try {
        const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
        return args.length === 2 && path.basename(args[0]) === 'node' && args[1] === 'src/start.js';
      } catch { return false; }
    }).map(Number);
    assert.equal(pids.length, 1);
    assert.ok(pids[0] > 1 && pids[0] !== process.pid);
    const proof = { testId, runId: run.runId, sandboxId: run.sandboxId, sessionId: fixture.sessionId, submission,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID, apiPid: pids[0], init,
      signal: 'SIGKILL', preparedAt: new Date().toISOString(), turns: turns.length,
      questions: questions.map(({ id, status }) => ({ id, status })) };
    require(path.join(process.cwd(), 'src/agent-runtime/codex/run-journal')).saveRunRecord(proofFile, proof);
    console.log(JSON.stringify({ phase: 'kill_prepared', ...proof }));
    process.kill(pids[0], 'SIGKILL');
  } finally { await pg.getPool()?.end(); }
}
main().catch((error) => {
  console.error(JSON.stringify({ code: error.code || 'crash_probe_failed', message: error.message }));
  process.exitCode = 1;
});
