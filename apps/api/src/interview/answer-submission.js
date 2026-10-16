const { randomUUID } = require('node:crypto');
const { isPostgresEnabled, getPool, initPostgres } = require('../postgres');
const { createHttpError } = require('../http');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const busy = () => createHttpError(429, '该面试的回答正在处理中，请稍后重试');

async function query(sql, args = []) {
  if (isPostgresEnabled()) {
    await initPostgres();
    let index = 0;
    return (await getPool().query(sql.replace(/\?/g, () => `$${++index}`), args)).rows;
  }
  const { db } = require('../db/core');
  return db.prepare(sql).all(...args);
}

// Caller must authenticate session ownership before every read or write.
async function saveSubmission({ sessionId, body, question }) {
  const id = body.submission_id || randomUUID();
  if (!UUID.test(id)) throw createHttpError(400, 'submission_id must be a UUID');
  const existing = (await query('SELECT * FROM interview_answer_submission WHERE id = ? AND session_id = ?', [id, sessionId]))[0];
  if (existing) {
    if ((body.answer !== undefined && String(body.answer).trim() !== existing.answer)
      || (body.question_id && body.question_id !== existing.question_id)
      || (body.question && body.question !== existing.question)) {
      throw createHttpError(409, '提交编号对应的回答已保存，修改回答后请使用新的提交编号');
    }
    return existing;
  }
  if (!question || !String(body.answer || '').trim()) throw createHttpError(400, '当前题目和回答不能为空');
  const now = new Date().toISOString();
  await query(`INSERT INTO interview_answer_submission
    (id, session_id, question_id, question, answer, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?) ON CONFLICT (id) DO NOTHING RETURNING id`,
  [id, sessionId, question.id, question.stem, String(body.answer).trim(), now, now]);
  const saved = (await query('SELECT * FROM interview_answer_submission WHERE id = ? AND session_id = ?', [id, sessionId]))[0];
  if (!saved || saved.answer !== String(body.answer).trim() || saved.question_id !== question.id) {
    throw createHttpError(409, '提交编号已被使用');
  }
  return saved;
}

async function claimSubmission(record) {
  const attemptId = randomUUID();
  try {
    const rows = await query(`UPDATE interview_answer_submission SET status = 'running', attempt_id = ?,
      attempts = attempts + 1, error_code = '', updated_at = ?
      WHERE id = ? AND session_id = ? AND status IN ('pending', 'retryable') RETURNING *`,
    [attemptId, new Date().toISOString(), record.id, record.session_id]);
    if (!rows.length) throw busy();
    return rows[0];
  } catch (error) {
    if (['23505', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error.code)) throw busy();
    throw error;
  }
}

async function failSubmission(record, error) {
  const code = /^[a-z_]{1,60}$/.test(error.code || '') ? error.code : 'evaluation_interrupted';
  await query(`UPDATE interview_answer_submission SET status = 'retryable', error_code = ?, updated_at = ?
    WHERE id = ? AND attempt_id = ? AND status = 'running' RETURNING id`,
  [code, new Date().toISOString(), record.id, record.attempt_id]);
}

// One API owner, called once after DB initialization and sandbox recovery.
// This does not automatically invoke a model or replay business writes.
async function recoverSubmissions() {
  await query(`UPDATE interview_answer_submission SET status = 'retryable', error_code = 'owner_process_exited',
    updated_at = ? WHERE status = 'running' RETURNING id`, [new Date().toISOString()]);
}

async function listPendingSubmissions(sessionId) {
  return query(`SELECT s.id, s.question_id, s.question, s.answer, s.status, s.attempts, s.error_code, s.created_at
    FROM interview_answer_submission s JOIN interview_question q ON q.id = s.question_id AND q.session_id = s.session_id
    WHERE s.session_id = ? AND s.status != 'completed' AND q.status IN ('asked', 'pending')
      AND NOT EXISTS (SELECT 1 FROM interview_answer_submission newer WHERE newer.session_id = s.session_id
        AND newer.question_id = s.question_id AND newer.status = 'completed' AND newer.created_at > s.created_at)
    ORDER BY s.created_at DESC LIMIT 20`, [sessionId]);
}

async function getSubmission(sessionId, id) {
  if (!UUID.test(id || '')) throw createHttpError(400, 'submission_id must be a UUID');
  return (await query('SELECT * FROM interview_answer_submission WHERE id = ? AND session_id = ?', [id, sessionId]))[0];
}

async function listCompletedSubmissions(sessionId) {
  const rows = await query(`SELECT id, question, answer, result_json, created_at FROM interview_answer_submission
    WHERE session_id = ? AND status = 'completed' ORDER BY created_at, id`, [sessionId]);
  return rows.map(({ result_json, ...row }) => ({ ...row, result: JSON.parse(result_json) }));
}

module.exports = { saveSubmission, claimSubmission, failSubmission, recoverSubmissions, listPendingSubmissions, getSubmission, listCompletedSubmissions };
