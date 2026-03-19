const fs = require('fs');
const {
  ensureUserKnowledgeDir,
} = require('../doc');
const {
  localSearch,
} = require('../search');
const {
  sirchmunkSearch,
  getSirchmunkStatus,
  mapSirchmunkItemsToEvidence,
} = require('./sirchmunk');

const normalizeInlineWhitespace = (input) => String(input || '').replace(/\s+/g, ' ').trim();

const ANSWER_KEYWORD_STOPWORDS = new Set([
  '这个', '那个', '就是', '然后', '还有', '以及', '我们', '你们', '他们', '自己',
  '因为', '所以', '但是', '如果', '觉得', '进行', '实现', '使用', '通过', '主要',
  '比较', '相关', '一些', '一个', '一种', '时候', '方面', '问题', '项目', '回答',
  '优化', '方案', '处理', '可以', '已经', '需要', '没有', '当前', '这里', '里面',
  'the', 'and', 'with', 'from', 'that', 'this', 'have', 'has', 'into', 'about',
]);

const isUsefulAnswerKeyword = (term) => {
  const value = String(term || '').trim();
  if (!value || value.length < 2) return false;
  if (ANSWER_KEYWORD_STOPWORDS.has(value.toLowerCase())) return false;
  if (/^\d+$/.test(value)) return false;
  return /[a-zA-Z@#./:_-]/.test(value) || /[\u4e00-\u9fa5]/.test(value);
};

const buildAnswerKeywordSummary = (answer) => {
  const answerText = String(answer || '').trim();
  if (!answerText) return '';

  const normalizedText = answerText
    .replace(/\r/g, '\n')
    .replace(/[（(]\d+[）)]/g, ' ')
    .replace(/[“”"'`]/g, ' ')
    .replace(/\s+/g, ' ');

  const phraseMatches = normalizedText.match(/[A-Za-z][A-Za-z0-9@#./:_-]{1,40}|[\u4e00-\u9fa5]{2,12}/g) || [];
  const lineSegments = answerText
    .split(/\r?\n|[。！？；;]+/)
    .map((item) => normalizeInlineWhitespace(item))
    .filter(Boolean)
    .slice(0, 8);

  const prioritizedPhrases = lineSegments
    .filter((segment) => segment.length >= 4 && segment.length <= 36)
    .flatMap((segment) => {
      const pieces = segment
        .split(/[，,、]/)
        .map((item) => normalizeInlineWhitespace(item))
        .filter(Boolean)
        .filter((item) => item.length >= 2 && item.length <= 24);
      return pieces.length > 0 ? pieces : [segment];
    });

  const ordered = [];
  const seen = new Set();
  for (const term of [...prioritizedPhrases, ...phraseMatches]) {
    const normalized = normalizeInlineWhitespace(term)
      .replace(/^[\-:：]+|[\-:：]+$/g, '')
      .trim();
    if (!isUsefulAnswerKeyword(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(normalized);
    if (ordered.length >= 14) break;
  }

  return normalizeInlineWhitespace(ordered.join(' '));
};

const buildQueryPlan = ({ question, resumeSummary = '', plannedKeywords = [] }) => {
  const normalized = String(question || '').trim();
  const rawTerms = normalized
    .split(/[\s,，。！？?!.;；:：()（）]+/)
    .filter(Boolean);
  const resumeTerms = String(resumeSummary || '')
    .split(/[\s,，。！？?!.;；:：()（）]+/)
    .filter(Boolean)
    .slice(0, 8);
  const plannerTerms = (Array.isArray(plannedKeywords) ? plannedKeywords : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12);

  const uniq = Array.from(new Set([...plannerTerms, ...rawTerms, ...resumeTerms]));

  return {
    rewritten_query: normalized,
    keyword_groups: {
      entity_terms: uniq.slice(0, 4),
      intent_terms: uniq.slice(4, 6),
      evidence_terms: uniq.slice(6, 10),
    },
    next_action: 'sirchmunk_search_first',
  };
};

const mapLocalHitsToEvidence = (hits) =>
  (hits || []).map((hit) => ({
    source_type: 'local_doc',
    source_uri: `${hit.file}:${hit.line}`,
    quote: hit.text,
    confidence: Math.min(0.95, 0.45 + hit.keywords.length * 0.1),
  }));

const webSearchFallback = ({ enabled, reason, query }) => {
  if (!enabled) {
    return { enabled: false, reason, items: [] };
  }
  return {
    enabled: true,
    reason,
    items: [
      {
        source_type: 'web',
        source_uri: 'placeholder://websearch',
        quote: `WebSearch placeholder for query: ${query}`,
      },
    ],
  };
};

const retrieveEvidence = async ({
  userId,
  question,
  answer = '',
  resumeSummary = '',
  limit = 6,
  strategy = 'auto',
  enableWebFallback = false,
  questionType = 'basic',
  paths = [],
  sirchmunkMode = null,
  plannedQuery = '',
  plannedKeywords = [],
  retrievalGoal = 'find_evidence',
}) => {
  const fullQueryText = `${String(question || '').trim()} ${String(answer || '').trim()}`.trim();
  const answerKeywordSummary = buildAnswerKeywordSummary(answer);
  const normalizedPlannedQuery = normalizeInlineWhitespace(plannedQuery);
  const plan = buildQueryPlan({
    question: normalizedPlannedQuery || fullQueryText,
    resumeSummary,
    plannedKeywords,
  });
  const sirchmunkQuery = normalizeInlineWhitespace([
    normalizedPlannedQuery || String(question || '').trim(),
    ...(Array.isArray(plannedKeywords) ? plannedKeywords : []).slice(0, 8),
    answerKeywordSummary,
  ].filter(Boolean).join(' '));
  const validPaths = (Array.isArray(paths) && paths.length > 0 ? paths : [ensureUserKnowledgeDir(userId)])
    .map((item) => String(item || '').trim())
    .filter((item) => item && fs.existsSync(item));
  const effectiveSirchmunkMode = String(sirchmunkMode || 'FAST').trim().toUpperCase() || 'FAST';
  console.log('[retrieval.query]', {
    user_id: userId,
    strategy,
    question_type: questionType,
    retrieval_goal: retrievalGoal,
    question: String(question || ''),
    answer: String(answer || ''),
    full_query: fullQueryText,
    planned_query: normalizedPlannedQuery,
    planned_keywords: (Array.isArray(plannedKeywords) ? plannedKeywords : []).slice(0, 12),
    rewritten_query: plan.rewritten_query,
    answer_keyword_summary: answerKeywordSummary,
    sirchmunk_query: sirchmunkQuery,
    paths: validPaths,
    sirchmunk_mode: effectiveSirchmunkMode,
  });
  const keywordPool = [
    ...plan.keyword_groups.entity_terms,
    ...plan.keyword_groups.intent_terms,
    ...plan.keyword_groups.evidence_terms,
  ].filter(Boolean);
  const shouldUseLocal = strategy === 'local';
  const localHits = shouldUseLocal
    ? localSearch({
      userId,
      keywords: keywordPool,
      limit,
      paths: validPaths,
    })
    : [];
  const localEvidence = mapLocalHitsToEvidence(localHits);

  let sirchmunk = { available: false, items: [], message: 'not_requested' };
  const shouldTrySirchmunk = strategy === 'sirchmunk' || strategy === 'auto';
  if (shouldTrySirchmunk) {
    sirchmunk = await sirchmunkSearch({
      query: sirchmunkQuery || plan.rewritten_query,
      paths: validPaths,
      limit: Math.min(3, limit),
      mode: effectiveSirchmunkMode,
    });
  }
  const sirchmunkEvidence = mapSirchmunkItemsToEvidence(sirchmunk.items);

  const needFallback = localEvidence.length === 0 && sirchmunkEvidence.length === 0;
  const webFallback = webSearchFallback({
    enabled: enableWebFallback,
    reason: needFallback ? 'local_evidence_insufficient' : 'not_needed',
    query: plan.rewritten_query,
  });
  const webEvidence = (webFallback.items || []).map((item) => ({
    source_type: item.source_type || 'web',
    source_uri: item.source_uri || '',
    quote: item.quote || '',
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
  }));

  const primaryStrategy = sirchmunkEvidence.length > 0
    ? 'sirchmunk'
    : localEvidence.length > 0
      ? 'local'
      : webEvidence.length > 0
        ? 'web'
        : 'none';

  return {
    strategy: primaryStrategy,
    plan,
    local: {
      items: localHits,
      evidence_refs: localEvidence,
    },
    sirchmunk,
    web_fallback: webFallback,
    evidence_refs: [...localEvidence, ...sirchmunkEvidence, ...webEvidence],
    need_fallback: needFallback,
  };
};

module.exports = {
  buildQueryPlan,
  retrieveEvidence,
  getSirchmunkStatus,
};
