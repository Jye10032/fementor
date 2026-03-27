const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_DELAY_MS = 1200;
const DEFAULT_OUTPUT_PATH = path.resolve(__dirname, '../../../data/crawled/niuke-experiences.json');
const NOWCODER_ORIGIN = 'https://www.nowcoder.com';

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const normalizeWhitespace = (value) =>
  String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const tokenizeKeyword = (value) =>
  String(value || '')
    .split(/[\s,，。！？?!.;；:：()（）[\]【】{}<>《》\-_/]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 1);

const decodeHtmlEntities = (value) =>
  String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

const stripHtml = (html) =>
  normalizeWhitespace(
    decodeHtmlEntities(
      String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
};

const toAbsoluteUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (raw.startsWith('//')) {
    return `https:${raw}`;
  }

  if (raw.startsWith('/')) {
    return `${NOWCODER_ORIGIN}${raw}`;
  }

  return '';
};

const normalizeArticleUrl = (value) => {
  const raw = toAbsoluteUrl(value);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (!/nowcoder\.com$/i.test(url.hostname)) {
      return '';
    }
    url.hash = '';

    if (url.pathname.startsWith('/feed/main/detail/')) {
      url.search = '';
      return url.toString();
    }

    if (url.pathname.startsWith('/discuss/')) {
      const keptQuery = new URLSearchParams();
      const detailId = url.searchParams.get('commentId') || url.searchParams.get('id');
      if (detailId) {
        keptQuery.set('id', detailId);
      }
      url.search = keptQuery.toString();
      return url.toString();
    }

    return '';
  } catch {
    return '';
  }
};

const buildSearchUrls = ({ keyword, page, listUrl }) => {
  if (listUrl) {
    const replaced = listUrl
      .replace(/\{keyword\}/g, encodeURIComponent(keyword))
      .replace(/\{page\}/g, String(page));
    return [replaced];
  }

  const encodedKeyword = encodeURIComponent(keyword);
  return [
    `${NOWCODER_ORIGIN}/search?type=post&query=${encodedKeyword}&page=${page}`,
    `${NOWCODER_ORIGIN}/search?query=${encodedKeyword}&type=post&page=${page}`,
    `${NOWCODER_ORIGIN}/discuss?query=${encodedKeyword}&page=${page}`,
    `${NOWCODER_ORIGIN}/discuss?type=post&query=${encodedKeyword}&page=${page}`,
    `${NOWCODER_ORIGIN}/discuss?keyword=${encodedKeyword}&page=${page}`,
  ];
};

const fetchHtml = async (url, options = {}) => {
  const timeoutMs = clampNumber(options.timeoutMs, 1000, 60000, DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': options.userAgent || 'Mozilla/5.0 (compatible; FEMentorBot/0.1; +https://www.nowcoder.com)',
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer: NOWCODER_ORIGIN,
        ...options.headers,
      },
    });

    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
};

const findMetaContent = (html, attrs) => {
  for (const attr of attrs) {
    const regex = new RegExp(
      `<meta[^>]+(?:name|property)=["']${attr}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i',
    );
    const reverseRegex = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${attr}["'][^>]*>`,
      'i',
    );
    const match = html.match(regex) || html.match(reverseRegex);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }
  return '';
};

const findTitle = (html) => {
  const metaTitle = findMetaContent(html, ['og:title', 'twitter:title']);
  if (metaTitle) return metaTitle;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    return stripHtml(h1Match[1]);
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return stripHtml(titleMatch[1]).replace(/[-|_].*$/, '').trim();
  }

  return '';
};

