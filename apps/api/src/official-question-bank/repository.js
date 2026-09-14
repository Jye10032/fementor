const { Pool } = require('pg');

const REMOTE_DATABASE_URL = String(process.env.REMOTE_DATABASE_URL || '').trim();
const REMOTE_DATABASE_SSL = String(process.env.REMOTE_DATABASE_SSL || 'verify-full').trim().toLowerCase();
const REMOTE_CONNECT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.REMOTE_DATABASE_CONNECT_TIMEOUT_MS || 5000),
);

let remotePool = null;

const getRemoteDatabaseSslConfig = (mode = REMOTE_DATABASE_SSL) => {
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (['0', 'false', 'disable', 'disabled'].includes(normalizedMode)) return false;
  if (['no-verify', 'require'].includes(normalizedMode)) return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const normalizeOfficialQuestion = (row) => row ? ({
  ...row,
  knowledge_points: parseJsonArray(row.knowledge_points_json),
  expected_points: parseJsonArray(row.expected_points_json),
  metadata: parseJsonObject(row.metadata_json),
  source: 'remote_official',
  read_only: true,
}) : null;

const isRemoteQuestionBankConfigured = () => Boolean(REMOTE_DATABASE_URL);

const getRemotePool = () => {
  if (!isRemoteQuestionBankConfigured()) return null;
  if (!remotePool) {
    remotePool = new Pool({
      connectionString: REMOTE_DATABASE_URL,
      connectionTimeoutMillis: REMOTE_CONNECT_TIMEOUT_MS,
      idleTimeoutMillis: 30000,
      max: 4,
      ssl: getRemoteDatabaseSslConfig(),
      options: `-c default_transaction_read_only=on -c statement_timeout=${REMOTE_CONNECT_TIMEOUT_MS}`,
    });
    remotePool.on('error', (error) => {
      console.warn('[official-question-bank.pool.error]', error?.message || 'remote pool error');
    });
  }
  return remotePool;
};

const withReadOnlyClient = async (callback) => {
  if (!isRemoteQuestionBankConfigured()) {
    const error = new Error('official_source_not_configured');
    error.code = 'official_source_not_configured';
    throw error;
  }

  const client = await getRemotePool().connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original connection/query error.
    }
    throw error;
  } finally {
    client.release();
  }
};

const buildOfficialQuestionFilter = ({
  query = '',
  track = '',
  chapter = '',
  difficulty = '',
  category = '',
} = {}) => {
  const where = ["status = 'active'"];
  const params = [];
  const addFilter = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (query) {
    addFilter(
      `(canonical_question ILIKE ? OR question_text ILIKE ? OR chapter ILIKE ? OR category ILIKE ?)`,
      `%${query}%`,
    );
    const placeholder = `$${params.length}`;
    where[where.length - 1] = where[where.length - 1].replaceAll('?', placeholder);
  }
  if (track) addFilter('track = ?', track);
  if (chapter) addFilter('chapter = ?', chapter);
  if (difficulty) addFilter('difficulty = ?', difficulty);
  if (category) addFilter('category = ?', category);

  return { params, whereClause: `WHERE ${where.join(' AND ')}` };
};

const listOfficialQuestionSources = async ({
  query = '',
  track = '',
  chapter = '',
  difficulty = '',
  category = '',
  limit = 20,
  offset = 0,
} = {}) => {
  const parsedLimit = Number(limit);
  const parsedOffset = Number(offset);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
  const safeOffset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
  const filter = buildOfficialQuestionFilter({ query, track, chapter, difficulty, category });

  return withReadOnlyClient(async (client) => {
    const limitParam = filter.params.length + 1;
    const offsetParam = filter.params.length + 2;
    const itemsResult = await client.query(
      `
      SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
             category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
             metadata_json, status, created_at, updated_at
      FROM public.question_source
      ${filter.whereClause}
      ORDER BY updated_at DESC, id ASC
      LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      [...filter.params, safeLimit, safeOffset],
    );
    const totalResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM public.question_source ${filter.whereClause}`,
      filter.params,
    );
    return {
      items: itemsResult.rows.map(normalizeOfficialQuestion),
      total: Number(totalResult.rows[0]?.total || 0),
    };
  });
};

const getOfficialQuestionSourceById = async (id) => {
  if (!id) return null;
  return withReadOnlyClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_type, source_ref_id, canonical_question, question_text, normalized_question,
             category, difficulty, track, chapter, knowledge_points_json, expected_points_json,
             metadata_json, status, created_at, updated_at
      FROM public.question_source
      WHERE id = $1 AND status = 'active'
      LIMIT 1
      `,
      [id],
    );
    return normalizeOfficialQuestion(result.rows[0] || null);
  });
};

const getOfficialQuestionSourceStatus = async () => {
  if (!isRemoteQuestionBankConfigured()) {
    return { configured: false, reachable: false, total: 0 };
  }
  try {
    return await withReadOnlyClient(async (client) => {
      const result = await client.query(
        `SELECT current_setting('transaction_read_only') AS read_only,
                COUNT(*) FILTER (WHERE status = 'active')::int AS total
         FROM public.question_source`,
      );
      return {
        configured: true,
        reachable: true,
        read_only: result.rows[0]?.read_only === 'on',
        total: Number(result.rows[0]?.total || 0),
      };
    });
  } catch (error) {
    console.warn('[official-question-bank.status.unavailable]', error?.code || 'remote_connection_failed');
    return {
      configured: true,
      reachable: false,
      total: 0,
      last_error: 'remote_connection_failed',
    };
  }
};

const closeOfficialQuestionSourcePool = async () => {
  if (!remotePool) return;
  const pool = remotePool;
  remotePool = null;
  await pool.end();
};

module.exports = {
  buildOfficialQuestionFilter,
  closeOfficialQuestionSourcePool,
  getOfficialQuestionSourceById,
  getOfficialQuestionSourceStatus,
  getRemoteDatabaseSslConfig,
  isRemoteQuestionBankConfigured,
  listOfficialQuestionSources,
};
