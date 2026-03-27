const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../../data/fementor.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const parseJsonArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((item) => item.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const init = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      resume_summary TEXT NOT NULL DEFAULT '',
      active_resume_file TEXT NOT NULL DEFAULT '',
      active_jd_file TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS attempt (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evidence_ref (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_uri TEXT NOT NULL,
      quote TEXT NOT NULL,
      confidence REAL
    );

    CREATE TABLE IF NOT EXISTS score_report (
      id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      score INTEGER NOT NULL,
      strengths_json TEXT NOT NULL,
      weaknesses_json TEXT NOT NULL,
      feedback TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weakness_tag (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interview_session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS interview_turn (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      turn_index INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      strengths_json TEXT NOT NULL,
      weaknesses_json TEXT NOT NULL,
      evidence_refs_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_bank (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_session_id TEXT,
      source_turn_id TEXT,
      chapter TEXT NOT NULL DEFAULT '面试复盘',
      question TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      tags_json TEXT NOT NULL,
      weakness_tag TEXT NOT NULL DEFAULT '',
      next_review_at TEXT,
      review_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_session (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_weakness_user_tag ON weakness_tag(user_id, tag);
    CREATE INDEX IF NOT EXISTS idx_attempt_user_created ON attempt(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_interview_session_user_created ON interview_session(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_turn_session_turn_index ON interview_turn(session_id, turn_index);
    CREATE INDEX IF NOT EXISTS idx_question_bank_user_chapter ON question_bank(user_id, chapter, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_question_bank_user_chapter_question ON question_bank(user_id, chapter, question);
    CREATE INDEX IF NOT EXISTS idx_chat_session_user_updated ON chat_session(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_message_session_created ON chat_message(session_id, created_at ASC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS interview_question (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      order_no INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'llm',
      question_type TEXT NOT NULL DEFAULT 'basic',
      difficulty TEXT NOT NULL DEFAULT 'medium',
      stem TEXT NOT NULL,
      expected_points_json TEXT NOT NULL DEFAULT '[]',
      resume_anchor TEXT NOT NULL DEFAULT '',
      source_ref TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_question_session_order
      ON interview_question(session_id, order_no);
    CREATE INDEX IF NOT EXISTS idx_interview_question_session_status
      ON interview_question(session_id, status, order_no);
  `);

  // 兼容已有本地数据库：为旧表补齐题目队列关联字段。
  ensureColumn('user_profile', 'active_resume_file', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('user_profile', 'active_jd_file', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('interview_turn', 'question_id', 'TEXT');
  ensureColumn('question_bank', 'source_question_id', 'TEXT');
  ensureColumn('question_bank', 'source_question_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('question_bank', 'source_question_source', "TEXT NOT NULL DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS experience_sync_job (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_limit INTEGER NOT NULL DEFAULT 10,
      created_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_experience_sync_job_user_created
      ON experience_sync_job(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_experience_sync_job_status
      ON experience_sync_job(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS experience_post (
      id TEXT PRIMARY KEY,
      source_platform TEXT NOT NULL,
      source_post_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      keyword TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      content_raw TEXT NOT NULL,
      content_cleaned TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      company_name TEXT NOT NULL DEFAULT '',
      role_name TEXT NOT NULL DEFAULT '',
      interview_stage TEXT NOT NULL DEFAULT '未知',
      quality_score INTEGER NOT NULL DEFAULT 0,
      is_valid INTEGER NOT NULL DEFAULT 1,
      clean_status TEXT NOT NULL DEFAULT 'pending',
      crawl_job_id TEXT,
      content_hash TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_experience_post_source_unique
      ON experience_post(source_platform, source_post_id);
    CREATE INDEX IF NOT EXISTS idx_experience_post_published
      ON experience_post(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_experience_post_job
      ON experience_post(crawl_job_id);
    CREATE INDEX IF NOT EXISTS idx_experience_post_company_role
      ON experience_post(company_name, role_name, published_at DESC);

    CREATE TABLE IF NOT EXISTS experience_question_group (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      topic_cluster TEXT NOT NULL DEFAULT '',
      canonical_question TEXT NOT NULL DEFAULT '',
      group_order INTEGER NOT NULL DEFAULT 0,
      group_type TEXT NOT NULL DEFAULT 'single',
      frequency_score REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_experience_question_group_post
      ON experience_question_group(post_id, group_order ASC);

    CREATE TABLE IF NOT EXISTS experience_question_item (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      question_text_raw TEXT NOT NULL,
      question_text_normalized TEXT NOT NULL DEFAULT '',
      question_role TEXT NOT NULL DEFAULT 'main',
      order_in_group INTEGER NOT NULL DEFAULT 0,
      parent_item_id TEXT,
      category TEXT NOT NULL DEFAULT '其他',
      difficulty TEXT NOT NULL DEFAULT 'medium',
      follow_up_intent TEXT NOT NULL DEFAULT 'clarify',
      expected_points_json TEXT NOT NULL DEFAULT '[]',
      knowledge_points_json TEXT NOT NULL DEFAULT '[]',
      embedding_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_experience_question_item_post
      ON experience_question_item(post_id, order_in_group ASC);
    CREATE INDEX IF NOT EXISTS idx_experience_question_item_group
      ON experience_question_item(group_id, order_in_group ASC);
    CREATE INDEX IF NOT EXISTS idx_experience_question_item_category
      ON experience_question_item(category, difficulty);
    CREATE INDEX IF NOT EXISTS idx_experience_question_item_role
      ON experience_question_item(question_role);
  `);
};

const upsertUser = ({
  id,
  name,
  resume_summary,
  active_resume_file,
  active_jd_file,
}) => {
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT id, name, resume_summary, active_resume_file, active_jd_file FROM user_profile WHERE id = ?')
    .get(id);

  if (existing) {
    const nextName = name !== undefined ? name : existing.name;
    const nextResumeSummary = resume_summary !== undefined ? resume_summary : existing.resume_summary;
    const nextActiveResumeFile = active_resume_file !== undefined ? active_resume_file : existing.active_resume_file;
    const nextActiveJdFile = active_jd_file !== undefined ? active_jd_file : existing.active_jd_file;

    db.prepare(
      `
      UPDATE user_profile
      SET name = ?, resume_summary = ?, active_resume_file = ?, active_jd_file = ?, updated_at = ?
      WHERE id = ?
    `
    ).run(nextName, nextResumeSummary, nextActiveResumeFile, nextActiveJdFile, now, id);
    return { id, updated_at: now, created: false };
  }

  db.prepare(
    `
    INSERT INTO user_profile (id, name, resume_summary, active_resume_file, active_jd_file, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
  ).run(id, name || '', resume_summary || '', active_resume_file || '', active_jd_file || '', now, now);

  return { id, updated_at: now, created: true };
};

const getUserById = (id) =>
  db
    .prepare(
      `
      SELECT id, name, resume_summary, active_resume_file, active_jd_file, created_at, updated_at
      FROM user_profile
      WHERE id = ?
    `,
    )
    .get(id);

const setActiveResumeFile = ({ userId, fileName, resumeSummary }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE user_profile
    SET active_resume_file = ?, resume_summary = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(fileName, resumeSummary, now, userId);
  return getUserById(userId);
};

const setActiveJdFile = ({ userId, fileName }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE user_profile
    SET active_jd_file = ?, updated_at = ?
    WHERE id = ?
  `
  ).run(fileName, now, userId);
  return getUserById(userId);
};

const saveScoringResult = ({
  attemptId,
  scoreReportId,
  userId,
  mode,
  question,
  answer,
  evidenceRefs,
  score,
  strengths,
  weaknesses,
  feedback,
  weaknessRows,
}) => {
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO attempt (id, user_id, mode, question, answer, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(attemptId, userId, mode, question, answer, now);

    const insertEvidence = db.prepare(
      `
      INSERT INTO evidence_ref (id, attempt_id, source_type, source_uri, quote, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    );
    for (const row of evidenceRefs) {
      insertEvidence.run(
        row.id,
        attemptId,
        row.source_type,
        row.source_uri,
        row.quote,
        row.confidence,
      );
    }

    db.prepare(
      `
      INSERT INTO score_report (id, attempt_id, score, strengths_json, weaknesses_json, feedback, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      scoreReportId,
      attemptId,
      score,
      JSON.stringify(strengths),
      JSON.stringify(weaknesses),
      feedback,
      now,
    );

    const findWeakness = db.prepare(
      'SELECT id, hit_count FROM weakness_tag WHERE user_id = ? AND tag = ?',
    );
    const updateWeakness = db.prepare(
      'UPDATE weakness_tag SET hit_count = ?, last_seen_at = ? WHERE id = ?',
    );
    const insertWeakness = db.prepare(
      'INSERT INTO weakness_tag (id, user_id, tag, hit_count, last_seen_at) VALUES (?, ?, ?, ?, ?)',
    );

    for (const w of weaknessRows) {
      const existing = findWeakness.get(userId, w.tag);
      if (existing) {
        updateWeakness.run(existing.hit_count + 1, now, existing.id);
      } else {
        insertWeakness.run(w.id, userId, w.tag, 1, now);
      }
    }
  });

  tx();
};

const getWeaknessesByUser = (userId, limit = 20) =>
  db
    .prepare(
      `
      SELECT tag, hit_count, last_seen_at
      FROM weakness_tag
      WHERE user_id = ?
      ORDER BY hit_count DESC, last_seen_at DESC
      LIMIT ?
    `,
    )
    .all(userId, limit);

const listAttemptsByUser = (userId, limit = 20) =>
  db
    .prepare(
      `
      SELECT a.id, a.user_id, a.mode, a.question, a.answer, a.created_at, sr.score
      FROM attempt a
      LEFT JOIN score_report sr ON sr.attempt_id = a.id
      WHERE a.user_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `,
    )
    .all(userId, limit);

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
      strengths: JSON.parse(row.strengths_json || '[]'),
      weaknesses: JSON.parse(row.weaknesses_json || '[]'),
    }));

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
    tags: JSON.parse(row.tags_json || '[]'),
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
    tags: JSON.parse(row.tags_json || '[]'),
  }));
};

const markQuestionReviewed = ({ questionId, reviewStatus, nextReviewAt }) => {
  const now = new Date().toISOString();
  const row = db
    .prepare('SELECT id FROM question_bank WHERE id = ?')
    .get(questionId);
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

const saveInterviewQuestions = ({ sessionId, items }) => {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `
    INSERT INTO interview_question
    (id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    // 先整体挪到高位，再回落，避免 order_no 唯一索引在逐行更新时冲突。
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
      (id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, created_at, updated_at
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
      SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, created_at, updated_at
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

const getNextInterviewQuestion = (sessionId) =>
  normalizeInterviewQuestionRow(
    db
    .prepare(
      `
      SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, created_at, updated_at
      FROM interview_question
      WHERE session_id = ? AND status != 'answered'
      ORDER BY order_no ASC
      LIMIT 1
    `,
    )
    .get(sessionId),
  );

const normalizeInterviewQuestionRow = (row) =>
  row
    ? {
      ...row,
      expected_points: JSON.parse(row.expected_points_json || '[]'),
    }
    : null;

const createChatSession = ({ id, userId, title }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO chat_session (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(id, userId, title || '', now, now);
  return { id, user_id: userId, title: title || '', created_at: now, updated_at: now };
};

const getChatSession = (sessionId) =>
  db
    .prepare(
      `
      SELECT id, user_id, title, created_at, updated_at
      FROM chat_session
      WHERE id = ?
    `,
    )
    .get(sessionId);

const addChatMessage = ({ id, sessionId, role, content }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO chat_message (id, session_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(id, sessionId, role, content, now);
  db.prepare('UPDATE chat_session SET updated_at = ? WHERE id = ?').run(now, sessionId);
  return { id, session_id: sessionId, role, content, created_at: now };
};

const listChatMessages = (sessionId, limit = 100) =>
  db
    .prepare(
      `
      SELECT id, session_id, role, content, created_at
      FROM chat_message
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `,
    )
    .all(sessionId, limit);

const createExperienceSyncJob = ({ id, userId, keyword, requestedLimit = 10 }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO experience_sync_job (
      id, user_id, keyword, status, requested_limit,
      created_count, skipped_count, failed_count,
      started_at, finished_at, error_message, created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', ?, 0, 0, 0, NULL, NULL, '', ?, ?)
  `,
  ).run(id, userId, keyword, requestedLimit, now, now);
  return getExperienceSyncJobById(id);
};

const updateExperienceSyncJob = ({
  jobId,
  status,
  createdCount,
  skippedCount,
  failedCount,
  startedAt,
  finishedAt,
  errorMessage,
}) => {
  const current = getExperienceSyncJobById(jobId);
  if (!current) return null;

  const next = {
    status: status !== undefined ? status : current.status,
    createdCount: createdCount !== undefined ? createdCount : current.created_count,
    skippedCount: skippedCount !== undefined ? skippedCount : current.skipped_count,
    failedCount: failedCount !== undefined ? failedCount : current.failed_count,
    startedAt: startedAt !== undefined ? startedAt : current.started_at,
    finishedAt: finishedAt !== undefined ? finishedAt : current.finished_at,
    errorMessage: errorMessage !== undefined ? errorMessage : current.error_message,
  };

  db.prepare(
    `
    UPDATE experience_sync_job
    SET status = ?, created_count = ?, skipped_count = ?, failed_count = ?,
        started_at = ?, finished_at = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    next.status,
    next.createdCount,
    next.skippedCount,
    next.failedCount,
    next.startedAt,
    next.finishedAt,
    next.errorMessage,
    new Date().toISOString(),
    jobId,
  );

  return getExperienceSyncJobById(jobId);
};

const getExperienceSyncJobById = (jobId) =>
  db
    .prepare(
      `
      SELECT id, user_id, keyword, status, requested_limit,
             created_count, skipped_count, failed_count,
             started_at, finished_at, error_message, created_at, updated_at
      FROM experience_sync_job
      WHERE id = ?
    `,
    )
    .get(jobId);

const getExperiencePostBySource = ({ sourcePlatform, sourcePostId }) =>
  db
    .prepare(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE source_platform = ? AND source_post_id = ?
    `,
    )
    .get(sourcePlatform, sourcePostId);

const insertExperiencePostWithGroups = ({ post, groups = [] }) => {
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO experience_post (
        id, source_platform, source_post_id, source_url, keyword, title, author_name,
        published_at, content_raw, content_cleaned, summary, company_name, role_name,
        interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      post.id,
      post.source_platform,
      post.source_post_id,
      post.source_url,
      post.keyword || '',
      post.title || '',
      post.author_name || '',
      post.published_at || '',
      post.content_raw || '',
      post.content_cleaned || '',
      post.summary || '',
      post.company_name || '',
      post.role_name || '',
      post.interview_stage || '未知',
      Number(post.quality_score || 0),
      post.is_valid ? 1 : 0,
      post.clean_status || 'completed',
      post.crawl_job_id || null,
      post.content_hash || '',
      post.created_at || now,
      post.updated_at || now,
    );

    for (const group of groups) {
      db.prepare(
        `
        INSERT INTO experience_question_group (
          id, post_id, topic_cluster, canonical_question, group_order,
          group_type, frequency_score, confidence, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        group.id,
        post.id,
        group.topic_cluster || '',
        group.canonical_question || '',
        Number(group.group_order || 0),
        group.group_type || 'single',
        Number(group.frequency_score || 0),
        Number(group.confidence || 0),
        now,
        now,
      );

      for (const item of group.items || []) {
        db.prepare(
          `
          INSERT INTO experience_question_item (
            id, group_id, post_id, question_text_raw, question_text_normalized, question_role,
            order_in_group, parent_item_id, category, difficulty, follow_up_intent,
            expected_points_json, knowledge_points_json, embedding_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          item.id,
          group.id,
          post.id,
          item.question_text_raw || '',
          item.question_text_normalized || '',
          item.question_role || 'main',
          Number(item.order_in_group || 0),
          item.parent_item_id || null,
          item.category || '其他',
          item.difficulty || 'medium',
          item.follow_up_intent || 'clarify',
          JSON.stringify(item.expected_points || []),
          JSON.stringify(item.knowledge_points || []),
          item.embedding_id || '',
          now,
          now,
        );
      }
    }
  });

  transaction();

  return getExperiencePostDetail(post.id);
};

const listExperiencePosts = ({
  query,
  days,
  company,
  role,
  onlyValid = true,
  limit = 20,
  offset = 0,
}) => {
  const where = [];
  const params = [];

  if (onlyValid) {
    where.push('p.is_valid = 1');
  }

  if (query) {
    where.push(`(
      p.title LIKE ? OR
      p.summary LIKE ? OR
      p.content_cleaned LIKE ? OR
      EXISTS (
        SELECT 1 FROM experience_question_item qi
        WHERE qi.post_id = p.id
          AND (qi.question_text_raw LIKE ? OR qi.question_text_normalized LIKE ?)
      )
    )`);
    const like = `%${query}%`;
    params.push(like, like, like, like, like);
  }

  if (company) {
    where.push('p.company_name LIKE ?');
    params.push(`%${company}%`);
  }

  if (role) {
    where.push('p.role_name LIKE ?');
    params.push(`%${role}%`);
  }

  if (Number(days) > 0) {
    where.push(`datetime(substr(p.published_at, 1, 19)) >= datetime('now', ?)`);
    params.push(`-${Number(days)} days`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const items = db
    .prepare(
      `
      SELECT
        p.id, p.title, p.source_platform, p.source_url, p.company_name, p.role_name,
        p.interview_stage, p.published_at, p.summary, p.quality_score,
        COUNT(DISTINCT g.id) AS question_group_count,
        COUNT(DISTINCT qi.id) AS question_item_count
      FROM experience_post p
      LEFT JOIN experience_question_group g ON g.post_id = p.id
      LEFT JOIN experience_question_item qi ON qi.post_id = p.id
      ${whereClause}
      GROUP BY p.id
      ORDER BY datetime(substr(p.published_at, 1, 19)) DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM experience_post p
      ${whereClause}
    `,
    )
    .get(...params);

  return {
    items,
    total: totalRow?.total || 0,
  };
};

const getExperiencePostDetail = (postId) => {
  const post = db
    .prepare(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE id = ?
    `,
    )
    .get(postId);

  if (!post) return null;

  const groups = db
    .prepare(
      `
      SELECT id, post_id, topic_cluster, canonical_question, group_order,
             group_type, frequency_score, confidence, created_at, updated_at
      FROM experience_question_group
      WHERE post_id = ?
      ORDER BY group_order ASC, created_at ASC
    `,
    )
    .all(postId)
    .map((group) => ({
      ...group,
      items: db
        .prepare(
          `
          SELECT id, group_id, post_id, question_text_raw, question_text_normalized, question_role,
                 order_in_group, parent_item_id, category, difficulty, follow_up_intent,
                 expected_points_json, knowledge_points_json, embedding_id, created_at, updated_at
          FROM experience_question_item
          WHERE group_id = ?
          ORDER BY order_in_group ASC, created_at ASC
        `,
        )
        .all(group.id)
        .map((item) => ({
          ...item,
          expected_points: parseJsonArray(item.expected_points_json),
          knowledge_points: parseJsonArray(item.knowledge_points_json),
        })),
    }));

  return {
    ...post,
    groups,
  };
};

const searchExperienceQuestionItems = ({ query, limit = 10 }) => {
  const like = `%${String(query || '').trim()}%`;
  return db
    .prepare(
      `
      SELECT
        qi.id, qi.post_id, qi.group_id, qi.question_text_normalized, qi.question_role,
        qi.category, qi.difficulty, p.title AS source_post_title, p.source_url,
        p.company_name, p.role_name, p.published_at
      FROM experience_question_item qi
      INNER JOIN experience_post p ON p.id = qi.post_id
      WHERE p.is_valid = 1
        AND (
          qi.question_text_raw LIKE ?
          OR qi.question_text_normalized LIKE ?
          OR p.title LIKE ?
          OR p.summary LIKE ?
        )
      ORDER BY datetime(substr(p.published_at, 1, 19)) DESC, qi.created_at DESC
      LIMIT ?
    `,
    )
    .all(like, like, like, like, limit);
};

module.exports = {
  DB_PATH,
  init,
  getUserById,
  upsertUser,
  setActiveResumeFile,
  setActiveJdFile,
  saveScoringResult,
  getWeaknessesByUser,
  listAttemptsByUser,
  createInterviewSession,
  getInterviewSession,
  listInterviewSessions,
  addInterviewTurn,
  listInterviewTurns,
  finishInterviewSession,
  saveQuestionBankItems,
  listQuestionBank,
  listPracticeQuestions,
  markQuestionReviewed,
  saveInterviewQuestions,
  insertInterviewQuestionAfter,
  listInterviewQuestions,
  getInterviewQuestionById,
  updateInterviewQuestionStatus,
  getNextInterviewQuestion,
  createChatSession,
  getChatSession,
  addChatMessage,
  listChatMessages,
  createExperienceSyncJob,
  updateExperienceSyncJob,
  getExperienceSyncJobById,
  getExperiencePostBySource,
  insertExperiencePostWithGroups,
  listExperiencePosts,
  getExperiencePostDetail,
  searchExperienceQuestionItems,
};
