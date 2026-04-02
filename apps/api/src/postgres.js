const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = String(process.env.DATABASE_URL || process.env.SUPABASE || '').trim();
const APP_PUBLIC_TABLES = [
  'users',
  'resume_parse_usage',
  'resume_parse_cache',
  'interview_session',
  'interview_turn',
  'interview_question',
  'chat_session',
  'chat_message',
  'question_source',
  'user_question_bank',
  'question_attempt',
  'public_source_sync_state',
  'attempt',
  'evidence_ref',
  'score_report',
  'weakness_tag',
  'experience_sync_job',
  'experience_post',
  'experience_question_group',
  'experience_question_item',
];

function getNormalizedRole(value) {
  return String(value || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';
}

function getAdminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function resolveUserRoleByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return 'user';
  }
  return getAdminEmails().includes(normalizedEmail) ? 'admin' : 'user';
}

let pool = null;
let initPromise = null;

function isPostgresEnabled() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!isPostgresEnabled()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL_DISABLE === '1' ? false : { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function withClient(callback) {
  await initPostgres();
  const client = await getPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function enableRowLevelSecurity(client) {
  for (const tableName of APP_PUBLIC_TABLES) {
    await client.query(`ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY`);
  }
}

async function initPostgres() {
  if (!isPostgresEnabled()) {
    return { enabled: false };
  }

  if (!initPromise) {
    initPromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id text PRIMARY KEY,
            clerk_user_id text UNIQUE NOT NULL,
            email text,
            name text,
            avatar_url text,
            role text NOT NULL DEFAULT 'user',
            plan text NOT NULL DEFAULT 'free',
            status text NOT NULL DEFAULT 'active',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE TABLE IF NOT EXISTS resume_parse_usage (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            file_hash text,
            source_type text NOT NULL,
            engine text,
            status text NOT NULL,
            charged boolean NOT NULL DEFAULT false,
            failure_reason text,
            created_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE TABLE IF NOT EXISTS resume_parse_cache (
            id text PRIMARY KEY,
            user_id text,
            file_hash text UNIQUE NOT NULL,
            source_type text NOT NULL,
            parsed_text text NOT NULL,
            summary text NOT NULL,
            parse_meta jsonb,
            original_filename text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users(clerk_user_id);
          CREATE INDEX IF NOT EXISTS idx_resume_parse_usage_user_created ON resume_parse_usage(user_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_resume_parse_usage_user_source_created ON resume_parse_usage(user_id, source_type, created_at DESC);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_parse_cache_file_hash ON resume_parse_cache(file_hash);
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS interview_session (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            status text NOT NULL,
            summary text NOT NULL DEFAULT '',
            started_at timestamptz NOT NULL,
            ended_at timestamptz,
            keyword_queue_json text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_interview_session_user_created
            ON interview_session(user_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS interview_turn (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            question_id text,
            turn_index integer NOT NULL,
            question text NOT NULL,
            answer text NOT NULL,
            score integer NOT NULL DEFAULT 0,
            strengths_json text NOT NULL,
            weaknesses_json text NOT NULL,
            evidence_refs_count integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_turn_session_turn_index
            ON interview_turn(session_id, turn_index);

          CREATE TABLE IF NOT EXISTS interview_question (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            order_no integer NOT NULL,
            source text NOT NULL DEFAULT 'llm',
            question_type text NOT NULL DEFAULT 'basic',
            difficulty text NOT NULL DEFAULT 'medium',
            stem text NOT NULL,
            expected_points_json text NOT NULL DEFAULT '[]',
            resume_anchor text NOT NULL DEFAULT '',
            source_ref text NOT NULL DEFAULT '',
            status text NOT NULL DEFAULT 'pending',
            keyword text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_question_session_order
            ON interview_question(session_id, order_no);
          CREATE INDEX IF NOT EXISTS idx_interview_question_session_status
            ON interview_question(session_id, status, order_no);

          CREATE TABLE IF NOT EXISTS chat_session (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            title text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_chat_session_user_updated
            ON chat_session(user_id, updated_at DESC);

          CREATE TABLE IF NOT EXISTS chat_message (
            id text PRIMARY KEY,
            session_id text NOT NULL,
            role text NOT NULL,
            content text NOT NULL,
            created_at timestamptz NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_chat_message_session_created
            ON chat_message(session_id, created_at ASC);

          CREATE TABLE IF NOT EXISTS question_source (
            id text PRIMARY KEY,
            source_type text NOT NULL,
            source_ref_id text NOT NULL,
            canonical_question text NOT NULL,
            question_text text NOT NULL,
            normalized_question text NOT NULL DEFAULT '',
            category text NOT NULL DEFAULT '',
            difficulty text NOT NULL DEFAULT 'medium',
            track text NOT NULL DEFAULT '',
            chapter text NOT NULL DEFAULT '',
            knowledge_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            expected_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
            status text NOT NULL DEFAULT 'active',
            merged_into_source_id text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_question_source_source_ref
            ON question_source(source_type, source_ref_id);
          CREATE INDEX IF NOT EXISTS idx_question_source_track_chapter
            ON question_source(track, chapter, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_question_source_canonical
            ON question_source(canonical_question, track, chapter);

          CREATE TABLE IF NOT EXISTS user_question_bank (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            question_source_id text NOT NULL,
            track text NOT NULL DEFAULT '',
            chapter text NOT NULL DEFAULT '',
            custom_question_text text NOT NULL DEFAULT '',
            review_status text NOT NULL DEFAULT 'pending',
            mastery_level integer NOT NULL DEFAULT 0,
            weakness_tag text NOT NULL DEFAULT '',
            next_review_at timestamptz,
            last_practiced_at timestamptz,
            is_favorited boolean NOT NULL DEFAULT false,
            source_channel text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_user_question_bank_user_source
            ON user_question_bank(user_id, question_source_id);
          CREATE INDEX IF NOT EXISTS idx_user_question_bank_user_chapter
            ON user_question_bank(user_id, chapter, updated_at DESC);
          CREATE INDEX IF NOT EXISTS idx_user_question_bank_user_review
            ON user_question_bank(user_id, review_status, next_review_at);

          CREATE TABLE IF NOT EXISTS question_attempt (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            user_question_bank_id text NOT NULL,
            session_type text NOT NULL,
            session_id text,
            answer text NOT NULL DEFAULT '',
            score integer NOT NULL DEFAULT 0,
            strengths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            weaknesses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            evidence_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            feedback text NOT NULL DEFAULT '',
            mastered boolean NOT NULL DEFAULT false,
            next_review_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS idx_question_attempt_user_question_bank_created
            ON question_attempt(user_question_bank_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS public_source_sync_state (
            id text PRIMARY KEY,
            source_name text NOT NULL,
            last_synced_at timestamptz,
            last_server_time timestamptz,
            last_sync_status text NOT NULL DEFAULT 'idle',
            last_error_message text NOT NULL DEFAULT '',
            local_item_count integer NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_public_source_sync_state_source_name
            ON public_source_sync_state(source_name);

          CREATE TABLE IF NOT EXISTS attempt (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            mode text NOT NULL,
            question text NOT NULL,
            answer text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS idx_attempt_user_created
            ON attempt(user_id, created_at DESC);

          CREATE TABLE IF NOT EXISTS evidence_ref (
            id text PRIMARY KEY,
            attempt_id text NOT NULL,
            source_type text NOT NULL,
            source_uri text NOT NULL,
            quote text NOT NULL,
            confidence double precision
          );

          CREATE INDEX IF NOT EXISTS idx_evidence_ref_attempt
            ON evidence_ref(attempt_id);

          CREATE TABLE IF NOT EXISTS score_report (
            id text PRIMARY KEY,
            attempt_id text NOT NULL,
            score integer NOT NULL DEFAULT 0,
            strengths_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            weaknesses_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            feedback text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_score_report_attempt
            ON score_report(attempt_id);

          CREATE TABLE IF NOT EXISTS weakness_tag (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            tag text NOT NULL,
            hit_count integer NOT NULL DEFAULT 0,
            last_seen_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_weakness_tag_user_tag
            ON weakness_tag(user_id, tag);
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS experience_sync_job (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            keyword text NOT NULL,
            status text NOT NULL,
            requested_limit integer NOT NULL DEFAULT 10,
            created_count integer NOT NULL DEFAULT 0,
            updated_count integer NOT NULL DEFAULT 0,
            skipped_count integer NOT NULL DEFAULT 0,
            failed_count integer NOT NULL DEFAULT 0,
            started_at timestamptz,
            finished_at timestamptz,
            error_message text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS idx_experience_sync_job_user_created
            ON experience_sync_job(user_id, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_experience_sync_job_status
            ON experience_sync_job(status, updated_at DESC);

          CREATE TABLE IF NOT EXISTS experience_post (
            id text PRIMARY KEY,
            source_platform text NOT NULL,
            source_post_id text NOT NULL,
            source_url text NOT NULL,
            keyword text NOT NULL DEFAULT '',
            title text NOT NULL,
            author_name text NOT NULL DEFAULT '',
            published_at timestamptz,
            content_raw text NOT NULL,
            content_cleaned text NOT NULL DEFAULT '',
            summary text NOT NULL DEFAULT '',
            company_name text NOT NULL DEFAULT '',
            role_name text NOT NULL DEFAULT '',
            interview_stage text NOT NULL DEFAULT '未知',
            quality_score integer NOT NULL DEFAULT 0,
            popularity integer NOT NULL DEFAULT 0,
            is_valid boolean NOT NULL DEFAULT true,
            clean_status text NOT NULL DEFAULT 'pending',
            crawl_job_id text,
            content_hash text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
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
            id text PRIMARY KEY,
            post_id text NOT NULL,
            topic_cluster text NOT NULL DEFAULT '',
            canonical_question text NOT NULL DEFAULT '',
            group_order integer NOT NULL DEFAULT 0,
            group_type text NOT NULL DEFAULT 'single',
            frequency_score double precision NOT NULL DEFAULT 0,
            confidence double precision NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );

          CREATE INDEX IF NOT EXISTS idx_experience_question_group_post
            ON experience_question_group(post_id, group_order ASC);

          CREATE TABLE IF NOT EXISTS experience_question_item (
            id text PRIMARY KEY,
            group_id text NOT NULL,
            post_id text NOT NULL,
            question_text_raw text NOT NULL,
            question_text_normalized text NOT NULL DEFAULT '',
            question_role text NOT NULL DEFAULT 'main',
            order_in_group integer NOT NULL DEFAULT 0,
            parent_item_id text,
            category text NOT NULL DEFAULT '其他',
            difficulty text NOT NULL DEFAULT 'medium',
            follow_up_intent text NOT NULL DEFAULT 'clarify',
            expected_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            knowledge_points_json jsonb NOT NULL DEFAULT '[]'::jsonb,
            embedding_id text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
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
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
        `);
        await client.query(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS resume_summary text NOT NULL DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS active_resume_file text NOT NULL DEFAULT '';
          ALTER TABLE users ADD COLUMN IF NOT EXISTS active_jd_file text NOT NULL DEFAULT '';
        `);
        await client.query(`
          ALTER TABLE experience_sync_job
          ADD COLUMN IF NOT EXISTS updated_count integer NOT NULL DEFAULT 0;
        `);
        await client.query(`
          ALTER TABLE users ADD COLUMN IF NOT EXISTS resume_structured_json text NOT NULL DEFAULT '';
          ALTER TABLE experience_question_group ADD COLUMN IF NOT EXISTS embedding_json text NOT NULL DEFAULT '';
          ALTER TABLE experience_question_item ADD COLUMN IF NOT EXISTS chain_anchor text NOT NULL DEFAULT 'generic';
        `);
        await client.query(`
          ALTER TABLE experience_post ADD COLUMN IF NOT EXISTS popularity integer NOT NULL DEFAULT 0;
        `);
        await enableRowLevelSecurity(client);
      } finally {
        client.release();
      }

      return { enabled: true };
    })();
  }

  return initPromise;
}

function normalizeAppUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    role: getNormalizedRole(row.role),
    resume_summary: String(row.resume_summary || ''),
    resume_structured_json: String(row.resume_structured_json || ''),
    active_resume_file: String(row.active_resume_file || ''),
    active_jd_file: String(row.active_jd_file || ''),
  };
}

function normalizeProfileRow(row, fallbackUserId = '') {
  if (!row) {
    return null;
  }

  const resolvedUserId = String(row.clerk_user_id || fallbackUserId || row.id || '');
  return {
    id: resolvedUserId,
    name: row.name || '',
    resume_summary: String(row.resume_summary || ''),
    resume_structured_json: String(row.resume_structured_json || ''),
    active_resume_file: String(row.active_resume_file || ''),
    active_jd_file: String(row.active_jd_file || ''),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeQuestionSourceRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    knowledge_points: parseJsonArray(row.knowledge_points_json),
    expected_points: parseJsonArray(row.expected_points_json),
    metadata: parseJsonObject(row.metadata_json),
  };
}

function normalizeUserQuestionBankRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    is_favorited: Boolean(row.is_favorited),
  };
}

function normalizeQuestionAttemptRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    strengths: parseJsonArray(row.strengths_json),
    weaknesses: parseJsonArray(row.weaknesses_json),
    evidence_refs: parseJsonArray(row.evidence_refs_json),
    mastered: Boolean(row.mastered),
  };
}

async function getAppUserByClerkUserId(clerkUserId) {
  if (!isPostgresEnabled() || !clerkUserId) {
    return null;
  }

  await initPostgres();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `
      SELECT id, clerk_user_id, email, name, avatar_url, role, plan, status,
             resume_summary, resume_structured_json, active_resume_file, active_jd_file,
             created_at, updated_at
      FROM users
      WHERE clerk_user_id = $1
      LIMIT 1
      `,
      [clerkUserId],
    );
    return normalizeAppUserRow(result.rows[0] || null);
  } finally {
    client.release();
  }
}

async function getUserProfileByAuthUserId(userId) {
  if (!isPostgresEnabled() || !userId) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, clerk_user_id, name, resume_summary, resume_structured_json,
             active_resume_file, active_jd_file, created_at, updated_at
      FROM users
      WHERE clerk_user_id = $1
      LIMIT 1
      `,
      [userId],
    );
    return normalizeProfileRow(result.rows[0] || null, userId);
  });
}

async function upsertUserProfile({
  userId,
  name,
  resumeSummary,
  resumeStructuredJson,
  activeResumeFile,
  activeJdFile,
}) {
  if (!isPostgresEnabled() || !userId) {
    return null;
  }

  return withClient(async (client) => {
    const existing = await client.query(
      `
      SELECT id, clerk_user_id, name, resume_summary, resume_structured_json,
             active_resume_file, active_jd_file, created_at, updated_at
      FROM users
      WHERE clerk_user_id = $1
      LIMIT 1
      `,
      [userId],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      const updated = await client.query(
        `
        UPDATE users
        SET name = $2,
            resume_summary = $3,
            resume_structured_json = $4,
            active_resume_file = $5,
            active_jd_file = $6,
            updated_at = now()
        WHERE clerk_user_id = $1
        RETURNING id, clerk_user_id, name, resume_summary, resume_structured_json,
                  active_resume_file, active_jd_file, created_at, updated_at
        `,
        [
          userId,
          name !== undefined ? String(name || '') : String(row.name || ''),
          resumeSummary !== undefined ? String(resumeSummary || '') : String(row.resume_summary || ''),
          resumeStructuredJson !== undefined
            ? String(resumeStructuredJson || '')
            : String(row.resume_structured_json || ''),
          activeResumeFile !== undefined ? String(activeResumeFile || '') : String(row.active_resume_file || ''),
          activeJdFile !== undefined ? String(activeJdFile || '') : String(row.active_jd_file || ''),
        ],
      );
      return normalizeProfileRow(updated.rows[0] || row, userId);
    }

    const inserted = await client.query(
      `
      INSERT INTO users (
        id, clerk_user_id, email, name, avatar_url, role, plan, status,
        resume_summary, resume_structured_json, active_resume_file, active_jd_file
      )
      VALUES ($1, $2, NULL, $3, NULL, 'user', 'free', 'active', $4, $5, $6, $7)
      RETURNING id, clerk_user_id, name, resume_summary, resume_structured_json,
                active_resume_file, active_jd_file, created_at, updated_at
      `,
      [
        randomUUID(),
        userId,
        String(name || ''),
        String(resumeSummary || ''),
        String(resumeStructuredJson || ''),
        String(activeResumeFile || ''),
        String(activeJdFile || ''),
      ],
    );
    return normalizeProfileRow(inserted.rows[0] || null, userId);
  });
}

async function upsertAppUserByClerk({
  clerkUserId,
  email,
  name,
  avatarUrl,
  resumeSummary,
  resumeStructuredJson,
  activeResumeFile,
  activeJdFile,
}) {
  if (!isPostgresEnabled()) {
    return null;
  }

  const role = resolveUserRoleByEmail(email);

  await initPostgres();
  const client = await getPool().connect();
  try {
    const existing = await client.query(
      `
      SELECT id, clerk_user_id, email, name, avatar_url, role, plan, status,
             resume_summary, resume_structured_json, active_resume_file, active_jd_file,
             created_at, updated_at
      FROM users
      WHERE clerk_user_id = $1
      LIMIT 1
      `,
      [clerkUserId],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      const nextResumeSummary = resumeSummary !== undefined ? String(resumeSummary || '') : String(row.resume_summary || '');
      const nextResumeStructuredJson = resumeStructuredJson !== undefined
        ? String(resumeStructuredJson || '')
        : String(row.resume_structured_json || '');
      const nextActiveResumeFile = activeResumeFile !== undefined
        ? String(activeResumeFile || '')
        : String(row.active_resume_file || '');
      const nextActiveJdFile = activeJdFile !== undefined
        ? String(activeJdFile || '')
        : String(row.active_jd_file || '');
      const updated = await client.query(
        `
        UPDATE users
        SET email = $2,
            name = $3,
            avatar_url = $4,
            role = $5,
            resume_summary = $6,
            resume_structured_json = $7,
            active_resume_file = $8,
            active_jd_file = $9,
            updated_at = now()
        WHERE clerk_user_id = $1
        RETURNING id, clerk_user_id, email, name, avatar_url, role, plan, status,
                  resume_summary, resume_structured_json, active_resume_file, active_jd_file,
                  created_at, updated_at
        `,
        [
          clerkUserId,
          email || null,
          name || null,
          avatarUrl || null,
          role,
          nextResumeSummary,
          nextResumeStructuredJson,
          nextActiveResumeFile,
          nextActiveJdFile,
        ],
      );
      return normalizeAppUserRow(updated.rows[0] || row);
    }

    const inserted = await client.query(
      `
      INSERT INTO users (
        id, clerk_user_id, email, name, avatar_url, role, plan, status,
        resume_summary, resume_structured_json, active_resume_file, active_jd_file
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'free', 'active', $7, $8, $9, $10)
      RETURNING id, clerk_user_id, email, name, avatar_url, role, plan, status,
                resume_summary, resume_structured_json, active_resume_file, active_jd_file,
                created_at, updated_at
      `,
      [
        randomUUID(),
        clerkUserId,
        email || null,
        name || null,
        avatarUrl || null,
        role,
        String(resumeSummary || ''),
        String(resumeStructuredJson || ''),
        String(activeResumeFile || ''),
        String(activeJdFile || ''),
      ],
    );
    return normalizeAppUserRow(inserted.rows[0] || null);
  } finally {
    client.release();
  }
}

function normalizeInterviewQuestionRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    expected_points: parseJsonArray(row.expected_points_json),
  };
}

async function createInterviewSessionRecord({ id, userId }) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    const result = await client.query(
      `
      INSERT INTO interview_session (id, user_id, status, summary, started_at, ended_at, keyword_queue_json, created_at, updated_at)
      VALUES ($1, $2, 'in_progress', '', $3::timestamptz, NULL, '', $3::timestamptz, $3::timestamptz)
      RETURNING id, user_id, status, summary, started_at, ended_at, created_at, updated_at, keyword_queue_json
      `,
      [id, userId, now],
    );
    return result.rows[0] || { id, user_id: userId, status: 'in_progress', started_at: now, keyword_queue_json: '' };
  });
}

async function countInterviewSessionsStartedOnUtcDate({ userId, date = new Date() }) {
  if (!isPostgresEnabled() || !userId) {
    return 0;
  }

  const now = new Date(date);
  const utcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const utcEnd = new Date(utcStart);
  utcEnd.setUTCDate(utcEnd.getUTCDate() + 1);

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT COUNT(1)::int AS count
      FROM interview_session
      WHERE user_id = $1
        AND created_at >= $2::timestamptz
        AND created_at < $3::timestamptz
      `,
      [userId, utcStart.toISOString(), utcEnd.toISOString()],
    );
    return Number(result.rows[0]?.count || 0);
  });
}

async function getInterviewSessionById(sessionId) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, user_id, status, summary, started_at, ended_at, created_at, updated_at, keyword_queue_json
      FROM interview_session
      WHERE id = $1
      LIMIT 1
      `,
      [sessionId],
    );
    return result.rows[0] || null;
  });
}

async function listInterviewSessionsByUser({ userId, limit = 20 }) {
  if (!isPostgresEnabled()) {
    return [];
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, user_id, status, summary, started_at, ended_at, created_at, updated_at, keyword_queue_json
      FROM interview_session
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [userId, limit],
    );
    return result.rows;
  });
}

async function addInterviewTurnRecord({
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
}) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      await client.query(
        `
        INSERT INTO interview_turn
        (id, session_id, question_id, turn_index, question, answer, score, strengths_json, weaknesses_json, evidence_refs_count, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
        `,
        [
          id,
          sessionId,
          questionId,
          turnIndex,
          question,
          answer,
          score,
          JSON.stringify(strengths || []),
          JSON.stringify(weaknesses || []),
          evidenceRefsCount,
          now,
        ],
      );
      await client.query(
        `UPDATE interview_session SET updated_at = $2::timestamptz WHERE id = $1`,
        [sessionId, now],
      );
      await client.query('COMMIT');
      return { id, session_id: sessionId, question_id: questionId, turn_index: turnIndex, question, answer, score, created_at: now };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function listInterviewTurnsBySession(sessionId) {
  if (!isPostgresEnabled()) {
    return [];
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, session_id, question_id, turn_index, question, answer, score, strengths_json, weaknesses_json, evidence_refs_count, created_at
      FROM interview_turn
      WHERE session_id = $1
      ORDER BY turn_index ASC
      `,
      [sessionId],
    );

    return result.rows.map((row) => ({
      ...row,
      strengths: parseJsonArray(row.strengths_json),
      weaknesses: parseJsonArray(row.weaknesses_json),
    }));
  });
}

async function finishInterviewSessionRecord({ sessionId, summary }) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    const result = await client.query(
      `
      UPDATE interview_session
      SET status = 'completed', summary = $2, ended_at = $3::timestamptz, updated_at = $3::timestamptz
      WHERE id = $1
      RETURNING id, user_id, status, summary, started_at, ended_at, created_at, updated_at, keyword_queue_json
      `,
      [sessionId, summary || '', now],
    );
    return result.rows[0] || null;
  });
}

async function saveInterviewQuestionsRecord({ sessionId, items }) {
  if (!isPostgresEnabled()) {
    return;
  }

  await withClient(async (client) => {
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM interview_question WHERE session_id = $1`, [sessionId]);
      for (const item of items) {
        await client.query(
          `
          INSERT INTO interview_question
          (id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $13::timestamptz)
          `,
          [
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
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function insertInterviewQuestionAfterRecord({ sessionId, afterOrderNo, item }) {
  if (!isPostgresEnabled()) {
    return;
  }

  await withClient(async (client) => {
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      await client.query(
        `
        UPDATE interview_question
        SET order_no = order_no + 1000, updated_at = $1::timestamptz
        WHERE session_id = $2 AND order_no > $3
        `,
        [now, sessionId, afterOrderNo],
      );
      await client.query(
        `
        UPDATE interview_question
        SET order_no = order_no - 999, updated_at = $1::timestamptz
        WHERE session_id = $2 AND order_no > $3
        `,
        [now, sessionId, afterOrderNo + 1000],
      );
      await client.query(
        `
        INSERT INTO interview_question
        (id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $13::timestamptz)
        `,
        [
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
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function listInterviewQuestionsBySession(sessionId) {
  if (!isPostgresEnabled()) {
    return [];
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at
      FROM interview_question
      WHERE session_id = $1
      ORDER BY order_no ASC
      `,
      [sessionId],
    );
    return result.rows.map(normalizeInterviewQuestionRow);
  });
}

async function getInterviewQuestionByIdRecord(questionId) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at
      FROM interview_question
      WHERE id = $1
      LIMIT 1
      `,
      [questionId],
    );
    return normalizeInterviewQuestionRow(result.rows[0] || null);
  });
}

async function updateInterviewQuestionStatusRecord({ questionId, status }) {
  if (!isPostgresEnabled()) {
    return;
  }

  await withClient(async (client) => {
    await client.query(
      `
      UPDATE interview_question
      SET status = $2, updated_at = now()
      WHERE id = $1
      `,
      [questionId, status],
    );
  });
}

async function deleteInterviewSessionRecord(sessionId) {
  if (!isPostgresEnabled()) {
    return;
  }

  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`DELETE FROM interview_turn WHERE session_id = $1`, [sessionId]);
      await client.query(`DELETE FROM interview_question WHERE session_id = $1`, [sessionId]);
      await client.query(`DELETE FROM interview_session WHERE id = $1`, [sessionId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function getNextInterviewQuestionRecord(sessionId) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, session_id, order_no, source, question_type, difficulty, stem, expected_points_json, resume_anchor, source_ref, status, keyword, created_at, updated_at
      FROM interview_question
      WHERE session_id = $1 AND status != 'answered'
      ORDER BY order_no ASC
      LIMIT 1
      `,
      [sessionId],
    );
    return normalizeInterviewQuestionRow(result.rows[0] || null);
  });
}

