const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const APP_PUBLIC_TABLES = [
  'users',
  'resume_parse_usage',
  'resume_parse_cache',
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
          CREATE TABLE IF NOT EXISTS experience_sync_job (
            id text PRIMARY KEY,
            user_id text NOT NULL,
            keyword text NOT NULL,
            status text NOT NULL,
            requested_limit integer NOT NULL DEFAULT 10,
            created_count integer NOT NULL DEFAULT 0,
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
        await enableRowLevelSecurity(client);
      } finally {
        client.release();
      }

      return { enabled: true };
    })();
  }

  return initPromise;
}

async function upsertAppUserByClerk({ clerkUserId, email, name, avatarUrl }) {
  if (!isPostgresEnabled()) {
    return null;
  }

  const role = resolveUserRoleByEmail(email);

  await initPostgres();
  const client = await getPool().connect();
  try {
    const existing = await client.query(
      `
      SELECT id, clerk_user_id, email, name, avatar_url, role, plan, status, created_at, updated_at
      FROM users
      WHERE clerk_user_id = $1
      LIMIT 1
      `,
      [clerkUserId],
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      const updated = await client.query(
        `
        UPDATE users
        SET email = $2,
            name = $3,
            avatar_url = $4,
            role = $5,
            updated_at = now()
        WHERE clerk_user_id = $1
        RETURNING id, clerk_user_id, email, name, avatar_url, role, plan, status, created_at, updated_at
        `,
        [clerkUserId, email || null, name || null, avatarUrl || null, role],
      );
      return updated.rows[0] || { ...row, role: getNormalizedRole(row.role) };
    }

    const inserted = await client.query(
      `
      INSERT INTO users (id, clerk_user_id, email, name, avatar_url, role, plan, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'free', 'active')
      RETURNING id, clerk_user_id, email, name, avatar_url, role, plan, status, created_at, updated_at
      `,
      [randomUUID(), clerkUserId, email || null, name || null, avatarUrl || null, role],
    );
    return inserted.rows[0] || null;
  } finally {
    client.release();
  }
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
  DATABASE_URL,
  createResumeParseUsage,
  getPool,
  getResumeParseCacheByHash,
  getAdminEmails,
  initPostgres,
  isPostgresEnabled,
  resolveUserRoleByEmail,
  saveResumeParseCache,
  upsertAppUserByClerk,
  getTodayResumeOcrUsageCount,
};
