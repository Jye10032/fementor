const { getPool, initPostgres, isPostgresEnabled } = require('../postgres');

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeExperiencePostRow(row) {
  if (!row) return null;

  return {
    ...row,
    quality_score: Number(row.quality_score || 0),
    is_valid: Boolean(row.is_valid),
  };
}

function normalizeExperienceGroupRow(row) {
  if (!row) return null;

  return {
    ...row,
    group_order: Number(row.group_order || 0),
    frequency_score: Number(row.frequency_score || 0),
    confidence: Number(row.confidence || 0),
  };
}

function normalizeExperienceItemRow(row) {
  if (!row) return null;

  return {
    ...row,
    order_in_group: Number(row.order_in_group || 0),
    expected_points: parseJsonArray(row.expected_points_json),
    knowledge_points: parseJsonArray(row.knowledge_points_json),
  };
}

async function withClient(callback) {
  if (!isPostgresEnabled()) {
    throw new Error('postgres experience store is not enabled');
  }

  await initPostgres();
  const client = await getPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function createExperienceSyncJob({ id, userId, keyword, requestedLimit = 10 }) {
  return withClient(async (client) => {
    await client.query(
      `
      INSERT INTO experience_sync_job (
        id, user_id, keyword, status, requested_limit,
        created_count, skipped_count, failed_count,
        started_at, finished_at, error_message, created_at, updated_at
      )
      VALUES ($1, $2, $3, 'pending', $4, 0, 0, 0, NULL, NULL, '', now(), now())
      `,
      [id, userId, keyword, requestedLimit],
    );

    return getExperienceSyncJobById(id);
  });
}

async function getExperienceSyncJobById(jobId) {
  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, user_id, keyword, status, requested_limit,
             created_count, skipped_count, failed_count,
             started_at, finished_at, error_message, created_at, updated_at
      FROM experience_sync_job
      WHERE id = $1
      LIMIT 1
      `,
      [jobId],
    );

    return result.rows[0] || null;
  });
}

async function updateExperienceSyncJob({
  jobId,
  status,
  createdCount,
  skippedCount,
  failedCount,
  startedAt,
  finishedAt,
  errorMessage,
}) {
  return withClient(async (client) => {
    const currentResult = await client.query(
      `
      SELECT id, user_id, keyword, status, requested_limit,
             created_count, skipped_count, failed_count,
             started_at, finished_at, error_message, created_at, updated_at
      FROM experience_sync_job
      WHERE id = $1
      LIMIT 1
      `,
      [jobId],
    );

    const current = currentResult.rows[0];
    if (!current) return null;

    await client.query(
      `
      UPDATE experience_sync_job
      SET status = $2,
          created_count = $3,
          skipped_count = $4,
          failed_count = $5,
          started_at = $6,
          finished_at = $7,
          error_message = $8,
          updated_at = now()
      WHERE id = $1
      `,
      [
        jobId,
        status !== undefined ? status : current.status,
        createdCount !== undefined ? createdCount : current.created_count,
        skippedCount !== undefined ? skippedCount : current.skipped_count,
        failedCount !== undefined ? failedCount : current.failed_count,
        startedAt !== undefined ? startedAt : current.started_at,
        finishedAt !== undefined ? finishedAt : current.finished_at,
        errorMessage !== undefined ? errorMessage : current.error_message,
      ],
    );

    return getExperienceSyncJobById(jobId);
  });
}

async function getExperiencePostBySource({ sourcePlatform, sourcePostId }) {
  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE source_platform = $1 AND source_post_id = $2
      LIMIT 1
      `,
      [sourcePlatform, sourcePostId],
    );

    return normalizeExperiencePostRow(result.rows[0] || null);
  });
}