async function updateInterviewSessionKeywordQueue({ sessionId, keywordQueueJson }) {
  if (!isPostgresEnabled()) {
    return;
  }

  await withClient(async (client) => {
    await client.query(
      `UPDATE interview_session SET keyword_queue_json = $2, updated_at = now() WHERE id = $1`,
      [sessionId, keywordQueueJson || ''],
    );
  });
}

async function getInterviewSessionKeywordQueue(sessionId) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `SELECT keyword_queue_json FROM interview_session WHERE id = $1 LIMIT 1`,
      [sessionId],
    );
    const raw = result.rows[0]?.keyword_queue_json;
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.entries) ? parsed : null;
    } catch {
      return null;
    }
  });
}

async function createChatSessionRecord({ id, userId, title }) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    const result = await client.query(
      `
      INSERT INTO chat_session (id, user_id, title, created_at, updated_at)
      VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz)
      RETURNING id, user_id, title, created_at, updated_at
      `,
      [id, userId, title || '', now],
    );
    return result.rows[0] || { id, user_id: userId, title: title || '', created_at: now, updated_at: now };
  });
}

async function getChatSessionById(sessionId) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, user_id, title, created_at, updated_at
      FROM chat_session
      WHERE id = $1
      LIMIT 1
      `,
      [sessionId],
    );
    return result.rows[0] || null;
  });
}

async function addChatMessageRecord({ id, sessionId, role, content }) {
  if (!isPostgresEnabled()) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      const inserted = await client.query(
        `
        INSERT INTO chat_message (id, session_id, role, content, created_at)
        VALUES ($1, $2, $3, $4, $5::timestamptz)
        RETURNING id, session_id, role, content, created_at
        `,
        [id, sessionId, role, content, now],
      );
      await client.query(
        `UPDATE chat_session SET updated_at = $2::timestamptz WHERE id = $1`,
        [sessionId, now],
      );
      await client.query('COMMIT');
      return inserted.rows[0] || { id, session_id: sessionId, role, content, created_at: now };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function listChatMessagesBySession(sessionId, limit = 100) {
  if (!isPostgresEnabled()) {
    return [];
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, session_id, role, content, created_at
      FROM chat_message
      WHERE session_id = $1
      ORDER BY created_at ASC
      LIMIT $2
      `,
      [sessionId, limit],
    );
    return result.rows;
  });
}

