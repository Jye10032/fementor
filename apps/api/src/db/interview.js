const { db, parseJsonArray } = require('./core');

const normalizeInterviewQuestionRow = (row) =>
  row
    ? {
      ...row,
      expected_points: parseJsonArray(row.expected_points_json),
    }
    : null;

const createInterviewSession = ({ id, userId }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO interview_session (id, user_id, status, summary, started_at, ended_at, created_at, updated_at)
    VALUES (?, ?, 'in_progress', '', ?, NULL, ?, ?)
  `,
  ).run(id, userId, now, now, now);

  return { id, user_id: userId, status: 'in_progress', started_at: now };
};

const countSessionsStartedOnUtcDate = ({ userId, date = new Date() }) => {
  const targetUserId = String(userId || '').trim();
  if (!targetUserId) return 0;
  const now = new Date(date);
  const utcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const utcEnd = new Date(utcStart);
  utcEnd.setUTCDate(utcEnd.getUTCDate() + 1);
  const row = db
    .prepare(
      `
      SELECT COUNT(1) as count
      FROM interview_session
      WHERE user_id = ?
        AND created_at >= ?
        AND created_at < ?
    `,
    )
    .get(targetUserId, utcStart.toISOString(), utcEnd.toISOString());

  return Number(row?.count || 0);
};

const getInterviewSession = (sessionId) =>
  db
    .prepare(
      `
      SELECT id, user_id, status, summary, started_at, ended_at, created_at, updated_at
      FROM interview_session
      WHERE id = ?
    `,
    )
    .get(sessionId);

const listInterviewSessions = ({ userId, limit = 20 }) =>
  db
    .prepare(
      `
      SELECT id, user_id, status, summary, started_at, ended_at, created_at, updated_at
      FROM interview_session
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    )
    .all(userId, limit);

const addInterviewTurn = ({
  id,
  sessionId,
  questionId = null,
  turnIndex,
  question,
  answer,
  score,
  strengths,
  weaknesses,
  evidenceRefsCount,
}) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO interview_turn
    (id, session_id, question_id, turn_index, question, answer, score, strengths_json, weaknesses_json, evidence_refs_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    sessionId,
    questionId,
    turnIndex,
    question,
    answer,
    score,
    JSON.stringify(strengths),
    JSON.stringify(weaknesses),
    evidenceRefsCount,
    now,
  );
  db.prepare('UPDATE interview_session SET updated_at = ? WHERE id = ?').run(now, sessionId);
};

const listInterviewTurns = (sessionId) =>
  db
    .prepare(
      `
      SELECT id, session_id, question_id, turn_index, question, answer, score, strengths_json, weaknesses_json, evidence_refs_count, created_at
      FROM interview_turn
      WHERE session_id = ?
      ORDER BY turn_index ASC
    `,
    )
    .all(sessionId)
    .map((row) => ({
      ...row,
      strengths: parseJsonArray(row.strengths_json),
      weaknesses: parseJsonArray(row.weaknesses_json),
    }));

const finishInterviewSession = ({ sessionId, summary }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE interview_session
    SET status = 'completed', summary = ?, ended_at = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(summary || '', now, now, sessionId);
  return getInterviewSession(sessionId);
};

const saveInterviewQuestions = ({ sessionId, items }) => {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `
    INSERT INTO interview_question
    (id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  );

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM interview_question WHERE session_id = ?').run(sessionId);
    for (const item of items) {
      insert.run(
        item.id,
        sessionId,
        item.order_no,
        item.source || 'llm',
        item.question_type || 'basic',
        item.difficulty || 'medium',
        item.stem,
        JSON.stringify(item.expected_points || []),
        item.resume_anchor || '',
        item.source_ref || '',
        item.status || 'pending',
        item.keyword || '',
        now,
        now,
      );
    }
  });

  tx();
};

const insertInterviewQuestionAfter = ({ sessionId, afterOrderNo, item }) => {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE interview_question
      SET order_no = order_no + 1000, updated_at = ?
      WHERE session_id = ? AND order_no > ?
    `,
    ).run(now, sessionId, afterOrderNo);

    db.prepare(
      `
      UPDATE interview_question
      SET order_no = order_no - 999, updated_at = ?
      WHERE session_id = ? AND order_no > ?
    `,
    ).run(now, sessionId, afterOrderNo + 1000);

    db.prepare(
      `
      INSERT INTO interview_question
      (id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      item.id,
      sessionId,
      afterOrderNo + 1,
      item.source || 'llm',
      item.question_type || 'follow_up',
      item.difficulty || 'medium',
      item.stem,
      JSON.stringify(item.expected_points || []),
      item.resume_anchor || '',
      item.source_ref || '',
      item.status || 'pending',
      item.keyword || '',
      now,
      now,
    );
  });

  tx();
};

const listInterviewQuestions = (sessionId) =>
  db
    .prepare(
      `
      SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at
      FROM interview_question
      WHERE session_id = ?
      ORDER BY order_no ASC
    `,
    )
    .all(sessionId)
    .map(normalizeInterviewQuestionRow);

const getInterviewQuestionById = (questionId) =>
  normalizeInterviewQuestionRow(
    db
      .prepare(
        `
        SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at
        FROM interview_question
        WHERE id = ?
      `,
      )
      .get(questionId),
  );

const updateInterviewQuestionStatus = ({ questionId, status }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE interview_question
    SET status = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(status, now, questionId);
};

const deleteInterviewSession = (sessionId) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM interview_turn WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM interview_question WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM interview_session WHERE id = ?').run(sessionId);
  });
  tx();
};

const getNextInterviewQuestion = (sessionId) =>
  normalizeInterviewQuestionRow(
    db
      .prepare(
        `
        SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at
        FROM interview_question
        WHERE session_id = ? AND status != 'answered'
        WHERE session_id = ? AND status != 'answered'
        ORDER BY order_no ASC
        LIMIT 1
      `,
      )
      .get(sessionId),
  );

const updateSessionKeywordQueue = ({ sessionId, keywordQueueJson }) => {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE interview_session SET keyword_queue_json = ?, updated_at = ? WHERE id = ?`,
  ).run(keywordQueueJson || '', now, sessionId);
};

const getSessionKeywordQueue = (sessionId) => {
  const row = db.prepare(`SELECT keyword_queue_json FROM interview_session WHERE id = ?`).get(sessionId);
  if (!row?.keyword_queue_json) return null;
  try {
    const parsed = JSON.parse(row.keyword_queue_json);
    return Array.isArray(parsed?.entries) ? parsed : null;
  } catch { return null; }
};

module.exports = {
  addInterviewTurn,
  createInterviewSession,
  deleteInterviewSession,
  finishInterviewSession,
  countSessionsStartedOnUtcDate,
  getInterviewQuestionById,
  getInterviewSession,
  getNextInterviewQuestion,
  getSessionKeywordQueue,
  insertInterviewQuestionAfter,
  listInterviewQuestions,
  listInterviewSessions,
  listInterviewTurns,
  saveInterviewQuestions,
  updateInterviewQuestionStatus,
  updateSessionKeywordQueue,
};