async function getExperiencePostById(postId) {
  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE id = $1
      LIMIT 1
      `,
      [postId],
    );

    return normalizeExperiencePostRow(result.rows[0] || null);
  });
}

async function insertExperiencePostWithGroups({ post, groups = [] }) {
  return withClient(async (client) => {
    await client.query('BEGIN');

    try {
      await client.query(
        `
        INSERT INTO experience_post (
          id, source_platform, source_post_id, source_url, keyword, title, author_name,
          published_at, content_raw, content_cleaned, summary, company_name, role_name,
          interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
          created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19,
          COALESCE($20::timestamptz, now()), COALESCE($21::timestamptz, now())
        )
        `,
        [
          post.id,
          post.source_platform,
          post.source_post_id,
          post.source_url,
          post.keyword || '',
          post.title || '',
          post.author_name || '',
          post.published_at || null,
          post.content_raw || '',
          post.content_cleaned || '',
          post.summary || '',
          post.company_name || '',
          post.role_name || '',
          post.interview_stage || '未知',
          Number(post.quality_score || 0),
          Boolean(post.is_valid),
          post.clean_status || 'completed',
          post.crawl_job_id || null,
          post.content_hash || '',
          post.created_at || null,
          post.updated_at || null,
        ],
      );

      for (const group of groups) {
        await client.query(
          `
          INSERT INTO experience_question_group (
            id, post_id, topic_cluster, canonical_question, group_order,
            group_type, frequency_score, confidence, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, now(), now()
          )
          `,
          [
            group.id,
            post.id,
            group.topic_cluster || '',
            group.canonical_question || '',
            Number(group.group_order || 0),
            group.group_type || 'single',
            Number(group.frequency_score || 0),
            Number(group.confidence || 0),
          ],
        );

        for (const item of group.items || []) {
          await client.query(
            `
            INSERT INTO experience_question_item (
              id, group_id, post_id, question_text_raw, question_text_normalized, question_role,
              order_in_group, parent_item_id, category, difficulty, follow_up_intent,
              expected_points_json, knowledge_points_json, embedding_id, created_at, updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11,
              $12::jsonb, $13::jsonb, $14, now(), now()
            )
            `,
            [
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
            ],
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return getExperiencePostDetail(post.id);
  });
}

async function updateExperiencePostWithGroups({ postId, post, groups = [] }) {
  return withClient(async (client) => {
    const existingResult = await client.query(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE id = $1
      LIMIT 1
      `,
      [postId],
    );

    const existingPost = normalizeExperiencePostRow(existingResult.rows[0] || null);
    if (!existingPost) {
      return null;
    }

    await client.query('BEGIN');

    try {
      await client.query(
        `
        UPDATE experience_post
        SET source_url = $2,
            keyword = $3,
            title = $4,
            author_name = $5,
            published_at = $6,
            content_raw = $7,
            content_cleaned = $8,
            summary = $9,
            company_name = $10,
            role_name = $11,
            interview_stage = $12,
            quality_score = $13,
            is_valid = $14,
            clean_status = $15,
            crawl_job_id = $16,
            content_hash = $17,
            updated_at = COALESCE($18::timestamptz, now())
        WHERE id = $1
        `,
        [
          postId,
          post.source_url || existingPost.source_url || '',
          post.keyword || existingPost.keyword || '',
          post.title || existingPost.title || '',
          post.author_name || existingPost.author_name || '',
          post.published_at || existingPost.published_at || null,
          post.content_raw || existingPost.content_raw || '',
          post.content_cleaned || '',
          post.summary || '',
          post.company_name || '',
          post.role_name || '',
          post.interview_stage || '未知',
          Number(post.quality_score || 0),
          Boolean(post.is_valid),
          post.clean_status || 'completed',
          post.crawl_job_id || existingPost.crawl_job_id || null,
          post.content_hash || existingPost.content_hash || '',
          post.updated_at || null,
        ],
      );

      await client.query('DELETE FROM experience_question_item WHERE post_id = $1', [postId]);
      await client.query('DELETE FROM experience_question_group WHERE post_id = $1', [postId]);

      for (const group of groups) {
        await client.query(
          `
          INSERT INTO experience_question_group (
            id, post_id, topic_cluster, canonical_question, group_order,
            group_type, frequency_score, confidence, created_at, updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, now(), now()
          )
          `,
          [
            group.id,
            postId,
            group.topic_cluster || '',
            group.canonical_question || '',
            Number(group.group_order || 0),
            group.group_type || 'single',
            Number(group.frequency_score || 0),
            Number(group.confidence || 0),
          ],
        );

        for (const item of group.items || []) {
          await client.query(
            `
            INSERT INTO experience_question_item (
              id, group_id, post_id, question_text_raw, question_text_normalized, question_role,
              order_in_group, parent_item_id, category, difficulty, follow_up_intent,
              expected_points_json, knowledge_points_json, embedding_id, created_at, updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8, $9, $10, $11,
              $12::jsonb, $13::jsonb, $14, now(), now()
            )
            `,
            [
              item.id,
              group.id,
              postId,
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
            ],
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    return getExperiencePostDetail(postId);
  });
}

async function listExperiencePosts({
  query,
  days,
  company,
  role,
  onlyValid = true,
  limit = 20,
  offset = 0,
}) {
  return withClient(async (client) => {
    const where = [];
    const params = [];
    let paramIndex = 1;

    if (onlyValid) {
      where.push('p.is_valid = TRUE');
    }

    if (query) {
      const like = `%${query}%`;
      where.push(`(
        p.title ILIKE $${paramIndex} OR
        p.summary ILIKE $${paramIndex + 1} OR
        p.content_cleaned ILIKE $${paramIndex + 2} OR
        EXISTS (
          SELECT 1 FROM experience_question_item qi
          WHERE qi.post_id = p.id
            AND (qi.question_text_raw ILIKE $${paramIndex + 3} OR qi.question_text_normalized ILIKE $${paramIndex + 4})
        )
      )`);
      params.push(like, like, like, like, like);
      paramIndex += 5;
    }

    if (company) {
      where.push(`p.company_name ILIKE $${paramIndex}`);
      params.push(`%${company}%`);
      paramIndex += 1;
    }

    if (role) {
      where.push(`p.role_name ILIKE $${paramIndex}`);
      params.push(`%${role}%`);
      paramIndex += 1;
    }

    if (Number(days) > 0) {
      where.push(`p.published_at >= now() - ($${paramIndex}::int * interval '1 day')`);
      params.push(Number(days));
      paramIndex += 1;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const itemsResult = await client.query(
      `
      SELECT
        p.id, p.title, p.source_platform, p.source_url, p.company_name, p.role_name,
        p.interview_stage, p.published_at, p.summary, p.quality_score,
        COUNT(DISTINCT g.id)::int AS question_group_count,
        COUNT(DISTINCT qi.id)::int AS question_item_count
      FROM experience_post p
      LEFT JOIN experience_question_group g ON g.post_id = p.id
      LEFT JOIN experience_question_item qi ON qi.post_id = p.id
      ${whereClause}
      GROUP BY p.id
      ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      [...params, Number(limit), Number(offset)],
    );

    const totalResult = await client.query(
      `
      SELECT COUNT(*)::int AS total
      FROM experience_post p
      ${whereClause}
      `,
      params,
    );

    return {
      items: itemsResult.rows.map((row) => ({
        ...row,
        quality_score: Number(row.quality_score || 0),
        question_group_count: Number(row.question_group_count || 0),
        question_item_count: Number(row.question_item_count || 0),
      })),
      total: Number(totalResult.rows[0]?.total || 0),
    };
  });
}

async function getExperiencePostDetail(postId) {
  return withClient(async (client) => {
    const postResult = await client.query(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, quality_score, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE id = $1
      LIMIT 1
      `,
      [postId],
    );

    const post = normalizeExperiencePostRow(postResult.rows[0] || null);
    if (!post) return null;

    const groupsResult = await client.query(
      `
      SELECT id, post_id, topic_cluster, canonical_question, group_order,
             group_type, frequency_score, confidence, created_at, updated_at
      FROM experience_question_group
      WHERE post_id = $1
      ORDER BY group_order ASC, created_at ASC
      `,
      [postId],
    );

    const itemsResult = await client.query(
      `
      SELECT id, group_id, post_id, question_text_raw, question_text_normalized, question_role,
             order_in_group, parent_item_id, category, difficulty, follow_up_intent,
             expected_points_json, knowledge_points_json, embedding_id, created_at, updated_at
      FROM experience_question_item
      WHERE post_id = $1
      ORDER BY order_in_group ASC, created_at ASC
      `,
      [postId],
    );

    const itemsByGroupId = new Map();
    for (const item of itemsResult.rows.map(normalizeExperienceItemRow)) {
      const list = itemsByGroupId.get(item.group_id) || [];
      list.push(item);
      itemsByGroupId.set(item.group_id, list);
    }

    return {
      ...post,
      groups: groupsResult.rows.map((group) => ({
        ...normalizeExperienceGroupRow(group),
        items: itemsByGroupId.get(group.id) || [],
      })),
    };
  });
}

async function searchExperienceQuestionItems({ query, limit = 10 }) {
  return withClient(async (client) => {
    const like = `%${String(query || '').trim()}%`;
    const result = await client.query(
      `
      SELECT
        qi.id, qi.post_id, qi.group_id, qi.question_text_normalized, qi.question_role,
        qi.category, qi.difficulty, p.title AS source_post_title, p.source_url,
        p.company_name, p.role_name, p.published_at
      FROM experience_question_item qi
      INNER JOIN experience_post p ON p.id = qi.post_id
      WHERE p.is_valid = TRUE
        AND (
          qi.question_text_raw ILIKE $1
          OR qi.question_text_normalized ILIKE $2
          OR p.title ILIKE $3
          OR p.summary ILIKE $4
        )
      ORDER BY p.published_at DESC NULLS LAST, qi.created_at DESC
      LIMIT $5
      `,
      [like, like, like, like, Number(limit)],
    );

    return result.rows;
  });
}

async function listExperiencePostIds({ onlyValid = false } = {}) {
  return withClient(async (client) => {
    const result = await client.query(
      `
      SELECT id
      FROM experience_post
      ${onlyValid ? 'WHERE is_valid = TRUE' : ''}
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      `,
    );

    return result.rows.map((item) => item.id);
  });
}

module.exports = {
  createExperienceSyncJob,
  getExperiencePostById,
  getExperiencePostBySource,
  getExperiencePostDetail,
  getExperienceSyncJobById,
  insertExperiencePostWithGroups,
  listExperiencePostIds,
  listExperiencePosts,
  searchExperienceQuestionItems,
  updateExperiencePostWithGroups,
  updateExperienceSyncJob,
};