async function getQuestionSourceByIdRecord(id) {
  if (!isPostgresEnabled() || !id) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
             category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
             metadata_json, status, merged_into_source_id, created_at, updated_at
      FROM question_source
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );
    return normalizeQuestionSourceRow(result.rows[0] || null);
  });
}

async function getQuestionSourceBySourceRefRecord({ sourceType, sourceRefId }) {
  if (!isPostgresEnabled() || !sourceType || !sourceRefId) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
             category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
             metadata_json, status, merged_into_source_id, created_at, updated_at
      FROM question_source
      WHERE source_type = $1 AND source_ref_id = $2
      LIMIT 1
      `,
      [sourceType, sourceRefId],
    );
    return normalizeQuestionSourceRow(result.rows[0] || null);
  });
}

async function findQuestionSourceByCanonicalQuestionRecord({ canonicalQuestion, track = '', chapter = '' }) {
  if (!isPostgresEnabled() || !canonicalQuestion) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
             category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
             metadata_json, status, merged_into_source_id, created_at, updated_at
      FROM question_source
      WHERE canonical_question = $1
        AND track = $2
        AND chapter = $3
        AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [canonicalQuestion, track, chapter],
    );
    return normalizeQuestionSourceRow(result.rows[0] || null);
  });
}

async function listQuestionSourcesByIdsRecord(ids = []) {
  if (!isPostgresEnabled()) {
    return [];
  }

  const normalizedIds = ids.filter(Boolean);
  if (normalizedIds.length === 0) {
    return [];
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
             category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
             metadata_json, status, merged_into_source_id, created_at, updated_at
      FROM question_source
      WHERE id = ANY($1::text[])
      `,
      [normalizedIds],
    );
    return result.rows.map(normalizeQuestionSourceRow);
  });
}

