const { randomUUID } = require('node:crypto');
const { isPostgresEnabled, getPool, initPostgres } = require('../../postgres');
const { createHttpError } = require('../../http');
const { withAbort } = require('../../agent-runtime/codex/abort');
const cancelled = () => Object.assign(createHttpError(409, '面试处理已取消'), { code: 'run_cancelled' });
const stale = () => Object.assign(createHttpError(409, '面试提交已变化'), { code: 'interview_state_changed' });
const assertLive = (signal) => { if (signal?.aborted) throw cancelled(); };
const pgSql = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
async function saveArtifact({ submission, expert, callId, result, signal }) {
  assertLive(signal);
  if (!submission?.attempt_id || !['evaluate_answer', 'design_question'].includes(expert) || !callId) throw stale();
  const id = randomUUID();
  const sql = `INSERT INTO interview_agent_artifact (id, session_id, submission_id, attempt_id, call_id, expert, result_json, created_at)
    SELECT ?, s.session_id, s.id, s.attempt_id, ?, ?, ?, ? FROM interview_answer_submission s
    JOIN interview_session i ON i.id = s.session_id
    WHERE s.id = ? AND s.session_id = ? AND s.attempt_id = ? AND s.status = 'running'
      AND i.status = 'in_progress' AND s.question_id = ? AND s.question = ? AND s.answer = ? RETURNING id`;
  const args = [id, callId, expert, JSON.stringify(result), new Date().toISOString(), submission.id,
    submission.session_id, submission.attempt_id, submission.question_id, submission.question, submission.answer];
  if (!isPostgresEnabled()) {
    const { db } = require('../../db/core');
    db.transaction(() => {
      assertLive(signal);
      if (!db.prepare(sql).get(...args)) throw stale();
      assertLive(signal);
    }).immediate();
  } else {
    // Bound pool admission and every query. A cancelled connection is destroyed,
    // so an in-flight transaction rolls back rather than persisting a late row.
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 10000);
    let client, released = false;
    const release = (destroy) => { if (client && !released) { released = true; client.release(destroy); } };
    const destroy = () => release(true);
    controller.signal.addEventListener('abort', destroy, { once: true });
    try {
      await withAbort(() => initPostgres(), controller.signal);
      const connecting = getPool().connect();
      connecting.then((value) => { client = value; if (controller.signal.aborted) release(true); }, () => {});
      client = await withAbort(() => connecting, controller.signal);
      assertLive(controller.signal);
      const query = (text, values = []) => withAbort(() => client.query({ text, values, query_timeout: 5000 }), controller.signal);
      await query('BEGIN');
      await query("SET LOCAL statement_timeout = '5s'");
      // Lock the attempt through commit so cancellation/retry cannot race INSERT.
      const live = await query("SELECT id FROM interview_answer_submission WHERE id=$1 AND session_id=$2 AND attempt_id=$3 AND status='running' FOR UPDATE", [submission.id, submission.session_id, submission.attempt_id]);
      if (!live.rows.length) throw stale();
      if (!(await query(pgSql(sql), args)).rows.length) throw stale();
      assertLive(controller.signal);
      await query('COMMIT');
      assertLive(controller.signal);
    } catch (error) { release(true); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', destroy); release(false); }
  }
  assertLive(signal);
  return { artifact_id: id, expert, result };
}
module.exports = { saveArtifact, assertLive };
