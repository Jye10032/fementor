const { db, ensureColumn } = require('./core');

const registerBaseTables = () => {
  // 用户画像、评分结果、题库兼容层、聊天会话等基础表。
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
};

const registerInterviewTables = () => {
  // 模拟面试题目队列表。
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
};

const ensureLegacyColumns = () => {
  // 兼容已有本地数据库，为旧表补齐增量字段。
  ensureColumn('user_profile', 'active_resume_file', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('user_profile', 'active_jd_file', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('interview_turn', 'question_id', 'TEXT');
  ensureColumn('question_bank', 'source_question_id', 'TEXT');
  ensureColumn('question_bank', 'source_question_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('question_bank', 'source_question_source', "TEXT NOT NULL DEFAULT ''");
};

const registerExperienceTables = () => {
  // 面经同步任务、帖子、问题组、问题项表。
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

const registerQuestionSourceTables = () => {
  // 三层题库模型：公共题源层、用户题库层、练习记录层。
  db.exec(`
    -- 三层题库模型：公共题源层。
    CREATE TABLE IF NOT EXISTS question_source (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_ref_id TEXT NOT NULL,
      canonical_question TEXT NOT NULL,
      question_text TEXT NOT NULL,
      normalized_question TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'medium',
      track TEXT NOT NULL DEFAULT '',
      chapter TEXT NOT NULL DEFAULT '',
      knowledge_points_json TEXT NOT NULL DEFAULT '[]',
      expected_points_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      merged_into_source_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_question_source_source_ref
      ON question_source(source_type, source_ref_id);
    CREATE INDEX IF NOT EXISTS idx_question_source_track_chapter
      ON question_source(track, chapter, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_question_source_canonical
      ON question_source(canonical_question, track, chapter);

    -- 三层题库模型：用户题库层。
    CREATE TABLE IF NOT EXISTS user_question_bank (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      question_source_id TEXT NOT NULL,
      track TEXT NOT NULL DEFAULT '',
      chapter TEXT NOT NULL DEFAULT '',
      custom_question_text TEXT NOT NULL DEFAULT '',
      review_status TEXT NOT NULL DEFAULT 'pending',
      mastery_level INTEGER NOT NULL DEFAULT 0,
      weakness_tag TEXT NOT NULL DEFAULT '',
      next_review_at TEXT,
      last_practiced_at TEXT,
      is_favorited INTEGER NOT NULL DEFAULT 0,
      source_channel TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_question_bank_user_source
      ON user_question_bank(user_id, question_source_id);
    CREATE INDEX IF NOT EXISTS idx_user_question_bank_user_chapter
      ON user_question_bank(user_id, chapter, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_question_bank_user_review
      ON user_question_bank(user_id, review_status, next_review_at);

    -- 三层题库模型：练习记录层。
    CREATE TABLE IF NOT EXISTS question_attempt (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_question_bank_id TEXT NOT NULL,
      session_type TEXT NOT NULL,
      session_id TEXT,
      answer TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      strengths_json TEXT NOT NULL DEFAULT '[]',
      weaknesses_json TEXT NOT NULL DEFAULT '[]',
      evidence_refs_json TEXT NOT NULL DEFAULT '[]',
      feedback TEXT NOT NULL DEFAULT '',
      mastered INTEGER NOT NULL DEFAULT 0,
      next_review_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_question_attempt_user_bank_created
      ON question_attempt(user_question_bank_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_question_attempt_user_created
      ON question_attempt(user_id, created_at DESC);

    -- 本地公共题源同步状态表。
    CREATE TABLE IF NOT EXISTS public_source_sync_state (
      id TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      last_synced_at TEXT,
      last_server_time TEXT,
      last_sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error_message TEXT NOT NULL DEFAULT '',
      local_item_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_public_source_sync_state_source_name
      ON public_source_sync_state(source_name);
  `);
};

const init = () => {
  registerBaseTables();
  registerInterviewTables();
  ensureLegacyColumns();
  registerExperienceTables();
  registerQuestionSourceTables();
};

module.exports = {
  init,
  registerBaseTables,
  registerInterviewTables,
  ensureLegacyColumns,
  registerExperienceTables,
  registerQuestionSourceTables,
};