async function countQuestionSourcesRecord({ track, chapter, status = 'active' } = {}) {
  if (!isPostgresEnabled()) {
    return 0;
  }

  const where = [];
  const params = [];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  if (track) {
    params.push(track);
    where.push(`track = $${params.length}`);
  }

  if (chapter) {
    params.push(chapter);
    where.push(`chapter = $${params.length}`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM question_source
      ${whereClause}
      `,
      params,
    );
    return Number(result.rows[0]?.total || 0);
  });
}

async function upsertQuestionSourceRecord({
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
}) {
  if (!isPostgresEnabled() || !sourceType || !sourceRefId || !canonicalQuestion || !questionText) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    const nextCreatedAt = createdAt || now;
    const nextUpdatedAt = updatedAt || now;

    const existing = await client.query(
      `
      SELECT id
      FROM question_source
      WHERE source_type = $1 AND source_ref_id = $2
      LIMIT 1
      `,
      [sourceType, sourceRefId],
    );

    if (existing.rows[0]?.id) {
      const result = await client.query(
        `
        UPDATE question_source
        SET canonical_question = $3,
            question_text = $4,
            normalized_question = $5,
            category = $6,
            difficulty = $7,
            track = $8,
            chapter = $9,
            knowledge_points_json = $10::jsonb,
            expected_points_json = $11::jsonb,
            metadata_json = $12::jsonb,
            status = $13,
            merged_into_source_id = $14,
            updated_at = $15::timestamptz
        WHERE source_type = $1
          AND source_ref_id = $2
        RETURNING id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
                  category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
                  metadata_json, status, merged_into_source_id, created_at, updated_at
        `,
        [
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
          nextUpdatedAt,
        ],
      );
      return { item: normalizeQuestionSourceRow(result.rows[0] || null), created: false };
    }

    const nextId = id || `qs_${Math.random().toString(36).slice(2, 10)}`;
    const inserted = await client.query(
      `
      INSERT INTO question_source (
        id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
        category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
        metadata_json, status, merged_into_source_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16::timestamptz, $17::timestamptz)
      RETURNING id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
                category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
                metadata_json, status, merged_into_source_id, created_at, updated_at
      `,
      [
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
      ],
    );
    return { item: normalizeQuestionSourceRow(inserted.rows[0] || null), created: true };
  });
}

async function getUserQuestionBankItemByIdRecord(id) {
  if (!isPostgresEnabled() || !id) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
             mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
             source_channel, created_at, updated_at
      FROM user_question_bank
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );
    return normalizeUserQuestionBankRow(result.rows[0] || null);
  });
}

async function getUserQuestionBankItemByUserAndSourceRecord({ userId, questionSourceId }) {
  if (!isPostgresEnabled() || !userId || !questionSourceId) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
             mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
             source_channel, created_at, updated_at
      FROM user_question_bank
      WHERE user_id = $1 AND question_source_id = $2
      LIMIT 1
      `,
      [userId, questionSourceId],
    );
    return normalizeUserQuestionBankRow(result.rows[0] || null);
  });
}

