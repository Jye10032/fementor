const { randomUUID } = require('crypto');
const { getExperienceStore } = require('./store');
const { crawlNiukeExperiences } = require('../niuke-crawler');
const {
  cleanExperienceContent,
  buildPostInsertPayload,
  buildGroupsInsertPayload,
} = require('./cleaner');
const { setGroupEmbedding } = require('./embedding-cache');
const { updateGraphIncremental, buildKnowledgeGraph } = require('./knowledge-graph');
const { hasRealLLM, embeddingCompletion } = require('../llm');

const runningJobs = new Set();

const parsePublishedAt = (value, now = new Date()) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const year = now.getUTCFullYear();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, yyyy, mm, dd, hh = '0', mi = '0', ss = '0'] = match;
    return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
  }

  match = raw.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const [, mm, dd, hh, mi] = match;
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(mi), 0));
  }

  match = raw.match(/^昨天\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const [, hh, mi] = match;
    return new Date(Date.UTC(
      yesterday.getUTCFullYear(),
      yesterday.getUTCMonth(),
      yesterday.getUTCDate(),
      Number(hh),
      Number(mi),
      0,
    ));
  }

  return null;
};

const normalizePublishedAt = (value) => {
  const parsed = parsePublishedAt(value);
  return parsed ? parsed.toISOString() : String(value || '').trim();
};

const isWithinDays = (publishedAt, days = 7) => {
  const parsed = parsePublishedAt(publishedAt);
  if (!parsed) return true;
  const threshold = Date.now() - Number(days) * 24 * 60 * 60 * 1000;
  return parsed.getTime() >= threshold;
};

const normalizeSourcePostId = (url) => String(url || '').split('/').pop()?.split('?')[0] || '';

const buildSyncedArticlePayload = (article) => ({
  ...article,
  url: article.url,
  publishedAt: normalizePublishedAt(article.publishedAt),
});

const cleanExperienceArticle = async ({ title, sourceUrl, publishedAt, keyword, contentRaw }) =>
  cleanExperienceContent({
    title,
    sourceUrl,
    publishedAt,
    keyword,
    contentRaw,
  });

const buildGroupEmbeddingText = (group) => {
  const items = Array.isArray(group.items) ? group.items : [];
  const texts = [group.canonical_question || ''];
  for (const item of items) {
    const t = String(item.question_text_normalized || item.question_text_raw || '').trim();
    if (t) texts.push(t);
  }
  return texts.join(' | ').slice(0, 2000);
};

const computeGroupEmbeddings = async (groups) => {
  if (!hasRealLLM()) return;
  for (const group of groups) {
    try {
      const text = buildGroupEmbeddingText(group);
      if (!text || text.length < 4) continue;
      const embedding = await embeddingCompletion({ input: text });
      if (Array.isArray(embedding) && embedding.length > 0) {
        group.embedding_json = JSON.stringify(embedding);
        setGroupEmbedding(group.id, embedding);
      }
    } catch (error) {
      console.warn('[experience.embedding.failed]', { group_id: group.id, error: error.message });
    }
  }
};

const upsertExperienceArticle = async ({ store, jobId, keyword, article, existingPost = null }) => {
  const cleaned = await cleanExperienceArticle({
    title: article.title,
    sourceUrl: article.url,
    publishedAt: article.publishedAt,
    keyword,
    contentRaw: article.content,
  });

  if (!cleaned.is_valid) {
    return { skipped: true };
  }

  const syncedArticle = buildSyncedArticlePayload(article);
  const post = buildPostInsertPayload({
    jobId,
    keyword,
    article: syncedArticle,
    cleaned,
  });

  if (existingPost) {
    post.id = existingPost.id;
    post.source_post_id = existingPost.source_post_id;
    post.source_platform = existingPost.source_platform;
    post.created_at = existingPost.created_at;
    post.updated_at = new Date().toISOString();

    const groups = buildGroupsInsertPayload({
      postId: existingPost.id,
      topicGroups: cleaned.topic_groups,
    });

    await computeGroupEmbeddings(groups);
    updateGraphIncremental(groups);

    return store.updateExperiencePostWithGroups({
      postId: existingPost.id,
      post,
      groups,
    });
  }

  post.source_post_id = normalizeSourcePostId(article.url);
  const groups = buildGroupsInsertPayload({
    postId: post.id,
    topicGroups: cleaned.topic_groups,
  });

  await computeGroupEmbeddings(groups);
  updateGraphIncremental(groups);

  return store.insertExperiencePostWithGroups({ post, groups });
};

const persistExperienceSyncProgress = async ({
  store,
  jobId,
  createdCount,
  skippedCount,
  failedCount,
}) =>
  store.updateExperienceSyncJob({
    jobId,
    status: 'running',
    createdCount,
    skippedCount,
    failedCount,
  });

