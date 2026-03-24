const {
  getSirchmunkStatus,
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
    next_action: 'retrieval_disabled',
  };
};

const retrieveEvidence = async ({
  question,
  answer = '',
  resumeSummary = '',
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
  console.log('[retrieval.query]', {
    retrieval_goal: retrievalGoal,
    question: String(question || ''),
    answer: String(answer || ''),
    full_query: fullQueryText,
    planned_query: normalizedPlannedQuery,
    planned_keywords: (Array.isArray(plannedKeywords) ? plannedKeywords : []).slice(0, 12),
    rewritten_query: plan.rewritten_query,
    answer_keyword_summary: answerKeywordSummary,
    sirchmunk_query: sirchmunkQuery,
  });

  return {
    strategy: 'none',
    plan,
    local: {
      items: [],
      evidence_refs: [],
    },
    sirchmunk: {
      available: false,
      items: [],
      message: 'retrieval_disabled',
    },
    evidence_refs: [],
  };
};

module.exports = {
  buildQueryPlan,
  retrieveEvidence,
  getSirchmunkStatus,
};