async function addUserQuestionBankItemRecord({
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
}) {
  if (!isPostgresEnabled() || !userId || !questionSourceId) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    const existing = await client.query(
      `
      SELECT id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
             mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
             source_channel, created_at, updated_at
      FROM user_question_bank
      WHERE user_id = $1 AND question_source_id = $2
      LIMIT 1
      `,
      [userId, questionSourceId],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      const result = await client.query(
        `
        UPDATE user_question_bank
        SET track = $2,
            chapter = $3,
            custom_question_text = $4,
            review_status = $5,
            mastery_level = $6,
            weakness_tag = $7,
            next_review_at = $8::timestamptz,
            last_practiced_at = $9::timestamptz,
            is_favorited = $10,
            source_channel = $11,
            updated_at = $12::timestamptz
        WHERE id = $1
        RETURNING id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
                  mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
                  source_channel, created_at, updated_at
        `,
        [
          row.id,
          track || row.track || '',
          chapter || row.chapter || '',
          customQuestionText || row.custom_question_text || '',
          reviewStatus || row.review_status || 'pending',
          Number.isFinite(masteryLevel) ? masteryLevel : Number(row.mastery_level || 0),
          weaknessTag || row.weakness_tag || '',
          nextReviewAt !== undefined ? nextReviewAt : row.next_review_at,
          lastPracticedAt !== undefined ? lastPracticedAt : row.last_practiced_at,
          Boolean(isFavorited),
          sourceChannel || row.source_channel || '',
          now,
        ],
      );
      return { item: normalizeUserQuestionBankRow(result.rows[0] || null), created: false };
    }

    const nextId = id || `uqb_${Math.random().toString(36).slice(2, 10)}`;
    const inserted = await client.query(
      `
      INSERT INTO user_question_bank (
        id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
        mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
        source_channel, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14::timestamptz, $14::timestamptz)
      RETURNING id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
                mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
                source_channel, created_at, updated_at
      `,
      [
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
        Boolean(isFavorited),
        sourceChannel || '',
        now,
      ],
    );
    return { item: normalizeUserQuestionBankRow(inserted.rows[0] || null), created: true };
  });
}

