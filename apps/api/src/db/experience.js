const { db, parseJsonArray } = require('./core');

const createExperienceSyncJob = ({ id, userId, keyword, requestedLimit = 10 }) => {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO experience_sync_job (
      id, user_id, keyword, status, requested_limit,
      created_count, updated_count, skipped_count, failed_count,
      started_at, finished_at, error_message, created_at, updated_at
    )
    VALUES (?, ?, ?, 'pending', ?, 0, 0, 0, 0, NULL, NULL, '', ?, ?)
  `,
  ).run(id, userId, keyword, requestedLimit, now, now);
  return getExperienceSyncJobById(id);
};

const getExperienceSyncJobById = (jobId) =>
  db
    .prepare(
      `
      SELECT id, user_id, keyword, status, requested_limit,
             created_count, updated_count, skipped_count, failed_count,
             started_at, finished_at, error_message, created_at, updated_at
      FROM experience_sync_job
      WHERE id = ?
    `,
    )
    .get(jobId);

const getLatestActiveSyncJob = () =>
  db
    .prepare(
      `
      SELECT id, user_id, keyword, status, requested_limit,
             created_count, updated_count, skipped_count, failed_count,
             started_at, finished_at, error_message, created_at, updated_at
      FROM experience_sync_job
      WHERE status IN ('pending', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    )
    .get() || null;

const updateExperienceSyncJob = ({
  jobId,
  status,
  createdCount,
  updatedCount,
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
    updatedCount: updatedCount !== undefined ? updatedCount : current.updated_count,
    skippedCount: skippedCount !== undefined ? skippedCount : current.skipped_count,
    failedCount: failedCount !== undefined ? failedCount : current.failed_count,
    startedAt: startedAt !== undefined ? startedAt : current.started_at,
    finishedAt: finishedAt !== undefined ? finishedAt : current.finished_at,
    errorMessage: errorMessage !== undefined ? errorMessage : current.error_message,
  };

  db.prepare(
    `
    UPDATE experience_sync_job
    SET status = ?, created_count = ?, updated_count = ?, skipped_count = ?, failed_count = ?,
        started_at = ?, finished_at = ?, error_message = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(
    next.status,
    next.createdCount,
    next.updatedCount,
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

const getExperiencePostBySource = ({ sourcePlatform, sourcePostId }) =>
  db
    .prepare(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, popularity, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE source_platform = ? AND source_post_id = ?
    `,
    )
    .get(sourcePlatform, sourcePostId);

const getExperiencePostById = (postId) =>
  db
    .prepare(
      `
      SELECT id, source_platform, source_post_id, source_url, keyword, title, author_name,
             published_at, content_raw, content_cleaned, summary, company_name, role_name,
             interview_stage, popularity, is_valid, clean_status, crawl_job_id, content_hash,
             created_at, updated_at
      FROM experience_post
      WHERE id = ?
    `,
    )
    .get(postId);

const insertExperiencePostWithGroups = ({ post, groups = [] }) => {
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO experience_post (
        id, source_platform, source_post_id, source_url, keyword, title, author_name,
        published_at, content_raw, content_cleaned, summary, company_name, role_name,
        interview_stage, popularity, is_valid, clean_status, crawl_job_id, content_hash,
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
      Number(post.popularity || 0),
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
          group_type, frequency_score, confidence, embedding_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        group.embedding_json || '',
        now,
        now,
      );

      for (const item of group.items || []) {
        db.prepare(
          `
          INSERT INTO experience_question_item (
            id, group_id, post_id, question_text_raw, question_text_normalized, question_role,
            order_in_group, parent_item_id, category, difficulty, follow_up_intent,
            expected_points_json, knowledge_points_json, embedding_id, chain_anchor, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          item.chain_anchor || 'generic',
          now,
          now,
        );
      }
    }
  });

  transaction();

  return getExperiencePostDetail(post.id);
};

const updateExperiencePostWithGroups = ({ postId, post, groups = [] }) => {
  const existingPost = getExperiencePostById(postId);
  if (!existingPost) {
    return null;
  }

  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare(
      `
      UPDATE experience_post
      SET source_url = ?,
          keyword = ?,
          title = ?,
          author_name = ?,
          published_at = ?,
          content_raw = ?,
          content_cleaned = ?,
          summary = ?,
          company_name = ?,
          role_name = ?,
          interview_stage = ?,
          popularity = ?,
          is_valid = ?,
          clean_status = ?,
          crawl_job_id = ?,
          content_hash = ?,
          updated_at = ?
      WHERE id = ?
    `,
    ).run(
      post.source_url || existingPost.source_url || '',
      post.keyword || existingPost.keyword || '',
      post.title || existingPost.title || '',
      post.author_name || existingPost.author_name || '',
      post.published_at || existingPost.published_at || '',
      post.content_raw || existingPost.content_raw || '',
      post.content_cleaned || '',
      post.summary || '',
      post.company_name || '',
      post.role_name || '',
      post.interview_stage || '未知',
      Number(post.popularity || 0),
      post.is_valid ? 1 : 0,
      post.clean_status || 'completed',
      post.crawl_job_id || existingPost.crawl_job_id || null,
      post.content_hash || existingPost.content_hash || '',
      now,
      postId,
    );

    db.prepare(`DELETE FROM experience_question_item WHERE post_id = ?`).run(postId);
    db.prepare(`DELETE FROM experience_question_group WHERE post_id = ?`).run(postId);

    for (const group of groups) {
      db.prepare(
        `
        INSERT INTO experience_question_group (
          id, post_id, topic_cluster, canonical_question, group_order,
          group_type, frequency_score, confidence, embedding_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        group.id,
        postId,
        group.topic_cluster || '',
        group.canonical_question || '',
        Number(group.group_order || 0),
        group.group_type || 'single',
        Number(group.frequency_score || 0),
        Number(group.confidence || 0),
        group.embedding_json || '',
        now,
        now,
      );

      for (const item of group.items || []) {
        db.prepare(
          `
          INSERT INTO experience_question_item (
            id, group_id, post_id, question_text_raw, question_text_normalized, question_role,
            order_in_group, parent_item_id, category, difficulty, follow_up_intent,
            expected_points_json, knowledge_points_json, embedding_id, chain_anchor, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
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
          item.chain_anchor || 'generic',
          now,
          now,
        );
      }
    }
  });

  transaction();

  return getExperiencePostDetail(postId);
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
        p.interview_stage, p.published_at, p.summary, p.popularity,
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
             interview_stage, popularity, is_valid, clean_status, crawl_job_id, content_hash,
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
                 expected_points_json, knowledge_points_json, embedding_id, chain_anchor, created_at, updated_at
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
        qi.category, qi.difficulty, qi.chain_anchor, p.title AS source_post_title, p.source_url,
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

const listExperiencePostIds = ({ onlyValid = false } = {}) => {
  const whereClause = onlyValid ? 'WHERE is_valid = 1' : '';
  return db
    .prepare(
      `
      SELECT id
      FROM experience_post
      ${whereClause}
      ORDER BY datetime(substr(published_at, 1, 19)) DESC, created_at DESC
    `,
    )
    .all()
    .map((item) => item.id);
};

const listExperienceGroupEmbeddings = () =>
  db
    .prepare(
      `SELECT id, embedding_json FROM experience_question_group
       WHERE embedding_json != '' AND embedding_json IS NOT NULL`,
    )
    .all();

const getExperienceGroupsWithItems = (groupIds) => {
  if (!Array.isArray(groupIds) || groupIds.length === 0) return [];
  const placeholders = groupIds.map(() => '?').join(',');
  const groups = db
    .prepare(
      `SELECT id, post_id, topic_cluster, canonical_question, group_order,
              group_type, frequency_score, confidence, embedding_json
       FROM experience_question_group
       WHERE id IN (${placeholders})`,
    )
    .all(...groupIds);

  return groups.map((group) => ({
    ...group,
    items: db
      .prepare(
        `SELECT id, group_id, question_text_raw, question_text_normalized, question_role,
                order_in_group, parent_item_id, category, difficulty, follow_up_intent,
                expected_points_json, knowledge_points_json, chain_anchor
         FROM experience_question_item
         WHERE group_id = ?
         ORDER BY order_in_group ASC`,
      )
      .all(group.id)
      .map((item) => ({
        ...item,
        knowledge_points: JSON.parse(item.knowledge_points_json || '[]'),
        expected_points: JSON.parse(item.expected_points_json || '[]'),
      })),
  }));
};

const deleteExperiencePost = (postId) => {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM experience_question_item WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM experience_question_group WHERE post_id = ?').run(postId);
    db.prepare('DELETE FROM experience_post WHERE id = ?').run(postId);
  });
  tx();
};

module.exports = {
  createExperienceSyncJob,
  deleteExperiencePost,
  getExperienceGroupsWithItems,
  getExperiencePostById,
  getExperiencePostBySource,
  getExperiencePostDetail,
  getLatestActiveSyncJob,
  getExperienceSyncJobById,
  insertExperiencePostWithGroups,
  listExperienceGroupEmbeddings,
  listExperiencePostIds,
  listExperiencePosts,
  searchExperienceQuestionItems,
  updateExperiencePostWithGroups,
  updateExperienceSyncJob,
};