const findPublishedAt = (html) => {
  const metaPublished = findMetaContent(html, [
    'article:published_time',
    'og:published_time',
    'publish-date',
    'pubdate',
  ]);
  if (metaPublished) return metaPublished;

  const patterns = [
    /(?:发布时间|发表于|更新于|时间)[^0-9]{0,8}(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i,
    /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)/,
    /(\d{4}\/\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return '';
};

const extractBlockByClass = (html, className) => {
  const classPattern = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `<([a-z]+)[^>]*class=["'][^"']*${classPattern}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  );
  const match = html.match(regex);
  return match?.[2] || '';
};

const extractTextByClass = (html, className) => stripHtml(extractBlockByClass(html, className));

const extractCandidateBlocks = (html) => {
  const blocks = [];
  const blockRegex = /<(article|main|section|div)[^>]*>([\s\S]*?)<\/\1>/gi;

  for (const match of html.matchAll(blockRegex)) {
    const contentHtml = match[2];
    const text = stripHtml(contentHtml);
    if (text.length < 180) {
      continue;
    }
    blocks.push({
      text,
      html: contentHtml,
      score: text.length,
    });
  }

  return blocks.sort((a, b) => b.score - a.score);
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const collectJsonCandidates = (input, bucket = []) => {
  if (!input) return bucket;

  if (Array.isArray(input)) {
    for (const item of input) {
      collectJsonCandidates(item, bucket);
    }
    return bucket;
  }

  if (typeof input !== 'object') {
    return bucket;
  }

  const title = input.title || input.postTitle || input.name || input.questionName || '';
  const content =
    input.content ||
    input.postContent ||
    input.desc ||
    input.description ||
    input.articleBody ||
    input.body ||
    '';

  if (title || content) {
    bucket.push({
      title: normalizeWhitespace(decodeHtmlEntities(String(title || ''))),
      content: normalizeWhitespace(
        decodeHtmlEntities(typeof content === 'string' ? stripHtml(content) : '')
      ),
      author: normalizeWhitespace(
        String(input.authorName || input.nickName || input.author?.name || input.userName || '')
      ),
      publishedAt: normalizeWhitespace(
        String(input.publishTime || input.createdAt || input.updatedAt || input.datePublished || '')
      ),
      tags: Array.isArray(input.tags)
        ? input.tags.map((tag) => normalizeWhitespace(tag?.name || tag)).filter(Boolean)
        : [],
    });
  }

  for (const value of Object.values(input)) {
    collectJsonCandidates(value, bucket);
  }

  return bucket;
};

const extractJsonArticle = (html) => {
  const candidates = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRegex)) {
    const scriptText = match[1]?.trim();
    if (!scriptText || scriptText.length < 20) {
      continue;
    }

    const directJson = safeJsonParse(scriptText);
    if (directJson) {
      collectJsonCandidates(directJson, candidates);
    }

    const assignMatch = scriptText.match(/=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?\s*$/);
    if (assignMatch?.[1]) {
      const assignedJson = safeJsonParse(assignMatch[1]);
      if (assignedJson) {
        collectJsonCandidates(assignedJson, candidates);
      }
    }
  }

  return candidates
    .filter((candidate) => candidate.title || candidate.content)
    .sort((a, b) => (b.content?.length || 0) - (a.content?.length || 0))[0] || null;
};

const extractArticleLinks = (html) => {
  const links = new Set();
  const hrefRegex = /href=["']([^"']+)["']/gi;

  for (const match of html.matchAll(hrefRegex)) {
    const normalized = normalizeArticleUrl(match[1]);
    if (normalized) {
      links.add(normalized);
    }
  }

  const textUrlRegex = /https?:\/\/www\.nowcoder\.com\/(?:discuss\/[^\s"'<>]+|feed\/main\/detail\/\d+)/gi;
  for (const match of html.matchAll(textUrlRegex)) {
    const normalized = normalizeArticleUrl(match[0]);
    if (normalized) {
      links.add(normalized);
    }
  }

  return [...links];
};

const selectBestBodyText = (html, jsonArticle) => {
  const preferredBlocks = [
    extractBlockByClass(html, 'feed-content-text'),
    extractBlockByClass(html, 'nc-slate-editor-content'),
  ]
    .map((block) => stripHtml(block))
    .filter(Boolean);

  const combinedPreferred = normalizeWhitespace(
    preferredBlocks
      .filter((block) => block.length >= 20)
      .join('\n\n')
  );

  if (combinedPreferred.length >= 60) {
    return combinedPreferred;
  }

  if (jsonArticle?.content && jsonArticle.content.length >= 200) {
    return jsonArticle.content;
  }

  const blocks = extractCandidateBlocks(html);
  if (blocks[0]?.text) {
    return blocks[0].text;
  }

  return stripHtml(html);
};

const extractArticle = (url, html) => {
  const jsonArticle = extractJsonArticle(html);
  const title = findTitle(html) || jsonArticle?.title || '';
  const content = selectBestBodyText(html, jsonArticle);
  const summary = findMetaContent(html, ['description', 'og:description', 'twitter:description']);
  const author = normalizeWhitespace(
    extractTextByClass(html, 'user-nickname') ||
      findMetaContent(html, ['author', 'article:author']) ||
      jsonArticle?.author ||
      ''
  );
  const publishedAt = normalizeWhitespace(
    extractTextByClass(html, 'time-text') ||
      findPublishedAt(html) ||
      jsonArticle?.publishedAt ||
      ''
  );
  const tags = [
    ...new Set(
      [
        ...String(findMetaContent(html, ['keywords']))
          .split(/[，,]/)
          .map((item) => item.trim())
          .filter(Boolean),
        ...(jsonArticle?.tags || []),
      ]
    ),
  ].slice(0, 20);

  return {
    url,
    title: normalizeWhitespace(title),
    author,
    publishedAt,
    summary: normalizeWhitespace(summary),
    content,
    tags,
    wordCount: content.length,
    crawledAt: new Date().toISOString(),
  };
};

const scoreArticleRelevance = (article, keyword) => {
  const tokens = tokenizeKeyword(keyword);
  if (tokens.length === 0) {
    return { matchedTokens: [], score: 0, isRelevant: true };
  }

  const haystack = [
    article.title,
    article.summary,
    article.content,
    ...(article.tags || []),
  ]
    .join('\n')
    .toLowerCase();

  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  const titleMatchedTokens = tokens.filter((token) => String(article.title || '').toLowerCase().includes(token));
  const score = matchedTokens.length * 2 + titleMatchedTokens.length * 3;
  const isRelevant =
    matchedTokens.length === tokens.length ||
    score >= Math.min(4, tokens.length * 2) ||
    (tokens.length === 1 && matchedTokens.length === 1);

  return {
    matchedTokens,
    score,
    isRelevant,
  };
};

const crawlListPage = async ({ keyword, page, listUrl, timeoutMs, verbose = false }) => {
  const candidateUrls = buildSearchUrls({ keyword, page, listUrl });
  const attempts = [];

  for (const candidateUrl of candidateUrls) {
    try {
      const response = await fetchHtml(candidateUrl, { timeoutMs });
      const links = extractArticleLinks(response.text);
      attempts.push({
        url: candidateUrl,
        status: response.status,
        links: links.length,
      });

      if (response.ok && links.length > 0) {
        return {
          sourceUrl: response.url,
          links,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        url: candidateUrl,
        status: 0,
        links: 0,
        error: error.message,
      });
    }
  }

  if (verbose) {
    console.warn('[niuke-crawler.list.failed]', attempts);
  }

  return {
    sourceUrl: candidateUrls[0],
    links: [],
    attempts,
  };
};

const crawlArticlePage = async ({ url, timeoutMs }) => {
  const response = await fetchHtml(url, { timeoutMs });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const article = extractArticle(response.url || url, response.text);
  if (!article.title && !article.content) {
    throw new Error('Unable to extract article content');
  }

  return article;
};

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const writeJsonFile = (filePath, payload) => {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const crawlNiukeExperiences = async (options = {}) => {
  const keyword = String(options.keyword || '前端 面经').trim();
  const pages = clampNumber(options.pages, 1, 100, 3);
  const maxItems = clampNumber(options.maxItems, 1, 500, 30);
  const delayMs = clampNumber(options.delayMs, 0, 60000, DEFAULT_DELAY_MS);
  const timeoutMs = clampNumber(options.timeoutMs, 1000, 60000, DEFAULT_TIMEOUT_MS);
  const verbose = Boolean(options.verbose);
  const directArticleUrls = Array.isArray(options.articleUrls)
    ? options.articleUrls.map(normalizeArticleUrl).filter(Boolean)
    : [];

  const articleQueue = [];
  const seenUrls = new Set();
  const listPages = [];
  const maxCandidateLinks = Math.max(maxItems * 5, 50);

  for (const articleUrl of directArticleUrls) {
    if (!seenUrls.has(articleUrl)) {
      seenUrls.add(articleUrl);
      articleQueue.push(articleUrl);
    }
  }

  if (articleQueue.length === 0) {
    for (let page = 1; page <= pages && articleQueue.length < maxCandidateLinks; page += 1) {
      const listResult = await crawlListPage({
        keyword,
        page,
        listUrl: options.listUrl,
        timeoutMs,
        verbose,
      });

      listPages.push({
        page,
        sourceUrl: listResult.sourceUrl,
        attempts: listResult.attempts,
        discoveredCount: listResult.links.length,
      });

      for (const link of listResult.links) {
        if (articleQueue.length >= maxCandidateLinks) {
          break;
        }

        if (!seenUrls.has(link)) {
          seenUrls.add(link);
          articleQueue.push(link);
        }
      }

      if (page < pages && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  const items = [];
  const failures = [];
  const skipped = [];

  for (let index = 0; index < articleQueue.length; index += 1) {
    const url = articleQueue[index];
    try {
      const article = await crawlArticlePage({ url, timeoutMs });

      const relevance = scoreArticleRelevance(article, keyword);
      if (!relevance.isRelevant) {
        skipped.push({
          url,
          title: article.title,
          matchedTokens: relevance.matchedTokens,
          score: relevance.score,
        });
        if (verbose) {
          console.warn(`[niuke-crawler.article.skipped] ${url} score=${relevance.score}`);
        }
      } else {
        items.push({
          ...article,
          relevance: {
            matchedTokens: relevance.matchedTokens,
            score: relevance.score,
          },
        });
        if (verbose) {
          console.log(`[niuke-crawler.article.ok] ${items.length}/${maxItems} ${article.title || url}`);
        }
      }

      if (items.length >= maxItems) {
        break;
      }

    } catch (error) {
      failures.push({
        url,
        error: error.message,
      });
      if (verbose) {
        console.warn(`[niuke-crawler.article.failed] ${url} ${error.message}`);
      }
    }

    if (index < articleQueue.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return {
    meta: {
      keyword,
      pages,
      maxItems,
      delayMs,
      timeoutMs,
      fetchedAt: new Date().toISOString(),
      discoveredCount: articleQueue.length,
      successCount: items.length,
      failureCount: failures.length,
      skippedCount: skipped.length,
    },
    listPages,
    items,
    failures,
    skipped,
  };
};

const saveNiukeExperiences = async (options = {}) => {
  const outputPath = path.resolve(options.output || DEFAULT_OUTPUT_PATH);
  const result = await crawlNiukeExperiences(options);
  writeJsonFile(outputPath, result);
  return {
    ...result,
    outputPath,
  };
};

module.exports = {
  DEFAULT_OUTPUT_PATH,
  crawlNiukeExperiences,
  saveNiukeExperiences,
  normalizeArticleUrl,
};