async function listUserQuestionBankRecord({
  userId,
  track,
  chapter,
  reviewStatus,
  limit = 20,
  offset = 0,
}) {
  if (!isPostgresEnabled() || !userId) {
    return { items: [], total: 0 };
  }

  const where = ['uqb.user_id = $1'];
  const params = [userId];

  if (track) {
    params.push(track);
    where.push(`uqb.track = $${params.length}`);
  }

  if (chapter) {
    params.push(chapter);
    where.push(`uqb.chapter = $${params.length}`);
  }

  if (reviewStatus) {
    params.push(reviewStatus);
    where.push(`uqb.review_status = $${params.length}`);
  }

  const whereClause = `WHERE ${where.join(' AND ')}`;
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  return withClient(async (client) => {
    const itemsResult = await client.query(
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
      LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      [...params, limit, offset],
    );

    const totalResult = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM user_question_bank uqb
      ${whereClause}
      `,
      params,
    );

    return {
      items: itemsResult.rows.map((row) => ({
        ...normalizeUserQuestionBankRow(row),
        metadata: parseJsonObject(row.metadata_json),
        knowledge_points: parseJsonArray(row.knowledge_points_json),
        expected_points: parseJsonArray(row.expected_points_json),
      })),
      total: Number(totalResult.rows[0]?.total || 0),
    };
  });
}

async function listPracticeUserQuestionBankRecord({
  userId,
  chapter,
  includeFuture = false,
  limit = 10,
}) {
  if (!isPostgresEnabled() || !userId) {
    return [];
  }

  const where = ['uqb.user_id = $1', "uqb.review_status = 'pending'"];
  const params = [userId];

  if (chapter) {
    params.push(chapter);
    where.push(`uqb.chapter = $${params.length}`);
  }

  if (!includeFuture) {
    params.push(new Date().toISOString());
    where.push(`(uqb.next_review_at IS NULL OR uqb.next_review_at <= $${params.length}::timestamptz)`);
  }

  const limitParam = params.length + 1;
  return withClient(async (client) => {
    const result = await client.query(
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
      LIMIT $${limitParam}
      `,
      [...params, limit],
    );

    return result.rows.map((row) => ({
      ...normalizeUserQuestionBankRow(row),
      metadata: parseJsonObject(row.metadata_json),
      knowledge_points: parseJsonArray(row.knowledge_points_json),
      expected_points: parseJsonArray(row.expected_points_json),
    }));
  });
}

