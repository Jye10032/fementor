const { db, parseJsonArray, parseJsonObject } = require('./core');

const normalizeQuestionSourceRow = (row) =>
  row
    ? {
      ...row,
      knowledge_points: parseJsonArray(row.knowledge_points_json),
      expected_points: parseJsonArray(row.expected_points_json),
      metadata: parseJsonObject(row.metadata_json),
    }
    : null;

const normalizeUserQuestionBankRow = (row) =>
  row
    ? {
      ...row,
      is_favorited: Boolean(row.is_favorited),
    }
    : null;

const normalizeQuestionAttemptRow = (row) =>
  row
    ? {
      ...row,
      strengths: parseJsonArray(row.strengths_json),
      weaknesses: parseJsonArray(row.weaknesses_json),
      evidence_refs: parseJsonArray(row.evidence_refs_json),
      mastered: Boolean(row.mastered),
    }
    : null;

const getQuestionSourceById = (id) =>
  normalizeQuestionSourceRow(
    db
      .prepare(
        `
        SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
               category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
               metadata_json, status, merged_into_source_id, created_at, updated_at
        FROM question_source
        WHERE id = ?
      `,
      )
      .get(id),
  );

const getQuestionSourceBySourceRef = ({ sourceType, sourceRefId }) =>
  normalizeQuestionSourceRow(
    db
      .prepare(
        `
        SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
               category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
               metadata_json, status, merged_into_source_id, created_at, updated_at
        FROM question_source
        WHERE source_type = ? AND source_ref_id = ?
      `,
      )
      .get(sourceType, sourceRefId),
  );

const findQuestionSourceByCanonicalQuestion = ({ canonicalQuestion, track = '', chapter = '' }) =>
  normalizeQuestionSourceRow(
    db
      .prepare(
        `
        SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
               category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
               metadata_json, status, merged_into_source_id, created_at, updated_at
        FROM question_source
        WHERE canonical_question = ? AND track = ? AND chapter = ? AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1
      `,
      )
      .get(canonicalQuestion, track, chapter),
  );

const listQuestionSourcesByIds = (ids = []) => {
  const normalizedIds = ids.filter(Boolean);
  if (normalizedIds.length === 0) return [];
  const placeholders = normalizedIds.map(() => '?').join(', ');
  return db
    .prepare(
      `
      SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
             category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
             metadata_json, status, merged_into_source_id, created_at, updated_at
      FROM question_source
      WHERE id IN (${placeholders})
    `,
    )
    .all(...normalizedIds)
    .map(normalizeQuestionSourceRow);
};

