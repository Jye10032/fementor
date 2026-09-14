const { randomUUID } = require('crypto');
const { Pool } = require('pg');
const { assertDatabaseMigrationsCurrent } = require('./postgres/migration-state');

const DATABASE_URL = String(process.env.DATABASE_URL || process.env.SUPABASE || '').trim();

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

function shouldDisableSslForDatabaseUrl(databaseUrl) {
  if (!databaseUrl) {
    return false;
  }

  try {
    const parsed = new URL(databaseUrl);
    const hostname = String(parsed.hostname || '').trim().toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '[::1]'
      || hostname === '0.0.0.0'
      || hostname === 'postgres';
  } catch {
    return false;
  }
}

function classifyPostgresTarget(databaseUrl) {
  return shouldDisableSslForDatabaseUrl(databaseUrl) ? 'local_postgres' : 'remote_postgres';
}

function getPostgresTarget() {
  return isPostgresEnabled() ? classifyPostgresTarget(DATABASE_URL) : null;
}

function getPostgresSslConfig() {
  if (process.env.PGSSL_DISABLE === '1') {
    return false;
  }

  if (shouldDisableSslForDatabaseUrl(DATABASE_URL)) {
    return false;
  }

  return { rejectUnauthorized: false };
}

function getPool() {
  if (!isPostgresEnabled()) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: getPostgresSslConfig(),
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

async function initPostgres() {
  if (!isPostgresEnabled()) {
    return { enabled: false };
  }

  if (!initPromise) {
    initPromise = (async () => {
      const client = await getPool().connect();
      try {
        const migrationState = await assertDatabaseMigrationsCurrent(client);
        console.log('[postgres.schema.ready]', migrationState);
        return { enabled: true, migrationState };
      } finally {
        client.release();
      }
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

async function listImportedOfficialQuestionIdsRecord({ userId, remoteIds = [] }) {
  const normalizedIds = remoteIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!isPostgresEnabled() || !userId || normalizedIds.length === 0) return [];
  const sourceRefs = normalizedIds.map((id) => `remote:${id}`);
  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT qs.source_ref_id
      FROM user_question_bank uqb
      INNER JOIN question_source qs ON qs.id = uqb.question_source_id
      WHERE uqb.user_id = $1
        AND qs.source_type = 'official_remote'
        AND qs.source_ref_id = ANY($2::text[])
      `,
      [userId, sourceRefs],
    );
    return result.rows.map((row) => String(row.source_ref_id || '').replace(/^remote:/, ''));
  });
}

async function importOfficialQuestionRecord({ userId, remoteQuestion }) {
  if (!isPostgresEnabled() || !userId || !remoteQuestion?.id) return null;
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const sourceResult = await client.query(
        `
        INSERT INTO question_source (
          id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
          category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
          metadata_json, status, merged_into_source_id, created_at, updated_at
        )
        VALUES ($1, 'official_remote', $2, $3, $4, $5, $6, $7, $8, $9,
                $10::jsonb, $11::jsonb, $12::jsonb, 'active', NULL, now(), now())
        ON CONFLICT (source_type, source_ref_id)
        DO UPDATE SET canonical_question = EXCLUDED.canonical_question,
                      question_text = EXCLUDED.question_text,
                      normalized_question = EXCLUDED.normalized_question,
                      category = EXCLUDED.category,
                      difficulty = EXCLUDED.difficulty,
                      track = EXCLUDED.track,
                      chapter = EXCLUDED.chapter,
                      knowledge_points_json = EXCLUDED.knowledge_points_json,
                      expected_points_json = EXCLUDED.expected_points_json,
                      metadata_json = EXCLUDED.metadata_json,
                      status = 'active',
                      updated_at = now()
        RETURNING id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
                  category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
                  metadata_json, status, merged_into_source_id, created_at, updated_at
        `,
        [
          randomUUID(),
          `remote:${remoteQuestion.id}`,
          remoteQuestion.canonical_question,
          remoteQuestion.question_text,
          remoteQuestion.normalized_question || '',
          remoteQuestion.category || '',
          remoteQuestion.difficulty || 'medium',
          remoteQuestion.track || '',
          remoteQuestion.chapter || '',
          JSON.stringify(remoteQuestion.knowledge_points || []),
          JSON.stringify(remoteQuestion.expected_points || []),
          JSON.stringify({
            origin: 'remote_official',
            remote_source_id: remoteQuestion.id,
            remote_updated_at: remoteQuestion.updated_at,
            remote_metadata: remoteQuestion.metadata || {},
          }),
        ],
      );
      const source = normalizeQuestionSourceRow(sourceResult.rows[0]);
      const bankResult = await client.query(
        `
        INSERT INTO user_question_bank (
          id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
          mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
          source_channel, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, '', 'pending', 0, '', NULL, NULL, false,
                'remote_official', now(), now())
        ON CONFLICT (user_id, question_source_id) DO NOTHING
        RETURNING id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
                  mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
                  source_channel, created_at, updated_at
        `,
        [randomUUID(), userId, source.id, remoteQuestion.track || '', remoteQuestion.chapter || ''],
      );
      const created = Boolean(bankResult.rows[0]);
      const itemResult = created ? bankResult : await client.query(
        `
        SELECT id, user_id, question_source_id, track, chapter, custom_question_text, review_status,
               mastery_level, weakness_tag, next_review_at, last_practiced_at, is_favorited,
               source_channel, created_at, updated_at
        FROM user_question_bank
        WHERE user_id = $1 AND question_source_id = $2
        LIMIT 1
        `,
        [userId, source.id],
      );
      const item = normalizeUserQuestionBankRow(itemResult.rows[0] || null);
      if (!item) {
        throw new Error('official question import conflict could not be resolved');
      }
      await client.query('COMMIT');
      return {
        item,
        source,
        created,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
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
  classifyPostgresTarget,
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
  getPostgresTarget,
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
  importOfficialQuestionRecord,
  insertInterviewQuestionAfterRecord,
  isPostgresEnabled,
  listAttemptsByUserRecord,
  listChatMessagesBySession,
  listInterviewQuestionsBySession,
  listInterviewSessionsByUser,
  listInterviewTurnsBySession,
  listImportedOfficialQuestionIdsRecord,
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