async function updateUserQuestionBankReviewStateRecord({
  id,
  reviewStatus,
  masteryLevel,
  weaknessTag,
  nextReviewAt,
  lastPracticedAt,
}) {
  if (!isPostgresEnabled() || !id) {
    return null;
  }

  return withClient(async (client) => {
    const existing = await client.query(
      `
      SELECT id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
             mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
             source_channel, created_at, updated_at
      FROM user_question_bank
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    const current = existing.rows[0];
    if (!current) {
      return null;
    }

    const result = await client.query(
      `
      UPDATE user_question_bank
      SET review_status = $2,
          mastery_level = $3,
          weakness_tag = $4,
          next_review_at = $5::timestamptz,
          last_practiced_at = $6::timestamptz,
          updated_at = now()
      WHERE id = $1
      RETURNING id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
                mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
                source_channel, created_at, updated_at
      `,
      [
        id,
        reviewStatus !== undefined ? reviewStatus : current.review_status,
        masteryLevel !== undefined ? masteryLevel : current.mastery_level,
        weaknessTag !== undefined ? weaknessTag : current.weakness_tag,
        nextReviewAt !== undefined ? nextReviewAt : current.next_review_at,
        lastPracticedAt !== undefined ? lastPracticedAt : current.last_practiced_at,
      ],
    );

    return normalizeUserQuestionBankRow(result.rows[0] || null);
  });
}

async function createQuestionAttemptRecord({
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
}) {
  if (!isPostgresEnabled() || !userId || !userQuestionBankId || !sessionType) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    const nextId = id || `qa_${Math.random().toString(36).slice(2, 10)}`;
    await client.query('BEGIN');
    try {
      const inserted = await client.query(
        `
        INSERT INTO question_attempt (
          id, user_id, user_question_bank_id, session_type, session_id, answer, score,
          strengths_json, weaknesses_json, evidence_refs_json, feedback, mastered,
          next_review_at, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13::timestamptz, $14::timestamptz)
        RETURNING id, user_id, user_question_bank_id, session_type, session_id, answer, score,
                  strengths_json, weaknesses_json, evidence_refs_json, feedback, mastered,
                  next_review_at, created_at
        `,
        [
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
          Boolean(mastered),
          nextReviewAt || null,
          now,
        ],
      );

      await client.query(
        `
        UPDATE user_question_bank
        SET last_practiced_at = $2::timestamptz,
            next_review_at = $3::timestamptz,
            updated_at = $2::timestamptz
        WHERE id = $1
        `,
        [userQuestionBankId, now, nextReviewAt || null],
      );
      await client.query('COMMIT');
      return normalizeQuestionAttemptRow(inserted.rows[0] || null);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function getPublicSourceSyncStateBySourceNameRecord(sourceName) {
  if (!isPostgresEnabled() || !sourceName) {
    return null;
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_name, last_synced_at, last_server_time, last_sync_status,
             last_error_message, local_item_count, updated_at
      FROM public_source_sync_state
      WHERE source_name = $1
      LIMIT 1
      `,
      [sourceName],
    );
    return result.rows[0] || null;
  });
}

async function upsertPublicSourceSyncStateRecord({
  id,
  sourceName,
  lastSyncedAt = null,
  lastServerTime = null,
  lastSyncStatus = 'idle',
  lastErrorMessage = '',
  localItemCount = 0,
}) {
  if (!isPostgresEnabled() || !sourceName) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    const existing = await client.query(
      `
      SELECT id
      FROM public_source_sync_state
      WHERE source_name = $1
      LIMIT 1
      `,
      [sourceName],
    );

    if (existing.rows[0]?.id) {
      const updated = await client.query(
        `
        UPDATE public_source_sync_state
        SET last_synced_at = $2::timestamptz,
            last_server_time = $3::timestamptz,
            last_sync_status = $4,
            last_error_message = $5,
            local_item_count = $6,
            updated_at = $7::timestamptz
        WHERE source_name = $1
        RETURNING id, source_name, last_synced_at, last_server_time, last_sync_status,
                  last_error_message, local_item_count, updated_at
        `,
        [
          sourceName,
          lastSyncedAt,
          lastServerTime,
          lastSyncStatus,
          lastErrorMessage,
          Number(localItemCount || 0),
          now,
        ],
      );
      return updated.rows[0] || null;
    }

    const inserted = await client.query(
      `
      INSERT INTO public_source_sync_state (
        id, source_name, last_synced_at, last_server_time, last_sync_status,
        last_error_message, local_item_count, updated_at
      )
      VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8::timestamptz)
      RETURNING id, source_name, last_synced_at, last_server_time, last_sync_status,
                last_error_message, local_item_count, updated_at
      `,
      [
        id || `pss_${Math.random().toString(36).slice(2, 10)}`,
        sourceName,
        lastSyncedAt,
        lastServerTime,
        lastSyncStatus,
        lastErrorMessage,
        Number(localItemCount || 0),
        now,
      ],
    );
    return inserted.rows[0] || null;
  });
}

