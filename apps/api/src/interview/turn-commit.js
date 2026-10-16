const { createHash } = require('node:crypto');
const { isPostgresEnabled, getPool, initPostgres } = require('../postgres');
const { createHttpError } = require('../http');

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const questionRow = (row) => row ? { ...row, expected_points: parse(row.expected_points_json, []) } : null;
const selects = [
  'SELECT * FROM interview_session WHERE id = ?',
  'SELECT * FROM interview_question WHERE session_id = ? ORDER BY order_no, id',
  'SELECT * FROM interview_turn WHERE session_id = ? ORDER BY turn_index, id',
];
const pgSql = (sql) => { let index = 0; return sql.replace(/\?/g, () => `$${++index}`); };
const conflict = () => Object.assign(createHttpError(409, '面试状态已变化，请刷新后重试'), { code: 'interview_state_changed' });
const assertCurrent = (current, expected) => {
  if (current[0][0]?.status !== 'in_progress' || hash(current) !== expected) throw conflict();
};

async function readSnapshot(sessionId) {
  if (!isPostgresEnabled()) {
    const { db } = require('../db/core');
    return db.transaction(() => selects.map((sql) => db.prepare(sql).all(sessionId)))();
  }
  await initPostgres();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = [];
    for (const sql of selects) rows.push((await client.query(pgSql(sql), [sessionId])).rows);
    await client.query('COMMIT');
    return rows;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function applyCommit({ sessionId, expected, statements, signal, submission }) {
  const submissionSql = "SELECT attempt_id, status FROM interview_answer_submission WHERE id = ? AND session_id = ?";
  const checkSubmission = (row) => {
    if (submission && (row?.attempt_id !== submission.attempt_id || row?.status !== 'running')) throw conflict();
  };
  const check = (current) => {
    if (signal?.aborted) throw Object.assign(createHttpError(409, '评分已取消'), { code: 'run_cancelled' });
    assertCurrent(current, expected);
  };
  if (!isPostgresEnabled()) {
    const { db } = require('../db/core');
    db.transaction(() => {
      check(selects.map((sql) => db.prepare(sql).all(sessionId)));
      if (submission) checkSubmission(db.prepare(submissionSql).get(submission.id, sessionId));
      for (const [sql, args] of statements) db.prepare(sql).run(...args);
    }).immediate();
    return;
  }
  await initPostgres();
  const client = await getPool().connect();
  try {
    // Lock the business session, and detect changes to the queue/turns even from
    // older writers. No transaction is held during model calls or planning.
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const rows = [];
    for (const sql of selects) rows.push((await client.query(`${pgSql(sql)} FOR UPDATE`, [sessionId])).rows);
    check(rows);
    if (submission) checkSubmission((await client.query(`${pgSql(submissionSql)} FOR UPDATE`, [submission.id, sessionId])).rows[0]);
    for (const [sql, args] of statements) await client.query(pgSql(sql), args);
    if (signal?.aborted) throw Object.assign(createHttpError(409, '评分已取消'), { code: 'run_cancelled' });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (['40001', '40P01', '23505'].includes(error.code)) throw conflict();
    throw error;
  } finally { client.release(); }
}

// An in-memory plan exposing only the existing FEMentor business operations.
// Agent output cannot supply SQL, IDs, ordering, or arbitrary mutations.
async function createInterviewTurnPlan(sessionId, { signal, submission } = {}) {
  const snapshot = await readSnapshot(sessionId);
  const expected = hash(snapshot);
  const session = snapshot[0][0];
  const questions = snapshot[1].map(questionRow);
  const turns = snapshot[2].map((row) => ({ ...row, strengths: parse(row.strengths_json, []), weaknesses: parse(row.weaknesses_json, []) }));
  const statements = [];
  const queue = parse(session?.keyword_queue_json, null);
  const add = (sql, args) => statements.push([sql, args]);
  const reorder = (ordered, newId) => {
    const now = new Date().toISOString();
    const temporaryBase = Math.max(0, ...questions.map((item) => item.order_no)) + ordered.length + 1;
    // All old ordinals leave the target range before any final assignment.
    ordered.forEach((question, index) => {
      if (question.id !== newId) add('UPDATE interview_question SET order_no = ?, updated_at = ? WHERE id = ? AND session_id = ?', [temporaryBase + index, now, question.id, sessionId]);
    });
    ordered.forEach((question, index) => {
      question.order_no = index + 1;
      if (question.id !== newId) add('UPDATE interview_question SET order_no = ?, updated_at = ? WHERE id = ? AND session_id = ?', [question.order_no, now, question.id, sessionId]);
    });
  };
  let committed = false;
  return {
    getInterviewSession: async () => session,
    getInterviewQuestionById: async (id) => structuredClone(questions.find((item) => item.id === id) || null),
    listInterviewTurns: async () => turns,
    listInterviewQuestions: async () => structuredClone(questions),
    getSessionKeywordQueue: async () => queue?.entries ? queue : null,
    getNextInterviewQuestion: async () => structuredClone([...questions].sort((a, b) => a.order_no - b.order_no).find((item) => ['pending', 'asked'].includes(item.status)) || null),
    updateInterviewQuestionStatus: async ({ questionId, status }) => {
      const question = questions.find((item) => item.id === questionId);
      if (!question) throw conflict();
      question.status = status;
      add('UPDATE interview_question SET status = ?, updated_at = ? WHERE id = ? AND session_id = ?', [status, new Date().toISOString(), questionId, sessionId]);
    },
    updateSessionKeywordQueue: async ({ keywordQueueJson }) => {
      add('UPDATE interview_session SET keyword_queue_json = ? WHERE id = ?', [keywordQueueJson, sessionId]);
    },
    addInterviewTurn: async (turn) => {
      add(`INSERT INTO interview_turn (id, session_id, question_id, turn_index, question, answer, score, strengths_json, weaknesses_json, evidence_refs_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [turn.id, sessionId, turn.questionId, turn.turnIndex, turn.question, turn.answer, turn.score,
        JSON.stringify(turn.strengths), JSON.stringify(turn.weaknesses), turn.evidenceRefsCount, new Date().toISOString()]);
    },
    promotePendingQuestion: async ({ questionId, afterQuestionId }) => {
      const question = questions.find((item) => item.id === questionId && item.status === 'pending');
      const current = questions.find((item) => item.id === afterQuestionId);
      if (!question || !current || question.id === current.id) throw conflict();
      const ordered = [...questions].sort((a, b) => a.order_no - b.order_no).filter((item) => item.id !== questionId);
      ordered.splice(ordered.findIndex((item) => item.id === afterQuestionId) + 1, 0, question);
      reorder(ordered);
    },
    finishInterviewSession: async () => {
      session.status = 'completed';
      session.ended_at = new Date().toISOString();
      add("UPDATE interview_session SET status = 'completed', ended_at = ? WHERE id = ?", [session.ended_at, sessionId]);
    },
    insertInterviewQuestionAfter: async ({ afterOrderNo, item }) => {
      const ordered = [...questions].sort((a, b) => a.order_no - b.order_no);
      const index = ordered.findIndex((question) => question.order_no === afterOrderNo);
      if (index < 0) throw conflict();
      const next = { ...item, session_id: sessionId, order_no: index + 2 };
      ordered.splice(index + 1, 0, next);
      reorder(ordered, next.id);
      const now = new Date().toISOString();
      add(`INSERT INTO interview_question (id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [next.id, sessionId, next.order_no, next.source || 'llm', next.question_type || 'follow_up', next.difficulty || 'medium',
        next.stem, JSON.stringify(next.expected_points || []), next.resume_anchor || '', next.source_ref || '', next.status || 'pending', next.keyword || '', now, now]);
      questions.push(next);
    },
    commit: async (result) => {
      if (committed) throw conflict();
      if (submission) {
        if (!result || result.submission_id !== submission.id) throw conflict();
        add(`UPDATE interview_answer_submission SET status = 'completed', result_json = ?, error_code = '', updated_at = ?
          WHERE id = ? AND attempt_id = ?`, [JSON.stringify(result), new Date().toISOString(), submission.id, submission.attempt_id]);
      }
      add('UPDATE interview_session SET updated_at = ? WHERE id = ?', [new Date().toISOString(), sessionId]);
      await applyCommit({ sessionId, expected, statements, signal, submission });
      committed = true;
    },
  };
}
module.exports = { createInterviewTurnPlan };
