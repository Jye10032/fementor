// Exercise the actual Fastify interview SSE route with synthetic data in a
// dedicated local SQLite database; never connect this smoke run to production.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { readCodexSandboxConfig } = require('../src/agent-runtime/codex/config');
async function main() {
  const config = readCodexSandboxConfig();
  if (!process.argv.includes('--live')) {
    console.log(JSON.stringify({ status: 'config_ready', profile: config.profileId, note: 'Use --live to test the interview HTTP route with synthetic data and a Railway VM.' }));
    return;
  }
  const testId = randomUUID();
  const directory = path.resolve(__dirname, '../data/codex-interview-smoke', testId);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  Object.assign(process.env, { DATABASE_URL: '', SUPABASE: '', DB_PATH: path.join(directory, 'fixture.db'),
    APP_RUNTIME_MODE: 'local', PUBLIC_SOURCE_DRIVER: 'sqlite', EXPERIENCE_STORAGE_DRIVER: 'sqlite',
    AGENT_RUNTIME: 'codex', CODEX_SANDBOX_ENABLED: '1', INTERVIEW_PIPELINE_VERSION: 'unified',
    CODEX_RUN_JOURNAL_DIR: path.join(directory, 'runs') });
  const { buildApp } = require('../src/app');
  const db = require('../src/db');
  const { syntheticInput } = require('./codex-sandbox-smoke');
  const app = await buildApp();
  const cookieId = randomUUID();
  const userId = `local:${cookieId}`;
  const headers = { cookie: `fementor_local_user=${cookieId}` };
  const report = { testId, startedAt: new Date().toISOString(), syntheticOnly: true, checks: {}, status: 'running' };
  try {
    await db.upsertUser({ id: userId, name: 'Synthetic interview fixture', resume_summary: '合成材料，无真实候选人信息。' });
    const sessionId = randomUUID(), questionId = randomUUID(), nextId = randomUUID();
    await db.createInterviewSession({ id: sessionId, userId });
    await db.saveInterviewQuestions({ sessionId, items: [
      { id: questionId, order_no: 1, stem: syntheticInput.question, question_type: 'knowledge', status: 'asked' },
      { id: nextId, order_no: 2, stem: '请解释事件委托。', question_type: 'knowledge', status: 'pending' },
    ] });
    // Finishing this keyword tests host-owned progression without invoking a
    // separate question-generation model outside the single-turn scoring scope.
    await db.updateSessionKeywordQueue({ sessionId, keywordQueueJson: JSON.stringify({ max_turns_per_keyword: 1,
      entries: [{ keyword: 'React key', turns_used: 0, status: 'active' }] }) });
    console.log(JSON.stringify({ testId, phase: 'interview_sse', sessionId }));
    const response = await app.inject({ method: 'POST', url: `/v1/interview/sessions/${sessionId}/turns/stream`, headers,
      payload: { question_id: questionId, answer: syntheticInput.answer, runtime: 'native-api', model: 'client-must-not-select-model' } });
    const frames = response.body.split('\n\n').map((frame) => {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return event && data ? { event, data: JSON.parse(data) } : null;
    }).filter(Boolean);
    const result = frames.find((frame) => frame.event === 'result')?.data;
    if (!result) throw Object.assign(new Error('Interview route failed'), { code: 'route_failed', details: frames.find((frame) => frame.event === 'error')?.data });
    assert.equal(response.statusCode, 200);
    assert.equal(result.agent_runtime.id, 'codex');
    assert.equal(result.handled_as, 'answer');
    assert.equal(result.standard_answer, '');
    assert.ok(result.score >= 0 && result.score <= 100);
    const turns = await db.listInterviewTurns(sessionId);
    assert.equal(turns.length, 1);
    assert.equal(turns[0].score, result.score);
    assert.equal((await db.getInterviewQuestionById(questionId)).status, 'answered');
    assert.equal((await db.getInterviewQuestionById(nextId)).status, 'asked');
    assert.equal((await db.getSessionKeywordQueue(sessionId)).entries[0].status, 'completed');
    assert.equal(frames.filter((frame) => frame.event === 'token').length, 1);
    assert.equal(frames.find((frame) => frame.event === 'token').data.textChunk, result.evaluation_text);
    report.checks = { actualHttpRoute: true, validatedContentOnly: true, scorePersisted: true, questionAdvanced: true,
      keywordCompleted: true, clientCannotSelectRuntime: true, referenceAnswerWithheld: true };
    const duplicate = await app.inject({ method: 'POST', url: `/v1/interview/sessions/${sessionId}/turns`, headers,
      payload: { question_id: questionId, answer: syntheticInput.answer } });
    assert.ok(duplicate.statusCode >= 400);
    assert.equal((await db.listInterviewTurns(sessionId)).length, 1);
    const stranger = await app.inject({ method: 'POST', url: `/v1/interview/sessions/${sessionId}/turns`,
      headers: { cookie: `fementor_local_user=${randomUUID()}` }, payload: { question_id: nextId, answer: 'skip' } });
    assert.equal(stranger.statusCode, 403);
    report.checks.duplicateRejected = true;
    report.checks.otherUserRejected = true;
    const journal = JSON.parse(fs.readFileSync(path.join(directory, 'runs', `${result.agent_runtime.run_id}.json`)));
    assert.equal(journal.cleanup, 'destroyed');
    assert.ok(journal.lifecycle.find((event) => event.state === 'ready')?.proof.egressDenied);
    report.checks.networkDenied = true;
    report.checks.sandboxDestroyed = true;
    report.result = result;
    report.runtimeAudit = journal;
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = { code: error.code || 'assertion_failed', ...(error.details ? { details: error.details } : {}) };
    process.exitCode = 1;
  } finally {
    await app.close();
    require('../src/db/core').getDb().close();
    report.completedAt = new Date().toISOString();
    const file = path.join(directory, 'report.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ testId, status: report.status, checks: report.checks, score: report.result?.score, error: report.error, report: file }));
  }
}
main().catch((error) => { console.error(JSON.stringify({ code: error.code || 'preflight_failed', message: 'Interview smoke preflight failed' })); process.exitCode = 1; });