async function saveScoringResultRecord({
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
}) {
  if (!isPostgresEnabled() || !attemptId || !scoreReportId || !userId) {
    return null;
  }

  return withClient(async (client) => {
    const now = new Date().toISOString();
    await client.query('BEGIN');
    try {
      await client.query(
        `
        INSERT INTO attempt (id, user_id, mode, question, answer, created_at)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
        `,
        [attemptId, userId, mode, question, answer, now],
      );

      for (const row of evidenceRefs || []) {
        await client.query(
          `
          INSERT INTO evidence_ref (id, attempt_id, source_type, source_uri, quote, confidence)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [row.id, attemptId, row.source_type, row.source_uri, row.quote, row.confidence],
        );
      }

      await client.query(
        `
        INSERT INTO score_report (id, attempt_id, score, strengths_json, weaknesses_json, feedback, created_at)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz)
        `,
        [
          scoreReportId,
          attemptId,
          score,
          JSON.stringify(strengths || []),
          JSON.stringify(weaknesses || []),
          feedback,
          now,
        ],
      );

      for (const weakness of weaknessRows || []) {
        const existing = await client.query(
          `
          SELECT id, hit_count
          FROM weakness_tag
          WHERE user_id = $1 AND tag = $2
          LIMIT 1
          `,
          [userId, weakness.tag],
        );
        if (existing.rows[0]?.id) {
          await client.query(
            `
            UPDATE weakness_tag
            SET hit_count = $3, last_seen_at = $4::timestamptz
            WHERE id = $1 AND user_id = $2
            `,
            [existing.rows[0].id, userId, Number(existing.rows[0].hit_count || 0) + 1, now],
          );
        } else {
          await client.query(
            `
            INSERT INTO weakness_tag (id, user_id, tag, hit_count, last_seen_at)
            VALUES ($1, $2, $3, $4, $5::timestamptz)
            `,
            [weakness.id, userId, weakness.tag, 1, now],
          );
        }
      }

      await client.query('COMMIT');
      return { id: attemptId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function getWeaknessesByUserRecord(userId, limit = 20) {
  if (!isPostgresEnabled() || !userId) {
    return [];
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT tag, hit_count, last_seen_at
      FROM weakness_tag
      WHERE user_id = $1
      ORDER BY hit_count DESC, last_seen_at DESC
      LIMIT $2
      `,
      [userId, limit],
    );
    return result.rows;
  });
}

async function listAttemptsByUserRecord(userId, limit = 20) {
  if (!isPostgresEnabled() || !userId) {
    return [];
  }

  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT a.id, a.user_id, a.mode, a.question, a.answer, a.created_at, sr.score
      FROM attempt a
      LEFT JOIN score_report sr ON sr.attempt_id = a.id
      WHERE a.user_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2
      `,
      [userId, limit],
    );
    return result.rows;
  });
}

async function getTodayResumeOcrUsageCount({ userId }) {
  if (!isPostgresEnabled()) {
    return null;
  }

  await initPostgres();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `
      SELECT count(*)::int AS count
      FROM resume_parse_usage
      WHERE user_id = $1
        AND charged = true
        AND source_type IN ('pdf', 'image')
        AND created_at >= date_trunc('day', now())
      `,
      [userId],
    );
    return Number(result.rows[0]?.count || 0);
  } finally {
    client.release();
  }
}

async function getResumeParseCacheByHash({ fileHash }) {
  if (!isPostgresEnabled() || !fileHash) {
    return null;
  }

  await initPostgres();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `
      SELECT id, user_id, file_hash, source_type, parsed_text, summary, parse_meta, original_filename, created_at, updated_at
      FROM resume_parse_cache
      WHERE file_hash = $1
      LIMIT 1
      `,
      [fileHash],
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function saveResumeParseCache({
  userId = null,
  fileHash,
  sourceType,
  parsedText,
  summary,
  parseMeta,
  originalFilename,
}) {
  if (!isPostgresEnabled() || !fileHash) {
    return null;
  }

  await initPostgres();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `
      INSERT INTO resume_parse_cache
      (id, user_id, file_hash, source_type, parsed_text, summary, parse_meta, original_filename, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now(), now())
      ON CONFLICT (file_hash)
      DO UPDATE SET
        user_id = COALESCE(resume_parse_cache.user_id, EXCLUDED.user_id),
        source_type = EXCLUDED.source_type,
        parsed_text = EXCLUDED.parsed_text,
        summary = EXCLUDED.summary,
        parse_meta = EXCLUDED.parse_meta,
        original_filename = EXCLUDED.original_filename,
        updated_at = now()
      RETURNING id, user_id, file_hash, source_type, parsed_text, summary, parse_meta, original_filename, created_at, updated_at
      `,
      [
        randomUUID(),
        userId,
        fileHash,
        sourceType,
        parsedText,
        summary,
        JSON.stringify(parseMeta || {}),
        originalFilename || null,
      ],
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function createResumeParseUsage({
  userId,
  fileHash,
  sourceType,
  engine,
  status,
  charged,
  failureReason = null,
}) {
  if (!isPostgresEnabled() || !userId) {
    return null;
  }

  await initPostgres();
  const client = await getPool().connect();
  try {
    const result = await client.query(
      `
      INSERT INTO resume_parse_usage
      (id, user_id, file_hash, source_type, engine, status, charged, failure_reason, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      RETURNING id, user_id, file_hash, source_type, engine, status, charged, failure_reason, created_at
      `,
      [randomUUID(), userId, fileHash || null, sourceType, engine || null, status, Boolean(charged), failureReason],
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

module.exports = {
  addChatMessageRecord,
  addUserQuestionBankItemRecord,
  addInterviewTurnRecord,
  countInterviewSessionsStartedOnUtcDate,
  countQuestionSourcesRecord,
  createChatSessionRecord,
  createInterviewSessionRecord,
  createQuestionAttemptRecord,
  deleteInterviewSessionRecord,
  DATABASE_URL,
  createResumeParseUsage,
  findQuestionSourceByCanonicalQuestionRecord,
  finishInterviewSessionRecord,
  getAppUserByClerkUserId,
  getChatSessionById,
  getInterviewQuestionByIdRecord,
  getInterviewSessionById,
  getInterviewSessionKeywordQueue,
  getNextInterviewQuestionRecord,
  getPool,
  getPublicSourceSyncStateBySourceNameRecord,
  getQuestionSourceByIdRecord,
  getQuestionSourceBySourceRefRecord,
  getResumeParseCacheByHash,
  getUserQuestionBankItemByIdRecord,
  getUserQuestionBankItemByUserAndSourceRecord,
  getWeaknessesByUserRecord,
  getUserProfileByAuthUserId,
  getAdminEmails,
  initPostgres,
  insertInterviewQuestionAfterRecord,
  isPostgresEnabled,
  listAttemptsByUserRecord,
  listChatMessagesBySession,
  listInterviewQuestionsBySession,
  listInterviewSessionsByUser,
  listInterviewTurnsBySession,
  listPracticeUserQuestionBankRecord,
  listQuestionSourcesByIdsRecord,
  listUserQuestionBankRecord,
  resolveUserRoleByEmail,
  saveResumeParseCache,
  saveInterviewQuestionsRecord,
  saveScoringResultRecord,
  upsertPublicSourceSyncStateRecord,
  upsertQuestionSourceRecord,
  updateInterviewQuestionStatusRecord,
  updateInterviewSessionKeywordQueue,
  updateUserQuestionBankReviewStateRecord,
  upsertAppUserByClerk,
  upsertUserProfile,
  getTodayResumeOcrUsageCount,
};
