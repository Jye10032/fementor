const { randomUUID } = require('crypto');
const { getExperienceStore } = require('./store');
const { crawlNiukeExperiences } = require('../niuke-crawler');
const {
  cleanExperienceContent,
  buildPostInsertPayload,
  buildGroupsInsertPayload,
} = require('./cleaner');

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

    for (const article of crawlResult.items || []) {
      if (createdCount >= limit) {
        skippedCount += 1;
        continue;
      }

      if (!isWithinDays(article.publishedAt, days)) {
        skippedCount += 1;
        continue;
      }

      const sourcePostId = normalizeSourcePostId(article.url);
      if (!sourcePostId) {
        failedCount += 1;
        continue;
      }

      const existed = await store.getExperiencePostBySource({
        sourcePlatform: 'nowcoder',
        sourcePostId,
      });
      if (existed) {
        skippedCount += 1;
        continue;
      }

      try {
        const cleaned = await cleanExperienceContent({
          title: article.title,
          sourceUrl: article.url,
          publishedAt: article.publishedAt,
          keyword,
          contentRaw: article.content,
        });

        const post = buildPostInsertPayload({
          jobId,
          keyword,
          article: {
            ...article,
            url: article.url,
            publishedAt: normalizePublishedAt(article.publishedAt),
          },
          cleaned,
        });
        post.source_post_id = sourcePostId;
        const groups = buildGroupsInsertPayload({
          postId: post.id,
          topicGroups: cleaned.topic_groups,
        });

        await store.insertExperiencePostWithGroups({ post, groups });
        createdCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error('[experience.sync.item.failed]', {
          job_id: jobId,
          url: article.url,
          error: error.message,
        });
      }
    }

    await store.updateExperienceSyncJob({
      jobId,
      status: 'completed',
      createdCount,
      skippedCount,
      failedCount,
      finishedAt: new Date().toISOString(),
      errorMessage: '',
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
  listExperiencePosts: (...args) => getExperienceStore().listExperiencePosts(...args),
  getExperiencePostDetail: (...args) => getExperienceStore().getExperiencePostDetail(...args),
  recleanExperiencePost,
  recleanAllExperiencePosts,
  searchExperienceQuestionItems: (...args) => getExperienceStore().searchExperienceQuestionItems(...args),
  normalizePublishedAt,
};