const runExperienceSyncJob = async ({ jobId, userId, keyword, days = 7, limit = 10 }) => {
  const store = getExperienceStore();
  if (runningJobs.has(jobId)) {
    return;
  }
  runningJobs.add(jobId);
  await store.updateExperienceSyncJob({
    jobId,
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  try {
    const crawlResult = await crawlNiukeExperiences({
      keyword,
      pages: 3,
      maxItems: Math.max(limit * 4, 30),
      delayMs: 300,
      timeoutMs: 15000,
    });

    let createdCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const CONCURRENCY = 3;
    const pending = [];

    const processArticle = async (article) => {
      const sourcePostId = normalizeSourcePostId(article.url);
      if (!sourcePostId) {
        failedCount += 1;
        await persistExperienceSyncProgress({ store, jobId, createdCount, skippedCount, failedCount });
        return;
      }

      const existed = await store.getExperiencePostBySource({
        sourcePlatform: 'nowcoder',
        sourcePostId,
      });

      if (!existed && createdCount >= limit) {
        skippedCount += 1;
        await persistExperienceSyncProgress({ store, jobId, createdCount, skippedCount, failedCount });
        return;
      }

      if (existed) {
        skippedCount += 1;
        await persistExperienceSyncProgress({ store, jobId, createdCount, skippedCount, failedCount });
        return;
      }

      try {
        const result = await upsertExperienceArticle({
          store,
          jobId,
          keyword,
          article,
          existingPost: existed,
        });

        if (result?.skipped) {
          skippedCount += 1;
        } else {
          createdCount += 1;
        }
        await persistExperienceSyncProgress({ store, jobId, createdCount, skippedCount, failedCount });
      } catch (error) {
        failedCount += 1;
        await persistExperienceSyncProgress({ store, jobId, createdCount, skippedCount, failedCount });
        console.error('[experience.sync.item.failed]', {
          job_id: jobId,
          url: article.url,
          error: error.message,
        });
      }
    };

    for (const article of crawlResult.items || []) {
      const task = processArticle(article);
      pending.push(task);

      if (pending.length >= CONCURRENCY) {
        await Promise.race(pending);
        // Remove settled promises
        for (let i = pending.length - 1; i >= 0; i--) {
          const settled = await Promise.race([pending[i].then(() => true), Promise.resolve(false)]);
          if (settled) pending.splice(i, 1);
        }
      }
    }

    await Promise.all(pending);

    await store.updateExperienceSyncJob({
      jobId,
      status: 'completed',
      createdCount,
      skippedCount,
      failedCount,
      finishedAt: new Date().toISOString(),
      errorMessage: '',
    });

    setImmediate(() => {
      void buildKnowledgeGraph(store).catch((err) =>
        console.warn('[knowledge-graph.rebuild.failed]', err.message));
    });
  } catch (error) {
    await store.updateExperienceSyncJob({
      jobId,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: error.message,
    });
  } finally {
    runningJobs.delete(jobId);
  }
};

const startExperienceSync = async ({ userId, keyword, days = 7, limit = 10 }) => {
  const store = getExperienceStore();
  const jobId = `exp_sync_${randomUUID()}`;
  const job = await store.createExperienceSyncJob({
    id: jobId,
    userId,
    keyword,
    requestedLimit: limit,
  });

  setImmediate(() => {
    void runExperienceSyncJob({ jobId, userId, keyword, days, limit });
  });

  return job;
};

const recleanExperiencePost = async ({ postId }) => {
  const store = getExperienceStore();
  const existingPost = await store.getExperiencePostById(postId);
  if (!existingPost) {
    return null;
  }

  const cleaned = await cleanExperienceContent({
    title: existingPost.title,
    sourceUrl: existingPost.source_url,
    publishedAt: existingPost.published_at,
    keyword: existingPost.keyword,
    contentRaw: existingPost.content_raw,
  });

  const nextPost = buildPostInsertPayload({
    jobId: existingPost.crawl_job_id,
    keyword: existingPost.keyword,
    article: {
      title: existingPost.title,
      url: existingPost.source_url,
      author: existingPost.author_name,
      publishedAt: existingPost.published_at,
      content: existingPost.content_raw,
      summary: existingPost.summary,
      popularity: existingPost.popularity,
    },
    cleaned,
  });

  nextPost.id = existingPost.id;
  nextPost.source_post_id = existingPost.source_post_id;
  nextPost.source_platform = existingPost.source_platform;
  nextPost.created_at = existingPost.created_at;
  nextPost.updated_at = new Date().toISOString();

  const groups = buildGroupsInsertPayload({
    postId: existingPost.id,
    topicGroups: cleaned.topic_groups,
  });

  await computeGroupEmbeddings(groups);

  return store.updateExperiencePostWithGroups({
    postId: existingPost.id,
    post: nextPost,
    groups,
  });
};

const recleanAllExperiencePosts = async ({ onlyValid = false, onProgress } = {}) => {
  const store = getExperienceStore();
  const postIds = await store.listExperiencePostIds({ onlyValid });
  let completedCount = 0;
  let failedCount = 0;
  const failedItems = [];

  for (const postId of postIds) {
    try {
      const item = await recleanExperiencePost({ postId });
      completedCount += item ? 1 : 0;
      if (!item) {
        failedCount += 1;
        failedItems.push({ post_id: postId, error: 'experience not found' });
      }
    } catch (error) {
      failedCount += 1;
      failedItems.push({
        post_id: postId,
        error: error instanceof Error ? error.message : 'reclean failed',
      });
    }

    if (typeof onProgress === 'function') {
      onProgress({
        total: postIds.length,
        completed_count: completedCount,
        failed_count: failedCount,
        current_post_id: postId,
      });
    }
  }

  return {
    total_count: postIds.length,
    completed_count: completedCount,
    failed_count: failedCount,
    failed_items: failedItems,
  };
};

module.exports = {
  startExperienceSync,
  getExperienceSyncJobById: (...args) => getExperienceStore().getExperienceSyncJobById(...args),
  getLatestActiveSyncJob: (...args) => getExperienceStore().getLatestActiveSyncJob(...args),
  listExperiencePosts: (...args) => getExperienceStore().listExperiencePosts(...args),
  getExperiencePostDetail: (...args) => getExperienceStore().getExperiencePostDetail(...args),
  recleanExperiencePost,
  recleanAllExperiencePosts,
  searchExperienceQuestionItems: (...args) => getExperienceStore().searchExperienceQuestionItems(...args),
  deleteExperiencePost: (...args) => getExperienceStore().deleteExperiencePost(...args),
  normalizePublishedAt,
};
