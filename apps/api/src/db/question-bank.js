const { db, parseJsonArray } = require('./core');

const saveQuestionBankItems = ({ items }) => {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `
    INSERT INTO question_bank
    (id, user_id, source_session_id, source_turn_id, source_question_id, source_question_type, source_question_source, chapter, question, difficulty, tags_json, weakness_tag, next_review_at, review_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  );
  const findExisting = db.prepare(
    `
    SELECT id FROM question_bank
    WHERE user_id = ? AND chapter = ? AND question = ?
  `,
  );
  const updateExisting = db.prepare(
    `
    UPDATE question_bank
    SET source_session_id = ?,
        source_turn_id = ?,
        source_question_id = ?,
        source_question_type = ?,
        source_question_source = ?,
        difficulty = ?,
        tags_json = ?,
        weakness_tag = ?,
        next_review_at = ?,
        review_status = ?,
        updated_at = ?
    WHERE id = ?
  `,
  );
  const stat = { inserted: 0, updated: 0 };
  const tx = db.transaction(() => {
    for (const item of items) {
      const chapter = item.chapter || '面试复盘';
      const existing = findExisting.get(item.user_id, chapter, item.question);
      if (existing) {
        updateExisting.run(
          item.source_session_id || null,
          item.source_turn_id || null,
          item.source_question_id || null,
          item.source_question_type || '',
          item.source_question_source || '',
          item.difficulty || 'medium',
          JSON.stringify(item.tags || []),
          item.weakness_tag || '',
          item.next_review_at || null,
          item.review_status || 'pending',
          now,
          existing.id,
        );
        stat.updated += 1;
      } else {
        insert.run(
          item.id,
          item.user_id,
          item.source_session_id || null,
          item.source_turn_id || null,
          item.source_question_id || null,
          item.source_question_type || '',
          item.source_question_source || '',
          chapter,
          item.question,
          item.difficulty || 'medium',
          JSON.stringify(item.tags || []),
          item.weakness_tag || '',
          item.next_review_at || null,
          item.review_status || 'pending',
          now,
          now,
        );
        stat.inserted += 1;
      }
    }
  });
  tx();
  return stat;
};

const listQuestionBank = ({ userId, chapter, limit = 20 }) => {
  const rows = chapter
    ? db
      .prepare(
        `
        SELECT id, user_id, source_session_id, source_turn_id, source_question_id, source_question_type, source_question_source, chapter, question, difficulty, tags_json, weakness_tag, next_review_at, review_status, created_at, updated_at
        FROM question_bank
        WHERE user_id = ? AND chapter = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(userId, chapter, limit)
    : db
      .prepare(
        `
        SELECT id, user_id, source_session_id, source_turn_id, source_question_id, source_question_type, source_question_source, chapter, question, difficulty, tags_json, weakness_tag, next_review_at, review_status, created_at, updated_at
        FROM question_bank
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(userId, limit);

  return rows.map((row) => ({
    ...row,
    tags: parseJsonArray(row.tags_json),
  }));
};

const listPracticeQuestions = ({
  userId,
  chapter,
  limit = 10,
  nowIso,
  includeFuture = false,
}) => {
  const now = nowIso || new Date().toISOString();
  const dueClause = includeFuture ? '' : 'AND (next_review_at IS NULL OR next_review_at <= ?)';
  const rows = chapter
    ? db
      .prepare(
        `
        SELECT id, user_id, source_session_id, source_turn_id, source_question_id, source_question_type, source_question_source, chapter, question, difficulty, tags_json, weakness_tag, next_review_at, review_status, created_at, updated_at
        FROM question_bank
        WHERE user_id = ?
          AND chapter = ?
          AND review_status = 'pending'
          ${dueClause}
        ORDER BY
          CASE WHEN next_review_at IS NULL THEN 0 ELSE 1 END ASC,
          next_review_at ASC,
          updated_at DESC
        LIMIT ?
      `,
      )
      .all(...(includeFuture ? [userId, chapter, limit] : [userId, chapter, now, limit]))
    : db
      .prepare(
        `
        SELECT id, user_id, source_session_id, source_turn_id, source_question_id, source_question_type, source_question_source, chapter, question, difficulty, tags_json, weakness_tag, next_review_at, review_status, created_at, updated_at
        FROM question_bank
        WHERE user_id = ?
          AND review_status = 'pending'
          ${dueClause}
        ORDER BY
          CASE WHEN next_review_at IS NULL THEN 0 ELSE 1 END ASC,
          next_review_at ASC,
          updated_at DESC
        LIMIT ?
      `,
      )
      .all(...(includeFuture ? [userId, limit] : [userId, now, limit]));

  return rows.map((row) => ({
    ...row,
    tags: parseJsonArray(row.tags_json),
  }));
};

const getQuestionBankItemById = (questionId) => {
  const row = db
    .prepare(
      `
      SELECT id, user_id, source_session_id, source_turn_id, source_question_id, source_question_type,
             source_question_source, chapter, question, difficulty, tags_json, weakness_tag,
             next_review_at, review_status, created_at, updated_at
      FROM question_bank
      WHERE id = ?
    `,
    )
    .get(questionId);

  if (!row) return null;

  return {
    ...row,
    tags: parseJsonArray(row.tags_json),
  };
};

const markQuestionReviewed = ({ questionId, userId, reviewStatus, nextReviewAt }) => {
  const now = new Date().toISOString();
  const row = userId
    ? db.prepare('SELECT id FROM question_bank WHERE id = ? AND user_id = ?').get(questionId, userId)
    : db.prepare('SELECT id FROM question_bank WHERE id = ?').get(questionId);
  if (!row) return false;

  db.prepare(
    `
    UPDATE question_bank
    SET review_status = ?, next_review_at = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(reviewStatus, nextReviewAt || null, now, questionId);
  return true;
};

module.exports = {
  getQuestionBankItemById,
  listPracticeQuestions,
  listQuestionBank,
  markQuestionReviewed,
  saveQuestionBankItems,
};