const countQuestionSources = ({ track, chapter, status = 'active' } = {}) => {
  const where = [];
  const params = [];

  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  if (track) {
    where.push('track = ?');
    params.push(track);
  }

  if (chapter) {
    where.push('chapter = ?');
    params.push(chapter);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM question_source
      ${whereClause}
    `,
    )
    .get(...params);

  return Number(row?.total || 0);
};

const upsertQuestionSource = ({
  id,
  sourceType,
  sourceRefId,
  canonicalQuestion,
  questionText,
  normalizedQuestion = '',
  category = '',
  difficulty = 'medium',
  track = '',
  chapter = '',
  knowledgePoints = [],
  expectedPoints = [],
  metadata = {},
  status = 'active',
  mergedIntoSourceId = null,
  createdAt,
  updatedAt,
}) => {
  const now = new Date().toISOString();
  const nextCreatedAt = createdAt || now;
  const nextUpdatedAt = updatedAt || now;
  const existing = db
    .prepare(
      `
      SELECT id
      FROM question_source
      WHERE source_type = ? AND source_ref_id = ?
    `,
    )
    .get(sourceType, sourceRefId);

  if (existing) {
    db.prepare(
      `
      UPDATE question_source
      SET canonical_question = ?, question_text = ?, normalized_question = ?, category = ?,
          difficulty = ?, track = ?, chapter = ?, knowledge_points_json = ?, expected_points_json = ?,
          metadata_json = ?, status = ?, merged_into_source_id = ?, updated_at = ?
      WHERE id = ?
    `,
    ).run(
      canonicalQuestion,
      questionText,
      normalizedQuestion || '',
      category || '',
      difficulty || 'medium',
      track || '',
      chapter || '',
      JSON.stringify(knowledgePoints || []),
      JSON.stringify(expectedPoints || []),
      JSON.stringify(metadata || {}),
      status || 'active',
      mergedIntoSourceId || null,
      nextUpdatedAt,
      existing.id,
    );
    return { item: getQuestionSourceById(existing.id), created: false };
  }

  const nextId = id || `qs_${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `
    INSERT INTO question_source (
      id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
      category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
      metadata_json, status, merged_into_source_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    nextId,
    sourceType,
    sourceRefId,
    canonicalQuestion,
    questionText,
    normalizedQuestion || '',
    category || '',
    difficulty || 'medium',
    track || '',
    chapter || '',
    JSON.stringify(knowledgePoints || []),
    JSON.stringify(expectedPoints || []),
    JSON.stringify(metadata || {}),
    status || 'active',
    mergedIntoSourceId || null,
    nextCreatedAt,
    nextUpdatedAt,
  );

  return { item: getQuestionSourceById(nextId), created: true };
};

const mergeQuestionSources = ({ sourceId, targetSourceId }) => {
  const now = new Date().toISOString();
  const source = getQuestionSourceById(sourceId);
  const target = getQuestionSourceById(targetSourceId);
  if (!source || !target) return false;

  db.prepare(
    `
    UPDATE question_source
    SET status = 'merged', merged_into_source_id = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(targetSourceId, now, sourceId);

  return true;
};

const getUserQuestionBankItemById = (id) =>
  normalizeUserQuestionBankRow(
    db
      .prepare(
        `
        SELECT id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
               mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
               source_channel, created_at, updated_at
        FROM user_question_bank
        WHERE id = ?
      `,
      )
      .get(id),
  );

const getUserQuestionBankItemByUserAndSource = ({ userId, questionSourceId }) =>
  normalizeUserQuestionBankRow(
    db
      .prepare(
        `
        SELECT id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
               mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
               source_channel, created_at, updated_at
        FROM user_question_bank
        WHERE user_id = ? AND question_source_id = ?
      `,
      )
      .get(userId, questionSourceId),
  );

const addUserQuestionBankItem = ({
  id,
  userId,
  questionSourceId,
  track = '',
  chapter = '',
  customQuestionText = '',
  reviewStatus = 'pending',
  masteryLevel = 0,
  weaknessTag = '',
  nextReviewAt = null,
  lastPracticedAt = null,
  isFavorited = false,
  sourceChannel = '',
}) => {
  const now = new Date().toISOString();
  const existing = getUserQuestionBankItemByUserAndSource({ userId, questionSourceId });

  if (existing) {
    db.prepare(
      `
      UPDATE user_question_bank
      SET track = ?, chapter = ?, custom_question_text = ?, review_status = ?, mastery_level = ?,
          weakness_tag = ?, next_review_at = ?, last_practiced_at = ?, is_favorited = ?,
          source_channel = ?, updated_at = ?
      WHERE id = ?
    `,
    ).run(
      track || existing.track || '',
      chapter || existing.chapter || '',
      customQuestionText || existing.custom_question_text || '',
      reviewStatus || existing.review_status || 'pending',
      Number.isFinite(masteryLevel) ? masteryLevel : existing.mastery_level,
      weaknessTag || existing.weakness_tag || '',
      nextReviewAt !== undefined ? nextReviewAt : existing.next_review_at,
      lastPracticedAt !== undefined ? lastPracticedAt : existing.last_practiced_at,
      isFavorited ? 1 : 0,
      sourceChannel || existing.source_channel || '',
      now,
      existing.id,
    );
    return { item: getUserQuestionBankItemById(existing.id), created: false };
  }

  const nextId = id || `uqb_${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `
    INSERT INTO user_question_bank (
      id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
      mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
      source_channel, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    nextId,
    userId,
    questionSourceId,
    track || '',
    chapter || '',
    customQuestionText || '',
    reviewStatus || 'pending',
    Number.isFinite(masteryLevel) ? masteryLevel : 0,
    weaknessTag || '',
    nextReviewAt || null,
    lastPracticedAt || null,
    isFavorited ? 1 : 0,
    sourceChannel || '',
    now,
    now,
  );

  return { item: getUserQuestionBankItemById(nextId), created: true };
};

const listUserQuestionBank = ({
  userId,
  track,
  chapter,
  reviewStatus,
  limit = 20,
  offset = 0,
}) => {
  const where = ['uqb.user_id = ?'];
  const params = [userId];

  if (track) {
    where.push('uqb.track = ?');
    params.push(track);
  }

  if (chapter) {
    where.push('uqb.chapter = ?');
    params.push(chapter);
  }

  if (reviewStatus) {
    where.push('uqb.review_status = ?');
    params.push(reviewStatus);
  }

  const whereClause = `WHERE ${where.join(' AND ')}`;
  const items = db
    .prepare(
      `
      SELECT
        uqb.id, uqb.user_id, uqb.question_source_id, uqb.track, uqb.chapter, uqb.custom_question_text,
        uqb.review_status, uqb.mastery_level, uqb.weakness_tag, uqb.next_review_at,
        uqb.last_practiced_at, uqb.is_favorited, uqb.source_channel, uqb.created_at, uqb.updated_at,
        qs.source_type, qs.metadata_json, qs.canonical_question, qs.question_text, qs.normalized_question,
        qs.category, qs.difficulty, qs.knowledge_points_json, qs.expected_points_json
      FROM user_question_bank uqb
      INNER JOIN question_source qs ON qs.id = uqb.question_source_id
      ${whereClause}
      ORDER BY uqb.updated_at DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset)
    .map((row) => ({
      ...normalizeUserQuestionBankRow(row),
      metadata: parseJsonObject(row.metadata_json),
      knowledge_points: parseJsonArray(row.knowledge_points_json),
      expected_points: parseJsonArray(row.expected_points_json),
    }));

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM user_question_bank uqb
      ${whereClause}
    `,
    )
    .get(...params);

  return {
    items,
    total: totalRow?.total || 0,
  };
};

const listPracticeUserQuestionBank = ({
  userId,
  chapter,
  includeFuture = false,
  limit = 10,
}) => {
  const where = ['uqb.user_id = ?', "uqb.review_status = 'pending'"];
  const params = [userId];

  if (chapter) {
    where.push('uqb.chapter = ?');
    params.push(chapter);
  }

  if (!includeFuture) {
    where.push('(uqb.next_review_at IS NULL OR uqb.next_review_at <= ?)');
    params.push(new Date().toISOString());
  }

  return db
    .prepare(
      `
      SELECT
        uqb.id, uqb.user_id, uqb.question_source_id, uqb.track, uqb.chapter, uqb.custom_question_text,
        uqb.review_status, uqb.mastery_level, uqb.weakness_tag, uqb.next_review_at,
        uqb.last_practiced_at, uqb.is_favorited, uqb.source_channel, uqb.created_at, uqb.updated_at,
        qs.source_type, qs.metadata_json, qs.canonical_question, qs.question_text, qs.normalized_question,
        qs.category, qs.difficulty, qs.knowledge_points_json, qs.expected_points_json
      FROM user_question_bank uqb
      INNER JOIN question_source qs ON qs.id = uqb.question_source_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE WHEN uqb.next_review_at IS NULL THEN 0 ELSE 1 END ASC,
        uqb.next_review_at ASC,
        uqb.updated_at DESC
      LIMIT ?
    `,
    )
    .all(...params, limit)
    .map((row) => ({
      ...normalizeUserQuestionBankRow(row),
      metadata: parseJsonObject(row.metadata_json),
      knowledge_points: parseJsonArray(row.knowledge_points_json),
      expected_points: parseJsonArray(row.expected_points_json),
    }));
};

const updateUserQuestionBankReviewState = ({
  id,
  reviewStatus,
  masteryLevel,
  weaknessTag,
  nextReviewAt,
  lastPracticedAt,
}) => {
  const current = getUserQuestionBankItemById(id);
  if (!current) return null;
  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE user_question_bank
    SET review_status = ?, mastery_level = ?, weakness_tag = ?, next_review_at = ?,
        last_practiced_at = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    reviewStatus !== undefined ? reviewStatus : current.review_status,
    masteryLevel !== undefined ? masteryLevel : current.mastery_level,
    weaknessTag !== undefined ? weaknessTag : current.weakness_tag,
    nextReviewAt !== undefined ? nextReviewAt : current.next_review_at,
    lastPracticedAt !== undefined ? lastPracticedAt : current.last_practiced_at,
    now,
    id,
  );

  return getUserQuestionBankItemById(id);
};

const updateUserQuestionBankFavorite = ({ id, isFavorited }) => {
  const current = getUserQuestionBankItemById(id);
  if (!current) return null;
  const now = new Date().toISOString();

  db.prepare(
    `
    UPDATE user_question_bank
    SET is_favorited = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(isFavorited ? 1 : 0, now, id);

  return getUserQuestionBankItemById(id);
};

const getQuestionAttemptById = (id) =>
  normalizeQuestionAttemptRow(
    db
      .prepare(
        `
        SELECT id, user_id, user_question_bank_id, session_type, session_id, answer, score,
               strengths_json, weaknesses_json, evidence_refs_json, feedback, mastered,
               next_review_at, created_at
        FROM question_attempt
        WHERE id = ?
      `,
      )
      .get(id),
  );

const createQuestionAttempt = ({
  id,
  userId,
  userQuestionBankId,
  sessionType,
  sessionId = null,
  answer = '',
  score = 0,
  strengths = [],
  weaknesses = [],
  evidenceRefs = [],
  feedback = '',
  mastered = false,
  nextReviewAt = null,
}) => {
  const now = new Date().toISOString();
  const nextId = id || `qa_${Math.random().toString(36).slice(2, 10)}`;

  db.prepare(
    `
    INSERT INTO question_attempt (
      id, user_id, user_question_bank_id, session_type, session_id, answer, score,
      strengths_json, weaknesses_json, evidence_refs_json, feedback, mastered,
      next_review_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    nextId,
    userId,
    userQuestionBankId,
    sessionType,
    sessionId || null,
    answer || '',
    Number(score || 0),
    JSON.stringify(strengths || []),
    JSON.stringify(weaknesses || []),
    JSON.stringify(evidenceRefs || []),
    feedback || '',
    mastered ? 1 : 0,
    nextReviewAt || null,
    now,
  );

  db.prepare(
    `
    UPDATE user_question_bank
    SET last_practiced_at = ?, next_review_at = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(now, nextReviewAt || null, now, userQuestionBankId);

  return getQuestionAttemptById(nextId);
};

const listQuestionAttemptsByUserQuestionBankId = (userQuestionBankId, limit = 20) =>
  db
    .prepare(
      `
      SELECT id, user_id, user_question_bank_id, session_type, session_id, answer, score,
             strengths_json, weaknesses_json, evidence_refs_json, feedback, mastered,
             next_review_at, created_at
      FROM question_attempt
      WHERE user_question_bank_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    )
    .all(userQuestionBankId, limit)
    .map(normalizeQuestionAttemptRow);

const getLatestQuestionAttemptByUserQuestionBankId = (userQuestionBankId) =>
  normalizeQuestionAttemptRow(
    db
      .prepare(
        `
        SELECT id, user_id, user_question_bank_id, session_type, session_id, answer, score,
               strengths_json, weaknesses_json, evidence_refs_json, feedback, mastered,
               next_review_at, created_at
        FROM question_attempt
        WHERE user_question_bank_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
      )
      .get(userQuestionBankId),
  );

const summarizeQuestionAttemptMasteryByUserQuestionBankId = (userQuestionBankId) =>
  db
    .prepare(
      `
      SELECT
        COUNT(*) AS attempt_count,
        AVG(score) AS avg_score,
        MAX(created_at) AS last_attempt_at,
        SUM(CASE WHEN mastered = 1 THEN 1 ELSE 0 END) AS mastered_count
      FROM question_attempt
      WHERE user_question_bank_id = ?
    `,
    )
    .get(userQuestionBankId);

module.exports = {
  addUserQuestionBankItem,
  createQuestionAttempt,
  findQuestionSourceByCanonicalQuestion,
  getLatestQuestionAttemptByUserQuestionBankId,
  getQuestionAttemptById,
  getQuestionSourceById,
  getQuestionSourceBySourceRef,
  getUserQuestionBankItemById,
  getUserQuestionBankItemByUserAndSource,
  listQuestionAttemptsByUserQuestionBankId,
  listQuestionSourcesByIds,
  listPracticeUserQuestionBank,
  listUserQuestionBank,
  mergeQuestionSources,
  countQuestionSources,
  summarizeQuestionAttemptMasteryByUserQuestionBankId,
  updateUserQuestionBankFavorite,
  updateUserQuestionBankReviewState,
  upsertQuestionSource,
};
