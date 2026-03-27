const { randomUUID } = require('crypto');
const { Pool } = require('pg');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();

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

  await initPostgres();
  const client = await getPool().connect();
  try {
    const existing = await client.query(
      `
      SELECT id, clerk_user_id, email, name, avatar_url, plan, status, created_at, updated_at
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
            updated_at = now()
        WHERE clerk_user_id = $1
        RETURNING id, clerk_user_id, email, name, avatar_url, plan, status, created_at, updated_at
        `,
        [clerkUserId, email || null, name || null, avatarUrl || null],
      );
      return updated.rows[0] || row;
    }

    const inserted = await client.query(
      `
      INSERT INTO users (id, clerk_user_id, email, name, avatar_url, plan, status)
      VALUES ($1, $2, $3, $4, $5, 'free', 'active')
      RETURNING id, clerk_user_id, email, name, avatar_url, plan, status, created_at, updated_at
      `,
      [randomUUID(), clerkUserId, email || null, name || null, avatarUrl || null],
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
  getResumeParseCacheByHash,
  initPostgres,
  isPostgresEnabled,
  saveResumeParseCache,
  upsertAppUserByClerk,
  getTodayResumeOcrUsageCount,
};
