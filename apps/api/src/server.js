const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const http = require('http');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const fs = require('fs');
const { formidable } = require('formidable');
const {
  DB_PATH,
  init,
  getUserById,
  upsertUser,
  setActiveResumeFile,
  setActiveJdFile,
  saveScoringResult,
  getWeaknessesByUser,
  listAttemptsByUser,
  createInterviewSession,
  getInterviewSession,
  addInterviewTurn,
  listInterviewTurns,
  finishInterviewSession,
  saveInterviewQuestions,
  insertInterviewQuestionAfter,
  listInterviewQuestions,
  getInterviewQuestionById,
  updateInterviewQuestionStatus,
  getNextInterviewQuestion,
  saveQuestionBankItems,
  listQuestionBank,
  listPracticeQuestions,
  markQuestionReviewed,
  createChatSession,
  getChatSession,
  addChatMessage,
  listChatMessages,
} = require('./db');
const {
  summarizeResume,
  extractResumeTextFromBinary,
  saveResumeDoc,
  saveJdDoc,
  listUserDocs,
  listResumeDocs,
  listJdDocs,
  readUserDoc,
  readResumeDoc,
  readJdDoc,
  appendMemoryEntry,
  localSearch,
  buildQueryPlan,
  retrieveEvidence,
  getSirchmunkStatus,
} = require('./services');
const {
  hasRealLLM,
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  chatCompletion,
  jsonCompletion,
  streamJsonCompletion,
  streamCompletion,
} = require('./llm');

const PORT = process.env.PORT || 3300;
init();

const getCorsHeaders = (req) => {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const readMultipartForm = (req) =>
  new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize: 8 * 1024 * 1024,
      maxTotalFileSize: 8 * 1024 * 1024,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ fields, files });
    });
  });

const pickFormValue = (value) => {
  if (Array.isArray(value)) return pickFormValue(value[0]);
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const writeSse = (res, event, payload) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const flushSseFrame = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const tokenize = (input) =>
  String(input || '')
    .toLowerCase()
    .split(/[\s,，。！？?!.;；:：()（）[\]【】{}\-_/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

const normalizeString = (value, fallback = '', maxLength = 1000) =>
  String(value === undefined || value === null ? fallback : value).trim().slice(0, maxLength);

const normalizeStringList = (value, limit = 4) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[；;、,\n]/)
      : [];
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit);
};

const validateObjectShape = (value, requiredKeys = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'result must be an object' };
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      return { ok: false, error: `missing field: ${key}` };
    }
  }
  return { ok: true };
};

const normalizeSummaryResult = (value) => ({
  summary: normalizeString(value?.summary, '', 240),
});

const validateSummaryResult = (value) => {
  const base = validateObjectShape(value, ['summary']);
  if (!base.ok) return base;
  return value.summary ? { ok: true } : { ok: false, error: 'summary is empty' };
};

const normalizeInterviewSummaryResult = (value) => ({
  summary: normalizeString(value?.summary, '', 240),
  open_points: normalizeStringList(value?.open_points || value?.openPoints, 4),
});

const validateInterviewSummaryResult = (value) => {
  const base = validateObjectShape(value, ['summary', 'open_points']);
  if (!base.ok) return base;
  if (!Array.isArray(value.open_points)) return { ok: false, error: 'open_points must be an array' };
  return value.summary ? { ok: true } : { ok: false, error: 'summary is empty' };
};

const normalizeLongTermMemoryResult = (value) => ({
  stable_strengths: normalizeStringList(value?.stable_strengths || value?.strengths, 4),
  stable_weaknesses: normalizeStringList(value?.stable_weaknesses || value?.weaknesses, 5),
  project_signals: normalizeStringList(value?.project_signals, 4),
  role_fit_signals: normalizeStringList(value?.role_fit_signals, 4),
  recommended_focus: normalizeStringList(value?.recommended_focus, 4),
});

const validateLongTermMemoryResult = (value) => {
  const base = validateObjectShape(value, [
    'stable_strengths',
    'stable_weaknesses',
    'project_signals',
    'role_fit_signals',
    'recommended_focus',
  ]);
  if (!base.ok) return base;
  const listKeys = ['stable_strengths', 'stable_weaknesses', 'project_signals', 'role_fit_signals', 'recommended_focus'];
  const invalid = listKeys.find((key) => !Array.isArray(value[key]));
  return invalid ? { ok: false, error: `${invalid} must be an array` } : { ok: true };
};

const normalizeEvaluationRewriteResult = (value) => ({
  strengths: normalizeStringList(value?.strengths || value?.strength, 3),
  weaknesses: normalizeStringList(value?.weaknesses || value?.weakness, 3),
  feedback: normalizeString(value?.feedback, '', 240),
  standard_answer: normalizeString(value?.standard_answer || value?.answer_key || value?.reference_answer, '', 500),
});

const validateEvaluationRewriteResult = (value) => {
  const base = validateObjectShape(value, ['strengths', 'weaknesses', 'feedback', 'standard_answer']);
  if (!base.ok) return base;
  if (!Array.isArray(value.strengths) || !Array.isArray(value.weaknesses)) {
    return { ok: false, error: 'strengths and weaknesses must be arrays' };
  }
  if (typeof value.feedback !== 'string' || !value.feedback.trim()) {
    return { ok: false, error: 'feedback must be a non-empty string' };
  }
  if (typeof value.standard_answer !== 'string' || !value.standard_answer.trim()) {
    return { ok: false, error: 'standard_answer must be a non-empty string' };
  }
  return { ok: true };
};

const clampNumber = (value, min, max) => {
  const num = Number(value);
  if (Number.isNaN(num)) return min;
  return Math.max(min, Math.min(max, Math.round(num)));
};

const normalizeRubricScoreResult = (value) => {
  const dimensionScores = value?.dimension_scores || value?.scores || {};
  const technicalDepth = clampNumber(
    dimensionScores.technical_depth ?? dimensionScores.technicalDepth ?? 0,
    0,
    25,
  );
  const structureClarity = clampNumber(
    dimensionScores.structure_clarity ?? dimensionScores.structureClarity ?? 0,
    0,
    25,
  );
  const evidenceGrounding = clampNumber(
    dimensionScores.evidence_grounding ?? dimensionScores.evidenceGrounding ?? 0,
    0,
    25,
  );
  const roleFit = clampNumber(
    dimensionScores.role_fit ?? dimensionScores.roleFit ?? 0,
    0,
    25,
  );

  return {
    dimension_scores: {
      technical_depth: technicalDepth,
      structure_clarity: structureClarity,
      evidence_grounding: evidenceGrounding,
      role_fit: roleFit,
    },
    total_score: clampNumber(
      value?.total_score ?? value?.score ?? technicalDepth + structureClarity + evidenceGrounding + roleFit,
      0,
      100,
    ),
    strengths: normalizeStringList(value?.strengths, 3),
    weaknesses: normalizeStringList(value?.weaknesses, 3),
    feedback: normalizeString(value?.feedback, '', 240),
    standard_answer: normalizeString(value?.standard_answer || value?.answer_key || value?.reference_answer, '', 500),
  };
};

const validateRubricScoreResult = (value) => {
  const base = validateObjectShape(value, ['dimension_scores', 'total_score', 'strengths', 'weaknesses', 'feedback', 'standard_answer']);
  if (!base.ok) return base;
  const scoreBase = validateObjectShape(value.dimension_scores, [
    'technical_depth',
    'structure_clarity',
    'evidence_grounding',
    'role_fit',
  ]);
  if (!scoreBase.ok) return { ok: false, error: `dimension_scores.${scoreBase.error}` };
  if (!Array.isArray(value.strengths) || !Array.isArray(value.weaknesses)) {
    return { ok: false, error: 'strengths and weaknesses must be arrays' };
  }
  if (typeof value.feedback !== 'string' || !value.feedback.trim()) {
    return { ok: false, error: 'feedback must be a non-empty string' };
  }
  if (typeof value.standard_answer !== 'string' || !value.standard_answer.trim()) {
    return { ok: false, error: 'standard_answer must be a non-empty string' };
  }
  return { ok: true };
};

const normalizeInterviewIntentResult = (value) => ({
  intent: ['answer', 'clarify', 'question_back', 'skip', 'meta', 'invalid'].includes(String(value?.intent || '').trim())
    ? String(value.intent).trim()
    : 'invalid',
  confidence: clampNumber(value?.confidence ?? 0, 0, 100),
  reason: normalizeString(value?.reason, '', 160),
});

const validateInterviewIntentResult = (value) => {
  const base = validateObjectShape(value, ['intent', 'confidence', 'reason']);
  if (!base.ok) return base;
  if (!['answer', 'clarify', 'question_back', 'skip', 'meta', 'invalid'].includes(String(value.intent || '').trim())) {
    return { ok: false, error: 'intent is invalid' };
  }
  return { ok: true };
};

const normalizeQuestionTypeResult = (value) => ({
  question_type: ['basic', 'project', 'knowledge', 'scenario', 'follow_up'].includes(String(value?.question_type || '').trim())
    ? String(value.question_type).trim()
    : 'project',
  reason: normalizeString(value?.reason, '', 160),
});

const validateQuestionTypeResult = (value) => {
  const base = validateObjectShape(value, ['question_type', 'reason']);
  if (!base.ok) return base;
  if (!['basic', 'project', 'knowledge', 'scenario', 'follow_up'].includes(String(value.question_type || '').trim())) {
    return { ok: false, error: 'question_type is invalid' };
  }
  return { ok: true };
};

const normalizeRetrievalPlannerResult = (value) => ({
  should_retrieve: value?.should_retrieve !== false,
  retrieval_goal: ['verify_answer', 'find_evidence', 'not_needed'].includes(String(value?.retrieval_goal || '').trim())
    ? String(value.retrieval_goal).trim()
    : 'find_evidence',
  query: normalizeString(value?.query, '', 240),
  keywords: normalizeStringList(value?.keywords, 8),
  reason: normalizeString(value?.reason, '', 180),
});

const validateRetrievalPlannerResult = (value) => {
  const base = validateObjectShape(value, ['should_retrieve', 'retrieval_goal', 'query', 'keywords', 'reason']);
  if (!base.ok) return base;
  if (typeof value.should_retrieve !== 'boolean') return { ok: false, error: 'should_retrieve must be a boolean' };
  if (!['verify_answer', 'find_evidence', 'not_needed'].includes(String(value.retrieval_goal || '').trim())) {
    return { ok: false, error: 'retrieval_goal is invalid' };
  }
  if (!Array.isArray(value.keywords)) return { ok: false, error: 'keywords must be an array' };
  return { ok: true };
};

const buildRetrievalPlannerFallback = ({ question, answer = '', questionType = 'project', intent = 'answer' }) => {
  if (intent !== 'answer') {
    return {
      should_retrieve: false,
      retrieval_goal: 'not_needed',
      query: '',
      keywords: [],
      reason: '当前输入不是可评分回答，不需要检索',
    };
  }

  if (questionType === 'basic' && String(answer || '').trim().length < 30) {
    return {
      should_retrieve: false,
      retrieval_goal: 'not_needed',
      query: '',
      keywords: [],
      reason: '开场背景题且回答较短，先不触发知识检索',
    };
  }

  const keywordSeed = Array.from(new Set(
    `${String(question || '')} ${String(answer || '')}`
      .split(/[\s,，。！？?!.;；:：()（）[\]【】{}"“”'`]+/)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item) => item.length >= 2)
      .filter((item) => /[A-Za-z@#./:_-]/.test(item) || /[\u4e00-\u9fa5]/.test(item)),
  )).slice(0, 8);

  return {
    should_retrieve: true,
    retrieval_goal: 'verify_answer',
    query: `检索与 ${keywordSeed.slice(0, 4).join('、') || normalizeString(question, '当前问题', 40)} 相关的证据片段`,
    keywords: keywordSeed,
    reason: '当前为可评分回答，需要查找证据来校验回答是否准确',
  };
};

const planRetrievalWithLLM = async ({
  question,
  answer,
  questionType,
  intent = 'answer',
  interviewContext = '',
}) => {
  const fallback = buildRetrievalPlannerFallback({ question, answer, questionType, intent });
  const result = await jsonCompletion({
    fallback,
    normalizer: normalizeRetrievalPlannerResult,
    validator: validateRetrievalPlannerResult,
    repairPrompt: '只返回合法 JSON：{"should_retrieve":true,"retrieval_goal":"verify_answer|find_evidence|not_needed","query":"...","keywords":["..."],"reason":"..."}。不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是前端面试检索规划器。',
          '你的任务是判断当前回答是否需要检索知识证据，并把原始问答改写成适合检索系统使用的 query。',
          '只输出 JSON：{"should_retrieve":true|false,"retrieval_goal":"verify_answer|find_evidence|not_needed","query":"...","keywords":["..."],"reason":"..."}。',
          'query 必须是检索式表达，例如“检索与 xxx 相关的证据片段”或“查找包含 xxx 的原文片段”，不要直接复述整段口语。',
          'keywords 只保留技术词、实现词、关键概念，不要保留口语废话。',
          '项目题/知识题/场景题通常 should_retrieve=true；basic 题如果只是简短背景回答，可以 false。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: String(question || '').slice(0, 260),
          answer: String(answer || '').slice(0, 1600),
          question_type: String(questionType || 'project'),
          intent,
          interview_context: String(interviewContext || '').slice(0, 1200),
        }),
      },
    ],
  });

  return result;
};

const detectQuestionTypeFallback = ({ question, answer = '', queuedQuestionType = '' }) => {
  const normalizedQueuedType = String(queuedQuestionType || '').trim();
  if (['basic', 'project', 'scenario', 'follow_up'].includes(normalizedQueuedType)) {
    return {
      question_type: normalizedQueuedType,
      reason: '沿用题目队列中已有的 question_type',
    };
  }

  const text = `${String(question || '')} ${String(answer || '')}`.trim();
  if (/(自我介绍|介绍一下自己|简单介绍|最有代表性的项目|为什么想加入|离职原因)/i.test(text)) {
    return { question_type: 'basic', reason: '题面更像开场背景题或自我介绍题' };
  }
  if (/(如果|假如|遇到|出现|会怎么做|如何处理|怎么排查|取舍|权衡|线上|故障|压力)/i.test(text)) {
    return { question_type: 'scenario', reason: '题面包含明显场景处理和方案判断信号' };
  }
  if (/(什么是|区别|原理|为什么|机制|生命周期|浏览器|css|html|javascript|react|vue|typescript|网络|操作系统)/i.test(text)) {
    return { question_type: 'knowledge', reason: '题面更像知识点解释、原理或概念辨析' };
  }
  return { question_type: 'project', reason: '默认按项目经历和实现细节题处理' };
};

const classifyQuestionType = async ({
  question,
  answer = '',
  queuedQuestionType = '',
  interviewContext = '',
}) => {
  const fallback = detectQuestionTypeFallback({ question, answer, queuedQuestionType });
  const result = await jsonCompletion({
    fallback,
    normalizer: normalizeQuestionTypeResult,
    validator: validateQuestionTypeResult,
    repairPrompt: '只返回合法 JSON：{"question_type":"basic|project|knowledge|scenario|follow_up","reason":"..."}。不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是前端面试题型路由器。',
          '请判断当前这道题属于哪一类：basic、project、knowledge、scenario、follow_up。',
          'basic 表示自我介绍、背景经历、动机与概览类问题；project 表示围绕真实项目经历、实现细节、贡献与结果的问题；knowledge 表示概念、原理、区别、底层机制类知识题；scenario 表示故障排查、方案设计、权衡取舍、线上处理类问题；follow_up 表示基于上一轮薄弱点的追问。',
          '只输出 JSON：{"question_type":"...","reason":"简短原因"}。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: String(question || '').slice(0, 240),
          answer: String(answer || '').slice(0, 1200),
          queued_question_type: String(queuedQuestionType || ''),
          interview_context: String(interviewContext || '').slice(0, 1200),
        }),
      },
    ],
  });

  return {
    question_type: result.question_type,
    reason: result.reason,
  };
};

const scoreKnowledgeDocHint = ({ fileName, queryText }) => {
  const name = String(fileName || '').toLowerCase();
  const text = String(queryText || '').toLowerCase();
  let score = 0;
  const rules = [
    { pattern: /(css|样式|布局|选择器|flex|grid)/i, names: ['css'] },
    { pattern: /(html|语义化|标签|dom)/i, names: ['html'] },
    { pattern: /(javascript|js|typescript|ts|react|vue|next|vite|node|异步|事件循环)/i, names: ['javascript'] },
    { pattern: /(webpack|vite|构建|工程化|ci\/cd|git|npm|pnpm|工具)/i, names: ['工具', 'tool'] },
    { pattern: /(网络|http|https|tcp|udp|浏览器缓存|cdn|请求)/i, names: ['网络'] },
    { pattern: /(操作系统|进程|线程|内存|调度|锁)/i, names: ['操作系统'] },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text) && rule.names.some((keyword) => name.includes(keyword.toLowerCase()))) {
      score += 3;
    }
  }

  const normalizedName = path.basename(name, path.extname(name));
  if (text.includes(normalizedName.toLowerCase())) score += 2;
  if (/resume|jd-/.test(name)) score -= 2;
  return score;
};

const uniqPaths = (items) => Array.from(new Set(
  (items || []).map((item) => String(item || '').trim()).filter(Boolean),
));

const planEvidenceDocPaths = ({ userId, questionType, question, answer = '', user }) => {
  const allDocs = listUserDocs(userId);
  const activeResume = user?.active_resume_file
    ? readResumeDoc({ userId, fileName: user.active_resume_file })
    : allDocs.find((item) => item.name.startsWith('resume-')) || null;
  const activeJd = user?.active_jd_file
    ? readJdDoc({ userId, fileName: user.active_jd_file })
    : allDocs.find((item) => item.name.startsWith('jd-')) || null;
  const knowledgeDocs = allDocs
    .filter((item) => !item.name.startsWith('resume-') && !item.name.startsWith('jd-'))
    .map((item) => ({
      ...item,
      relevance: scoreKnowledgeDocHint({
        fileName: item.name,
        queryText: `${String(question || '')} ${String(answer || '')}`,
      }),
    }))
    .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));

  const topKnowledgePaths = knowledgeDocs
    .filter((item) => item.relevance > 0)
    .slice(0, 4)
    .map((item) => item.path);
  const fallbackKnowledgePaths = knowledgeDocs.slice(0, 4).map((item) => item.path);
  const selectedKnowledgePaths = topKnowledgePaths.length > 0 ? topKnowledgePaths : fallbackKnowledgePaths;

  let selectedPaths = [];
  if (questionType === 'basic') {
    selectedPaths = [];
  } else if (questionType === 'knowledge') {
    selectedPaths = [...selectedKnowledgePaths];
  } else if (questionType === 'scenario') {
    selectedPaths = [...selectedKnowledgePaths];
  } else {
    selectedPaths = [...selectedKnowledgePaths];
  }

  const uniqueSelectedPaths = uniqPaths(selectedPaths).filter((item) => fs.existsSync(item));
  const fallbackPaths = uniqPaths(allDocs.slice(0, 5).map((item) => item.path));

  return {
    question_type: questionType,
    paths: uniqueSelectedPaths.length > 0 ? uniqueSelectedPaths : fallbackPaths,
    active_resume_path: activeResume?.path || null,
    active_jd_path: activeJd?.path || null,
    selected_knowledge_paths: selectedKnowledgePaths,
  };
};

const buildStandardAnswerFallback = ({ question, evidenceRefs }) => {
  const evidenceQuotes = (evidenceRefs || [])
    .map((item) => String(item?.quote || '').trim())
    .filter(Boolean)
    .slice(0, 3);

  if (evidenceQuotes.length === 0) {
    return `回答这道题时，建议先说明对“${normalizeString(question, '当前问题', 80)}”的理解，再补充具体场景、方案取舍、结果验证和复盘。`;
  }

  return [
    `参考这道题的更优回答，可以先结合资料说明：${evidenceQuotes[0].slice(0, 120)}。`,
    evidenceQuotes[1] ? `随后补充相关背景或能力证明：${evidenceQuotes[1].slice(0, 120)}。` : '',
    evidenceQuotes[2] ? `最后用结果或复盘收束：${evidenceQuotes[2].slice(0, 120)}。` : '最后补充你的具体做法、取舍理由和结果验证。',
  ].filter(Boolean).join('');
};

const buildInterviewReplyFallback = ({ intent, queuedQuestion, input }) => {
  const questionStem = String(queuedQuestion?.stem || '').trim();
  const expectedPoints = Array.isArray(queuedQuestion?.expected_points)
    ? queuedQuestion.expected_points.filter(Boolean).slice(0, 3)
    : [];
  const expectedHint = expectedPoints.length > 0 ? `你可以优先围绕 ${expectedPoints.join('、')} 来回答。` : '';

  if (intent === 'clarify') {
    return [
      questionStem ? `我换个说法，这题我主要想了解的是：${questionStem}` : '我换个说法再问一遍。',
      expectedHint,
      '你可以直接开始回答，不用太铺垫。',
    ].filter(Boolean).join('');
  }

  if (intent === 'question_back') {
    return [
      '可以，我先补充一下题意：我关注的是你在真实项目或场景里的做法、判断依据和结果。',
      expectedHint,
      questionStem ? `还是回到这题本身：${questionStem}` : '你继续按这个方向回答即可。',
    ].filter(Boolean).join('');
  }

  if (intent === 'meta') {
    return [
      '这轮先聚焦当前题目本身，我会根据你的回答看技术深度、表达结构、证据支撑和岗位匹配度。',
      questionStem ? `你继续回答这题：${questionStem}` : '你继续当前题即可。',
    ].join('');
  }

  if (intent === 'skip') {
    return '这题先记为跳过，我们直接进入下一题。';
  }

  return `我还没有拿到可评分的回答。${input ? `你刚才说的是“${input.slice(0, 40)}”` : ''}请直接结合项目经历或具体场景回答当前问题。`;
};

// server 层只拿统一证据包，避免评分、面试回合、检索接口分别拼装底层策略。
const buildEvidenceBundle = async ({
  userId,
  question,
  answer = '',
  user,
  strategy = 'auto',
  questionType = 'project',
  retrievalPlanner = null,
}) => {
  const retrievalPlan = planEvidenceDocPaths({
    userId,
    questionType,
    question,
    answer,
    user,
  });
  if (retrievalPlanner && retrievalPlanner.should_retrieve === false) {
    return {
      queryPlan: buildQueryPlan({
        question: retrievalPlanner.query || question,
        resumeSummary: user?.resume_summary || '',
        plannedKeywords: retrievalPlanner.keywords || [],
      }),
      localHits: [],
      sirchmunk: {
        available: false,
        items: [],
        message: 'skipped_by_retrieval_planner',
      },
      webFallback: {
        enabled: false,
        reason: 'skipped_by_retrieval_planner',
        items: [],
      },
      evidenceRefs: [],
      strategy: 'none',
      needFallback: false,
      retrievalPlan: {
        ...retrievalPlan,
        paths: [],
      },
      retrievalPlanner,
    };
  }

  const result = await retrieveEvidence({
    userId,
    question,
    answer,
    resumeSummary: user?.resume_summary || '',
    strategy,
    questionType,
    paths: retrievalPlan.paths,
    sirchmunkMode: 'DEEP',
    plannedQuery: retrievalPlanner?.query || '',
    plannedKeywords: retrievalPlanner?.keywords || [],
    retrievalGoal: retrievalPlanner?.retrieval_goal || 'find_evidence',
    enableWebFallback: process.env.ENABLE_WEBSEARCH === '1',
  });

  return {
    queryPlan: result.plan,
    localHits: result.local.items,
    sirchmunk: result.sirchmunk,
    webFallback: result.web_fallback,
    evidenceRefs: result.evidence_refs,
    strategy: result.strategy,
    needFallback: result.need_fallback,
    retrievalPlan,
    retrievalPlanner,
  };
};

const INTERVIEW_CONTEXT_RAW_BUDGET = 2200;
const INTERVIEW_CONTEXT_SUMMARY_BUDGET = 900;

const formatTurnForContext = (turn) => [
  `Q${turn.turn_index}: ${String(turn.question || '').trim()}`,
  `A${turn.turn_index}: ${String(turn.answer || '').trim()}`,
  `score=${turn.score || 0}`,
  `weaknesses=${(turn.weaknesses || []).join('、') || '无'}`,
].join('\n');

const buildContextSummaryFallback = ({ overflowTurns }) => {
  const topics = overflowTurns
    .map((turn) => String(turn.question || '').trim())
    .filter(Boolean)
    .slice(0, 4);
  const weaknesses = Array.from(new Set(
    overflowTurns.flatMap((turn) => Array.isArray(turn.weaknesses) ? turn.weaknesses : []),
  )).slice(0, 4);
  const strengths = Array.from(new Set(
    overflowTurns.flatMap((turn) => Array.isArray(turn.strengths) ? turn.strengths : []),
  )).slice(0, 3);

  return {
    summary: [
      topics.length > 0 ? `已讨论主题：${topics.join('；')}` : '',
      strengths.length > 0 ? `已体现优势：${strengths.join('、')}` : '',
      weaknesses.length > 0 ? `历史薄弱点：${weaknesses.join('、')}` : '',
    ].filter(Boolean).join('\n'),
    open_points: weaknesses,
  };
};

const summarizeInterviewOverflow = async ({ overflowTurns, currentQuestion }) => {
  const fallback = buildContextSummaryFallback({ overflowTurns });
  if (overflowTurns.length === 0) return fallback;

  const result = await jsonCompletion({
    fallback,
    normalizer: normalizeInterviewSummaryResult,
    validator: validateInterviewSummaryResult,
    repairPrompt: '只返回合法 JSON：{"summary":"...","open_points":["..."]}。summary 必须是字符串，open_points 必须是字符串数组，不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是面试上下文压缩助手。',
          '请把较早的面试历史压缩成一段简短摘要，供后续评分和追问使用。',
          '保留已确认背景、已经讨论过的话题、仍未补足的薄弱点。',
          '输出 JSON：{"summary":"...","open_points":["..."]}。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          current_question: currentQuestion,
          overflow_turns: overflowTurns.map((turn) => ({
            turn_index: turn.turn_index,
            question: String(turn.question || '').slice(0, 180),
            answer: String(turn.answer || '').slice(0, 240),
            score: turn.score,
            strengths: turn.strengths || [],
            weaknesses: turn.weaknesses || [],
          })),
          rules: [
            '摘要控制在 200 字以内',
            '不要重复逐字搬运原回答',
            '优先保留后续追问仍需要知道的信息',
          ],
        }),
      },
    ],
  });

  return {
    summary: String(result?.summary || fallback.summary).trim() || fallback.summary,
    open_points: Array.isArray(result?.open_points)
      ? result.open_points.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : fallback.open_points,
  };
};

const buildInterviewContextWindow = async ({
  turns,
  currentQuestion,
}) => {
  const orderedTurns = [...(turns || [])].sort((a, b) => (b.turn_index || 0) - (a.turn_index || 0));
  const rawTurns = [];
  const overflowTurns = [];
  let rawLength = 0;

  for (const turn of orderedTurns) {
    const formatted = formatTurnForContext(turn);
    if (rawLength + formatted.length <= INTERVIEW_CONTEXT_RAW_BUDGET || rawTurns.length === 0) {
      rawTurns.push(formatted);
      rawLength += formatted.length;
    } else {
      overflowTurns.push(turn);
    }
  }

  const overflowSummary = await summarizeInterviewOverflow({
    overflowTurns: [...overflowTurns].reverse(),
    currentQuestion,
  });
  const recentTurnsOrdered = [...rawTurns].reverse();

  const parts = [];
  if (overflowSummary.summary) {
    parts.push(`较早历史摘要:\n${overflowSummary.summary.slice(0, INTERVIEW_CONTEXT_SUMMARY_BUDGET)}`);
  }
  if (recentTurnsOrdered.length > 0) {
    parts.push(`最近轮次原文:\n${recentTurnsOrdered.join('\n\n')}`);
  }

  return {
    summary: overflowSummary.summary.slice(0, INTERVIEW_CONTEXT_SUMMARY_BUDGET),
    openPoints: overflowSummary.open_points || [],
    recentTurnsText: recentTurnsOrdered.join('\n\n'),
    contextText: parts.join('\n\n').trim(),
  };
};

const summarizeLongTermMemoryFallback = ({ strengths, weaknesses, turns, jobQuestionTypes }) => ({
  stable_strengths: (strengths || []).slice(0, 3),
  stable_weaknesses: (weaknesses || []).slice(0, 5),
  project_signals: Array.from(new Set(
    (turns || [])
      .filter((turn) => String(turn.question || '').includes('项目'))
      .map((turn) => String(turn.question || '').trim())
      .filter(Boolean),
  )).slice(0, 3),
  role_fit_signals: Array.from(new Set(jobQuestionTypes || [])).slice(0, 3),
  recommended_focus: (weaknesses || []).slice(0, 3),
});

const summarizeLongTermMemory = async ({
  resumeSummary,
  strengths,
  weaknesses,
  turns,
  questionItems,
}) => {
  const jobQuestionTypes = Array.from(new Set(
    (questionItems || [])
      .filter((item) => item.source_ref === 'job_description' || item.source === 'doc')
      .map((item) => String(item.stem || '').trim())
      .filter(Boolean),
  )).slice(0, 4);

  const fallback = summarizeLongTermMemoryFallback({
    strengths,
    weaknesses,
    turns,
    jobQuestionTypes,
  });

  const result = await jsonCompletion({
    fallback,
    normalizer: normalizeLongTermMemoryResult,
    validator: validateLongTermMemoryResult,
    repairPrompt: '只返回合法 JSON：{"stable_strengths":[],"stable_weaknesses":[],"project_signals":[],"role_fit_signals":[],"recommended_focus":[]}。所有字段都必须是字符串数组，不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是长期记忆提炼助手。',
          '请基于一场模拟面试的整场表现，提炼可跨场次复用的稳定结论。',
          '只输出 JSON：{"stable_strengths":[],"stable_weaknesses":[],"project_signals":[],"role_fit_signals":[],"recommended_focus":[]}。',
          '不要写临时口误，不要写一次性细节，只保留对下一场面试和后续练习仍然有价值的结论。',
          '每个数组 0-4 条，短句、中文。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          resume_summary: String(resumeSummary || '').slice(0, 400),
          strengths,
          weaknesses,
          interview_turns: (turns || []).map((turn) => ({
            turn_index: turn.turn_index,
            question: String(turn.question || '').slice(0, 180),
            score: turn.score,
            strengths: turn.strengths || [],
            weaknesses: turn.weaknesses || [],
          })),
          jd_related_questions: jobQuestionTypes,
          rules: [
            'stable_strengths 只保留跨多轮成立的优势',
            'stable_weaknesses 只保留反复出现或影响评分的弱点',
            'project_signals 聚焦项目型能力信号',
            'role_fit_signals 聚焦与 JD 适配或不适配的信号',
            'recommended_focus 必须是后续可执行的练习重点',
          ],
        }),
      },
    ],
  });

  const normalizeList = (value, limit) =>
    Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit)
      : [];

  return {
    stable_strengths: normalizeList(result?.stable_strengths, 4).length > 0
      ? normalizeList(result?.stable_strengths, 4)
      : fallback.stable_strengths,
    stable_weaknesses: normalizeList(result?.stable_weaknesses, 5).length > 0
      ? normalizeList(result?.stable_weaknesses, 5)
      : fallback.stable_weaknesses,
    project_signals: normalizeList(result?.project_signals, 4).length > 0
      ? normalizeList(result?.project_signals, 4)
      : fallback.project_signals,
    role_fit_signals: normalizeList(result?.role_fit_signals, 4).length > 0
      ? normalizeList(result?.role_fit_signals, 4)
      : fallback.role_fit_signals,
    recommended_focus: normalizeList(result?.recommended_focus, 4).length > 0
      ? normalizeList(result?.recommended_focus, 4)
      : fallback.recommended_focus,
  };
};

const evaluateAnswer = ({ question, answer, evidenceRefs, focusTerms = [] }) => {
  const answerText = String(answer || '').trim();
  const answerLength = answerText.length;
  const questionTerms = tokenize(question);
  const answerTerms = tokenize(answerText);
  const evidenceTerms = tokenize((evidenceRefs || []).map((item) => item.quote || '').join(' '));
  // focusTerms 来自检索计划，用来衡量回答是否覆盖了这道题真正想考察的技术点。
  const usefulFocusTerms = Array.from(new Set((focusTerms || [])
    .map((term) => String(term || '').trim().toLowerCase())
    .filter((term) => term.length >= 2)
    .filter((term) => /[a-z0-9]/.test(term) || term.length <= 6)));

  const questionCoverageCount = questionTerms.filter((term) => answerTerms.includes(term)).length;
  const questionCoverage = questionTerms.length === 0 ? 0 : questionCoverageCount / questionTerms.length;
  const evidenceSupportCount = answerTerms.filter((term) => evidenceTerms.includes(term)).length;
  const evidenceSupport = answerTerms.length === 0 ? 0 : evidenceSupportCount / answerTerms.length;
  const focusMatches = usefulFocusTerms.filter((term) => answerText.toLowerCase().includes(term)).length;

  // 分数拆成 5 部分：作答长度、证据数量、题目覆盖、证据呼应、关键技术点覆盖。
  const base = Math.min(58, 34 + Math.floor(answerLength / 14));
  const evidenceBonus = Math.min(20, (evidenceRefs || []).length * 4);
  const coverageBonus = Math.min(8, Math.round(questionCoverage * 8));
  const supportBonus = Math.min(8, Math.round(evidenceSupport * 16));
  const focusBonus = Math.min(14, focusMatches * 4);
  const score = Math.max(0, Math.min(100, base + evidenceBonus + coverageBonus + supportBonus + focusBonus));

  const strengths = [];
  if (answerLength >= 120) strengths.push('回答展开较完整');
  if ((evidenceRefs || []).length >= 2) strengths.push('能关联到用户资料证据');
  if (focusMatches >= 2 || questionCoverage >= 0.35) strengths.push('问题关键词覆盖较好');

  const weaknesses = [];
  if (answerLength < 60) weaknesses.push('回答偏短，论述不充分');
  if ((evidenceRefs || []).length === 0) weaknesses.push('缺少可回溯证据');
  if (focusMatches === 0 && questionCoverage < 0.2) weaknesses.push('回答与题目关键词贴合度偏低');
  if ((evidenceRefs || []).length > 0 && answerLength >= 80 && evidenceSupport < 0.04) weaknesses.push('答案与已检索证据的呼应不足');

  if (strengths.length === 0) strengths.push('已完成基础作答');
  if (weaknesses.length === 0) weaknesses.push('可继续补充更具体的项目细节');

  const feedback = weaknesses[0] || strengths[0];
  return { score, strengths, weaknesses, feedback };
};

const buildRubricFallback = ({ question, answer, evidenceRefs, focusTerms }) => {
  const draft = evaluateAnswer({ question, answer, evidenceRefs, focusTerms });
  const score = clampNumber(draft.score, 0, 100);
  const technicalDepth = clampNumber(Math.round(score * 0.3), 0, 25);
  const structureClarity = clampNumber(Math.round(score * 0.2), 0, 25);
  const evidenceGrounding = clampNumber(Math.min(25, (evidenceRefs || []).length * 6), 0, 25);
  const roleFit = clampNumber(score - technicalDepth - structureClarity - evidenceGrounding, 0, 25);

  return {
    dimension_scores: {
      technical_depth: technicalDepth,
      structure_clarity: structureClarity,
      evidence_grounding: evidenceGrounding,
      role_fit: roleFit,
    },
    total_score: technicalDepth + structureClarity + evidenceGrounding + roleFit,
    strengths: draft.strengths,
    weaknesses: draft.weaknesses,
    feedback: draft.feedback,
    standard_answer: buildStandardAnswerFallback({ question, evidenceRefs }),
  };
};

const classifyInterviewIntentFallback = ({ input }) => {
  const text = String(input || '').trim();

  if (!text) {
    return { intent: 'invalid', confidence: 100, reason: '空输入，无法判断为有效回答' };
  }

  if (/(跳过|skip|pass|不会|没想好|答不上来|不太会)/i.test(text)) {
    return { intent: 'skip', confidence: 88, reason: '用户明确表达跳过或暂时不会回答' };
  }

  if (/(什么意思|没太懂|没听清|再说一遍|换个说法|解释一下|能具体一点吗)/i.test(text)) {
    return { intent: 'clarify', confidence: 86, reason: '用户在要求澄清题意或让面试官重述' };
  }

  if (/(评分标准|怎么评|为什么问|下一题|结束了吗|流程|第几题|多久)/i.test(text)) {
    return { intent: 'meta', confidence: 82, reason: '用户在询问流程、规则或面试元信息' };
  }

  if ((/[?？]$/.test(text) || /请问|方便说下|能否|可以先/i.test(text)) && text.length <= 80) {
    return { intent: 'question_back', confidence: 72, reason: '输入更像是反问面试官，而不是直接作答' };
  }

  if (text.length < 8) {
    return { intent: 'invalid', confidence: 70, reason: '内容过短，缺少可评分信息' };
  }

  return { intent: 'answer', confidence: text.length >= 40 ? 80 : 62, reason: '输入包含连续表述，更接近候选人作答' };
};

const classifyInterviewTurnIntent = async ({
  question,
  input,
  interviewContext,
}) => {
  const fallback = classifyInterviewIntentFallback({ input });
  const result = await jsonCompletion({
    fallback,
    normalizer: normalizeInterviewIntentResult,
    validator: validateInterviewIntentResult,
    repairPrompt: '只返回合法 JSON：{"intent":"answer|clarify|question_back|skip|meta|invalid","confidence":0,"reason":"..."}。不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是模拟面试流程路由器。',
          '你的任务是判断用户这一轮输入究竟是在回答题目，还是在澄清、反问、跳过、询问流程。',
          '只输出 JSON：{"intent":"answer|clarify|question_back|skip|meta|invalid","confidence":0-100,"reason":"简短原因"}。',
          'answer 表示这是可评分回答；clarify 表示用户没理解题意；question_back 表示用户在反问面试官；skip 表示明确跳过；meta 表示问流程/规则；invalid 表示内容太短或无效。',
          '如果输入同时含少量寒暄和有效回答，以 answer 为准。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          current_question: String(question || '').slice(0, 220),
          user_input: String(input || '').slice(0, 800),
          interview_context: String(interviewContext || '').slice(0, 1200),
        }),
      },
    ],
  });

  return {
    intent: result.intent,
    confidence: result.confidence,
    reason: result.reason,
  };
};

const scoreAnswerWithRubricLLM = async ({
  question,
  answer,
  evidenceRefs,
  interviewContext,
  focusTerms,
  resumeSummary,
  jobDescription,
  questionType = 'project',
  retrievalPlan = null,
}) => {
  const fallback = buildRubricFallback({ question, answer, evidenceRefs, focusTerms });
  const result = await jsonCompletion({
    fallback,
    normalizer: normalizeRubricScoreResult,
    validator: validateRubricScoreResult,
    repairPrompt: '只返回合法 JSON：{"dimension_scores":{"technical_depth":0,"structure_clarity":0,"evidence_grounding":0,"role_fit":0},"total_score":0,"strengths":["..."],"weaknesses":["..."],"feedback":"...","standard_answer":"..."}。不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是前端模拟面试评分官。',
          '请结合候选人的回答、当前问题、题型、简历摘要、JD、历史上下文和检索证据，进行 rubric 评分。',
          '四个维度各 0-25 分：technical_depth 技术深度、structure_clarity 表达结构、evidence_grounding 证据支撑、role_fit 与岗位匹配度。',
          '必须先判断回答本身是否合理，再参考证据是否能支撑或补强；不要用简单关键词命中替代判断。',
          'project / scenario 题要重点判断方案是否合理、是否符合项目背景、是否讲清取舍与验证；knowledge 题要重点判断技术结论是否正确；basic 题要重点判断项目背景、职责与成果表达是否可信且贴合 JD。',
          '只输出 JSON：{"dimension_scores":{"technical_depth":0,"structure_clarity":0,"evidence_grounding":0,"role_fit":0},"total_score":0,"strengths":["..."],"weaknesses":["..."],"feedback":"...","standard_answer":"..."}。',
          'strengths 和 weaknesses 各 1-3 条，必须紧扣回答质量；feedback 用一句话指出最优先改进点；standard_answer 必须优先参考 evidence_refs、resume_summary、job_description 组织更优回答。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: String(question || '').slice(0, 300),
          question_type: String(questionType || 'project'),
          answer: String(answer || '').slice(0, 3000),
          resume_summary: String(resumeSummary || '').slice(0, 800),
          job_description: String(jobDescription || '').slice(0, 1800),
          interview_context: String(interviewContext || '').slice(0, 1800),
          retrieval_plan: retrievalPlan ? {
            question_type: retrievalPlan.question_type,
            paths: (retrievalPlan.paths || []).map((item) => path.basename(String(item || ''))).slice(0, 6),
            active_resume: retrievalPlan.active_resume_path ? path.basename(retrievalPlan.active_resume_path) : null,
            active_jd: retrievalPlan.active_jd_path ? path.basename(retrievalPlan.active_jd_path) : null,
            knowledge_docs: (retrievalPlan.selected_knowledge_paths || []).map((item) => path.basename(String(item || ''))).slice(0, 4),
          } : null,
          focus_terms: (focusTerms || []).slice(0, 12),
          evidence_refs: (evidenceRefs || []).slice(0, 6).map((item) => ({
            source_type: item.source_type,
            source_uri: item.source_uri,
            quote: String(item.quote || '').slice(0, 220),
            confidence: item.confidence,
          })),
          scoring_rules: [
            '优先看回答是否讲清业务背景、个人职责、方案取舍、验证结果',
            '回答如果只停留在抽象定义或空泛结论，应明显扣分',
            'evidence_grounding 看回答与证据、简历、JD 是否能互相印证，不是看关键词数量',
            'role_fit 看回答是否贴近岗位职责与面试题目标',
          ],
        }),
      },
    ],
  });

  return {
    score: clampNumber(result.total_score, 0, 100),
    dimension_scores: result.dimension_scores,
    strengths: result.strengths.length > 0 ? result.strengths : fallback.strengths,
    weaknesses: result.weaknesses.length > 0 ? result.weaknesses : fallback.weaknesses,
    feedback: result.feedback || fallback.feedback,
    standard_answer: result.standard_answer || fallback.standard_answer,
  };
};

const buildEvaluationNarrationFallback = ({
  score,
  strengths,
  weaknesses,
  feedback,
  standardAnswer,
}) => [
  `本轮回答得分 ${score} 分。`,
  feedback ? `总体判断：${feedback}` : '',
  strengths.length > 0 ? `相对做得好的部分是：${strengths.join('；')}。` : '',
  weaknesses.length > 0 ? `当前最需要补强的是：${weaknesses.join('；')}。` : '',
  standardAnswer ? `如果你想把这题答得更完整，可以这样组织：${standardAnswer}` : '',
].filter(Boolean).join('\n');

const streamAssistantText = async ({ messages, fallback, onToken, logLabel }) => {
  if (!hasRealLLM()) {
    const parts = String(fallback || '').match(/.{1,12}/g) || [];
    for (const part of parts) {
      if (typeof onToken === 'function') {
        await onToken(part);
      }
    }
    return String(fallback || '');
  }

  let full = '';
  for await (const delta of streamCompletion({ messages })) {
    full += delta;
    if (typeof onToken === 'function') {
      await onToken(delta);
    }
  }
  console.log(logLabel || '[interview.stream.raw]', { content: full });
  return String(full || fallback || '').trim() || String(fallback || '');
};

const generateEvaluationNarration = async ({
  question,
  answer,
  score,
  dimensionScores,
  strengths,
  weaknesses,
  feedback,
  standardAnswer,
  interviewContext,
  onToken,
}) => {
  const fallback = buildEvaluationNarrationFallback({
    score,
    strengths,
    weaknesses,
    feedback,
    standardAnswer,
  });

  return streamAssistantText({
    fallback,
    onToken,
    logLabel: '[interview.evaluation.raw]',
    messages: [
      {
        role: 'system',
        content: [
          '你是前端面试反馈助手。',
          '你已经拿到 rubric 评分结果，现在需要直接面向候选人输出自然语言评价。',
          '不要输出 JSON，不要复述维度名，不要解释系统过程。',
          '输出 3-5 句中文：先给出整体判断，再点出 1-2 个优点，接着指出最关键的改进点，最后给一句更优回答组织建议。',
          '语气克制、专业、像真实面试官当场反馈。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          question: String(question || '').slice(0, 240),
          answer: String(answer || '').slice(0, 2000),
          interview_context: String(interviewContext || '').slice(0, 1200),
          score,
          dimension_scores: dimensionScores,
          strengths,
          weaknesses,
          feedback,
          standard_answer: standardAnswer,
        }),
      },
    ],
  });
};

const generateInterviewerReply = async ({
  intent,
  queuedQuestion,
  input,
  interviewContext,
  onToken,
}) => {
  const fallback = buildInterviewReplyFallback({ intent, queuedQuestion, input });
  return streamAssistantText({
    fallback,
    onToken,
    logLabel: '[interview.reply.raw]',
    messages: [
      {
        role: 'system',
        content: [
          '你是中文前端模拟面试官。',
          '请根据用户意图给出一段简短自然的现场回复。',
          '如果是 clarify，要换个说法重述当前问题；如果是 question_back，要先简短回应再把话题收回当前题；如果是 meta，要简短回答流程问题后引导回当前题；如果是 skip，要确认跳过并进入下一题；如果是 invalid，要提示用户给出可评分回答。',
          '不要输出 JSON，不要长篇说教，控制在 2-4 句。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          intent,
          current_question: queuedQuestion?.stem || '',
          expected_points: queuedQuestion?.expected_points || [],
          user_input: String(input || '').slice(0, 600),
          interview_context: String(interviewContext || '').slice(0, 1200),
        }),
      },
    ],
  });
};

const buildQuestionQueueFallback = ({ resumeSummary, jobDescription, targetLevel }) => {
  const resumeHint = String(resumeSummary || '').trim();
  const jdHint = String(jobDescription || '').trim();
  const hasResume = resumeHint.length > 0;
  const hasJd = jdHint.length > 0;
  const jdSnippet = hasJd ? jdHint.slice(0, 120) : '常见前端岗位要求';

  return [
    {
      source: hasResume ? 'resume' : 'llm',
      question_type: 'project',
      difficulty: 'easy',
      stem: hasResume
        ? '请先做一个简短自我介绍，并挑一段你最能代表自己前端能力的项目经历展开说明。'
        : '请先做一个简短自我介绍，并说明你最近一段最有代表性的前端项目经历。',
      expected_points: ['项目背景', '个人职责', '技术亮点'],
      resume_anchor: hasResume ? resumeHint.slice(0, 80) : '',
      source_ref: hasResume ? 'resume_summary' : 'llm_fallback',
    },
    {
      source: hasJd ? 'doc' : 'llm',
      question_type: 'basic',
      difficulty: 'medium',
      stem: `结合这份 JD 的要求：${jdSnippet}。你认为这个岗位最看重候选人的哪三项前端能力？你会如何证明自己具备这些能力？`,
      expected_points: ['JD 要求拆解', '能力映射', '证明方式'],
      resume_anchor: '',
      source_ref: hasJd ? 'job_description' : 'llm_fallback',
    },
    {
      source: hasResume ? 'resume' : 'llm',
      question_type: 'project',
      difficulty: 'medium',
      stem: '从你的简历里挑一个最复杂的前端项目，说明业务目标、技术难点、你的方案，以及最后结果。',
      expected_points: ['业务目标', '技术难点', '方案', '结果'],
      resume_anchor: hasResume ? resumeHint.slice(0, 120) : '',
      source_ref: hasResume ? 'resume_summary' : 'llm_fallback',
    },
    {
      source: hasJd ? 'doc' : 'llm',
      question_type: 'scenario',
      difficulty: targetLevel === 'senior' ? 'hard' : 'medium',
      stem: '如果你入职这个岗位后要在两周内接手核心前端模块，你会如何理解现状、识别风险，并制定前 30 天的推进计划？',
      expected_points: ['接手策略', '风险识别', '推进节奏'],
      resume_anchor: '',
      source_ref: hasJd ? 'job_description' : 'llm_generated',
    },
    {
      source: 'llm',
      question_type: 'scenario',
      difficulty: 'hard',
      stem: '假设线上核心页面出现性能或稳定性问题，但业务方要求本周必须上线新需求，你会如何做排查、沟通和技术取舍？',
      expected_points: ['排查顺序', '沟通策略', '技术取舍'],
      resume_anchor: '',
      source_ref: 'llm_generated',
    },
  ];
};

const normalizeGeneratedQuestions = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: randomUUID(),
      order_no: index + 1,
      source: ['resume', 'doc', 'llm'].includes(String(item?.source || '').trim()) ? String(item.source).trim() : 'llm',
      question_type: ['basic', 'project', 'scenario', 'follow_up'].includes(String(item?.question_type || '').trim()) ? String(item.question_type).trim() : 'basic',
      difficulty: ['easy', 'medium', 'hard'].includes(String(item?.difficulty || '').trim()) ? String(item.difficulty).trim() : 'medium',
      stem: String(item?.stem || '').trim(),
      expected_points: Array.isArray(item?.expected_points) ? item.expected_points.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 5) : [],
      resume_anchor: String(item?.resume_anchor || '').trim(),
      source_ref: String(item?.source_ref || '').trim(),
      status: index === 0 ? 'asked' : 'pending',
    }))
    .filter((item) => item.stem)
    .slice(0, 5);

const generateInterviewQuestionQueue = async ({ user, jobDescription, targetLevel }) => {
  const fallbackItems = buildQuestionQueueFallback({
    resumeSummary: user?.resume_summary || '',
    jobDescription,
    targetLevel,
  }).map((item, index) => ({
    id: randomUUID(),
    order_no: index + 1,
    ...item,
    status: index === 0 ? 'asked' : 'pending',
  }));

  const result = await jsonCompletion({
    fallback: { questions: fallbackItems },
    normalizer: (value) => ({ questions: normalizeGeneratedQuestions(value?.questions || value?.items || value) }),
    validator: (value) => {
      const base = validateObjectShape(value, ['questions']);
      if (!base.ok) return base;
      if (!Array.isArray(value.questions) || value.questions.length === 0) {
        return { ok: false, error: 'questions must be a non-empty array' };
      }
      return { ok: true };
    },
    repairPrompt: '只返回合法 JSON：{"questions":[{"source":"resume|doc|llm","question_type":"basic|project|scenario","difficulty":"easy|medium|hard","stem":"...","expected_points":["..."],"resume_anchor":"","source_ref":"resume_summary|job_description|llm_generated"}]}。questions 必须是非空数组，不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是资深前端模拟面试官和面试流程设计师。',
          '你的目标不是随机出题，而是像真实一面那样，基于候选人简历和目标岗位 JD，生成一组按顺序推进的问题队列。',
          '题目必须口语化、自然、可直接用于中文面试现场发问。',
          '每题只问一个核心点，不要把多个问题塞进同一句。',
          '优先考察真实项目经历、岗位匹配度、技术取舍、结果指标和复盘能力。',
          '必须输出 JSON，不能输出解释。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          interview_mode: 'resume_jd',
          target_level: targetLevel,
          question_count: 5,
          structure: [
            '1 opening/self-intro',
            '1 jd-fit',
            '2 project-deep-dive',
            '1 scenario/tradeoff',
          ],
          resume_summary: String(user?.resume_summary || '').slice(0, 800),
          job_description: String(jobDescription || '').slice(0, 2400),
          output_contract: {
            questions: [
              {
                source: 'resume|doc|llm',
                question_type: 'basic|project|scenario',
                difficulty: 'easy|medium|hard',
                stem: '题干',
                expected_points: ['要点1', '要点2'],
                resume_anchor: '可选，命中简历时填写',
                source_ref: 'resume_summary|job_description|llm_generated',
              },
            ],
          },
          rules: [
            '第一题必须适合开场自我介绍，并自然引出一段最有代表性的项目经历',
            '至少两题要明显关联 JD 的职责、能力要求或业务场景，但不能逐字复述 JD',
            '至少两题要要求候选人结合真实项目经历回答，不能只问抽象八股',
            '题目顺序必须符合真实面试节奏：先建立背景，再验证匹配度，再深挖项目，最后进入压力场景或取舍题',
            '每题只问一个核心点，禁止复合长问题',
            '不要生成重复题、空泛题、纯定义题',
            'expected_points 必须能体现这题真正要考察的内容，如业务背景、技术取舍、指标结果、协作推进、复盘反思',
            '每次只输出 5 题，不要额外解释',
          ],
        }),
      },
    ],
  });

  const normalized = normalizeGeneratedQuestions(result?.questions);
  return normalized.length > 0 ? normalized : fallbackItems;
};

const summarizeResumeWithLLM = async (resumeText, fallbackSummary) => {
  const fallback = { summary: fallbackSummary };
  const result = await jsonCompletion({
    fallback,
    normalizer: normalizeSummaryResult,
    validator: validateSummaryResult,
    repairPrompt: '只返回合法 JSON：{"summary":"..."}。summary 必须是非空字符串，不要输出解释。',
    messages: [
      {
        role: 'system',
        content: '你是前端候选人画像助手。请输出 JSON：{"summary":"不超过120字的中文摘要"}。',
      },
      {
        role: 'user',
        content: `请总结这份简历，强调经验年限、核心技术、代表性方向。\n\n${String(resumeText || '').slice(0, 5000)}`,
      },
    ],
  });
  return String(result?.summary || fallbackSummary).trim() || fallbackSummary;
};

const enhanceEvaluationWithLLM = async ({
  question,
  answer,
  evidenceRefs,
  interviewContext,
  focusTerms = [],
  resumeSummary = '',
  jobDescription = '',
  questionType = 'project',
  retrievalPlan = null,
}) => {
  return scoreAnswerWithRubricLLM({
    question,
    answer,
    evidenceRefs,
    interviewContext,
    focusTerms,
    resumeSummary,
    jobDescription,
    questionType,
    retrievalPlan,
  });
};

const shouldInsertFollowUp = ({ queuedQuestion, score, weaknesses, queueItems }) => {
  if (!queuedQuestion) return false;
  if (queuedQuestion.question_type === 'follow_up') return false;
  if (queuedQuestion.status === 'answered') return false;

  const weaknessList = Array.isArray(weaknesses) ? weaknesses.filter(Boolean) : [];
  const weakSignal = score < 70 || weaknessList.length > 0;
  if (!weakSignal) return false;

  // 同一道主问题只允许插入一条追问，避免队列不断膨胀。
  const existedFollowUp = (queueItems || []).some((item) =>
    item.question_type === 'follow_up'
    && item.source_ref === `follow_up_of:${queuedQuestion.id}`,
  );

  return !existedFollowUp;
};

const buildFollowUpFallback = ({ queuedQuestion, answer, weaknesses }) => {
  const weakness = String((weaknesses || [])[0] || '关键技术点说明不足').trim();
  const expectedPoints = Array.isArray(queuedQuestion?.expected_points)
    ? queuedQuestion.expected_points.slice(0, 2)
    : [];
  const expectedHint = expectedPoints.length > 0 ? `请至少补充 ${expectedPoints.join('、')}。` : '请补充更具体的实现细节、判断依据与结果。';
  const answerPreview = String(answer || '').trim().slice(0, 60);

  return {
    source: 'llm',
    question_type: 'follow_up',
    difficulty: queuedQuestion?.difficulty === 'hard' ? 'hard' : 'medium',
    stem: `你刚才这题里“${weakness}”。请围绕“${queuedQuestion?.stem || ''}”继续补充，如果基于项目回答，请说清背景、方案取舍与结果。${answerPreview ? `你上一轮提到：${answerPreview}。` : ''}${expectedHint}`,
    expected_points: expectedPoints.length > 0 ? expectedPoints : ['补足技术细节', '说明取舍理由', '给出结果验证'],
    resume_anchor: queuedQuestion?.resume_anchor || '',
    source_ref: `follow_up_of:${queuedQuestion?.id || ''}`,
    status: 'asked',
  };
};

const generateFollowUpQuestion = async ({ queuedQuestion, answer, weaknesses, interviewContext }) => {
  const fallback = buildFollowUpFallback({ queuedQuestion, answer, weaknesses });
  const result = await jsonCompletion({
    fallback,
    normalizer: (value) => ({
      source: 'llm',
      question_type: 'follow_up',
      difficulty: ['easy', 'medium', 'hard'].includes(String(value?.difficulty || '').trim())
        ? String(value.difficulty).trim()
        : fallback.difficulty,
      stem: normalizeString(value?.stem, fallback.stem, 300),
      expected_points: normalizeStringList(value?.expected_points, 4),
      resume_anchor: normalizeString(value?.resume_anchor, fallback.resume_anchor, 160),
      source_ref: fallback.source_ref,
      status: 'asked',
    }),
    validator: (value) => {
      const base = validateObjectShape(value, ['difficulty', 'stem', 'expected_points', 'resume_anchor', 'source_ref', 'status']);
      if (!base.ok) return base;
      if (!Array.isArray(value.expected_points)) return { ok: false, error: 'expected_points must be an array' };
      if (!value.stem) return { ok: false, error: 'stem is empty' };
      return { ok: true };
    },
    repairPrompt: '只返回合法 JSON：{"source":"llm","question_type":"follow_up","difficulty":"easy|medium|hard","stem":"...","expected_points":["..."],"resume_anchor":"","source_ref":"follow_up_of:问题ID","status":"asked"}。不要输出解释。',
    messages: [
      {
        role: 'system',
        content: [
          '你是前端面试官。',
          '请基于当前题目与候选人的薄弱点生成 1 道追问。',
          '追问必须短、具体、可继续评分，且紧贴上一题，不要开启新话题。',
          '输出 JSON：{"source":"llm","question_type":"follow_up","difficulty":"easy|medium|hard","stem":"...","expected_points":["..."],"resume_anchor":"...","source_ref":"follow_up_of:问题ID","status":"asked"}。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          current_question: queuedQuestion?.stem || '',
          current_question_type: queuedQuestion?.question_type || 'basic',
          difficulty: queuedQuestion?.difficulty || 'medium',
          expected_points: queuedQuestion?.expected_points || [],
          resume_anchor: queuedQuestion?.resume_anchor || '',
          answer: String(answer || '').slice(0, 1200),
          interview_context: String(interviewContext || '').slice(0, 2600),
          weaknesses: (weaknesses || []).slice(0, 3),
          rules: [
            '只生成 1 道追问',
            '追问必须聚焦当前题最弱的一点',
            '题干里尽量要求补充项目细节、取舍和验证',
          ],
        }),
      },
    ],
  });

  return {
    ...fallback,
    ...result,
    source: 'llm',
    question_type: 'follow_up',
    difficulty: ['easy', 'medium', 'hard'].includes(String(result?.difficulty || '').trim())
      ? String(result.difficulty).trim()
      : fallback.difficulty,
    stem: String(result?.stem || fallback.stem).trim() || fallback.stem,
    expected_points: Array.isArray(result?.expected_points)
      ? result.expected_points.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : fallback.expected_points,
    resume_anchor: String(result?.resume_anchor || fallback.resume_anchor).trim(),
    source_ref: fallback.source_ref,
    status: 'asked',
  };
};

const submitInterviewTurn = async ({ sessionId, body, onPhase, onToken }) => {
  const emitPhase = async (phase, message) => {
    if (typeof onPhase === 'function') {
      await onPhase(phase, message);
    }
  };
  const questionId = String(body.question_id || '').trim();
  const queuedQuestion = questionId ? getInterviewQuestionById(questionId) : null;
  const question = String(body.question || queuedQuestion?.stem || '').trim();
  const answer = String(body.answer || '').trim();
  const evidence_refs = Array.isArray(body.evidence_refs) ? body.evidence_refs : [];
  if (!sessionId) throw new Error('session_id is required');
  if (!question) throw new Error('question is required');
  if (questionId && (!queuedQuestion || queuedQuestion.session_id !== sessionId)) throw new Error('question_id is invalid');
  if (queuedQuestion?.status === 'answered') throw new Error('question already answered');
  if (!answer) throw new Error('answer is required');

  const session = getInterviewSession(sessionId);
  if (!session) {
    const error = new Error('session not found');
    error.statusCode = 404;
    throw error;
  }
  if (session.status !== 'in_progress') throw new Error('session is not in progress');

  const turns = listInterviewTurns(sessionId);
  const turnIndex = turns.length + 1;
  const interviewContext = await buildInterviewContextWindow({
    turns,
    currentQuestion: question,
  });
  const user = getUserById(session.user_id);
  const activeJd = user?.active_jd_file
    ? readJdDoc({ userId: session.user_id, fileName: user.active_jd_file })
    : null;
  const resumeSummary = String(user?.resume_summary || '').trim();
  const jobDescription = String(activeJd?.content || '').trim();

  await emitPhase('intent', '正在判断这轮输入属于回答还是其他意图...');
  const intentResult = await classifyInterviewTurnIntent({
    question,
    input: answer,
    interviewContext: interviewContext.contextText,
  });

  if (intentResult.intent !== 'answer') {
    if (intentResult.intent === 'skip') {
      await emitPhase('planning', '已跳过当前题，正在切换到下一题...');
      if (queuedQuestion) {
        updateInterviewQuestionStatus({ questionId: queuedQuestion.id, status: 'skipped' });
      }
      let nextQuestion = getNextInterviewQuestion(sessionId);
      if (nextQuestion && nextQuestion.status === 'pending') {
        updateInterviewQuestionStatus({ questionId: nextQuestion.id, status: 'asked' });
        nextQuestion = { ...nextQuestion, status: 'asked' };
      }
      const replyText = await generateInterviewerReply({
        intent: 'skip',
        queuedQuestion,
        input: answer,
        interviewContext: interviewContext.contextText,
        onToken,
      });
      return {
        session_id: sessionId,
        question_id: queuedQuestion?.id || null,
        turn_id: null,
        turn_index: turnIndex,
        intent: intentResult.intent,
        intent_confidence: intentResult.confidence,
        intent_reason: intentResult.reason,
        handled_as: 'skip',
        current_question_status: 'skipped',
        reply_text: replyText,
        evaluation_text: replyText,
        next_question: nextQuestion ? {
          id: nextQuestion.id,
          order_no: nextQuestion.order_no,
          stem: nextQuestion.stem,
          source: nextQuestion.source,
          question_type: nextQuestion.question_type,
          difficulty: nextQuestion.difficulty,
          status: nextQuestion.status,
        } : null,
      };
    }

    await emitPhase('reply', '当前输入不作为评分回答，正在生成面试官回复...');
    const replyText = await generateInterviewerReply({
      intent: intentResult.intent,
      queuedQuestion,
      input: answer,
      interviewContext: interviewContext.contextText,
      onToken,
    });

    return {
      session_id: sessionId,
      question_id: queuedQuestion?.id || null,
      turn_id: null,
      turn_index: turnIndex,
      intent: intentResult.intent,
      intent_confidence: intentResult.confidence,
      intent_reason: intentResult.reason,
      handled_as: 'non_answer',
      current_question_status: queuedQuestion?.status || 'asked',
      reply_text: replyText,
      evaluation_text: replyText,
      next_question: queuedQuestion ? {
        id: queuedQuestion.id,
        order_no: queuedQuestion.order_no,
        stem: queuedQuestion.stem,
        source: queuedQuestion.source,
        question_type: queuedQuestion.question_type,
        difficulty: queuedQuestion.difficulty,
        status: queuedQuestion.status || 'asked',
      } : null,
    };
  }

  await emitPhase('question_type', '正在识别当前题型并规划证据来源...');
  const questionTypeResult = await classifyQuestionType({
    question,
    answer,
    queuedQuestionType: queuedQuestion?.question_type || '',
    interviewContext: interviewContext.contextText,
  });

  const retrievalPlanner = await planRetrievalWithLLM({
    question,
    answer,
    questionType: questionTypeResult.question_type,
    intent: intentResult.intent,
    interviewContext: interviewContext.contextText,
  });
  console.log('[retrieval.planner]', {
    session_id: sessionId,
    question_type: questionTypeResult.question_type,
    planner: retrievalPlanner,
  });

  await emitPhase('retrieval', '正在检索候选人资料与知识证据...');
  const evidenceBundle = await buildEvidenceBundle({
    userId: session.user_id,
    question,
    answer,
    user,
    questionType: questionTypeResult.question_type,
    retrievalPlanner,
  });
  const rawEvidenceRefs = evidence_refs.length > 0 ? evidence_refs : evidenceBundle.evidenceRefs;
  const focusTerms = [
    ...(evidenceBundle.queryPlan?.keyword_groups?.entity_terms || []),
    ...(evidenceBundle.queryPlan?.keyword_groups?.intent_terms || []),
    ...(evidenceBundle.queryPlan?.keyword_groups?.evidence_terms || []),
  ];
  await emitPhase('evaluation', '正在生成评分与反馈...');
  const {
    score,
    dimension_scores,
    strengths,
    weaknesses,
    feedback,
    standard_answer,
  } = await enhanceEvaluationWithLLM({
    question,
    answer,
    evidenceRefs: rawEvidenceRefs,
    interviewContext: interviewContext.contextText,
    focusTerms,
    resumeSummary,
    jobDescription,
    questionType: questionTypeResult.question_type,
    retrievalPlan: evidenceBundle.retrievalPlan,
  });
  await emitPhase('feedback', '正在整理最终评价...');
  const evaluationText = await generateEvaluationNarration({
    question,
    answer,
    score,
    dimensionScores: dimension_scores,
    strengths,
    weaknesses,
    feedback,
    standardAnswer: standard_answer,
    interviewContext: interviewContext.contextText,
    onToken,
  });
  await emitPhase('persist', '正在写入评分结果...');
  const turnId = randomUUID();
  addInterviewTurn({
    id: turnId,
    sessionId,
    questionId: queuedQuestion?.id || null,
    turnIndex,
    question,
    answer,
    score,
    strengths,
    weaknesses,
    evidenceRefsCount: rawEvidenceRefs.length,
  });

  let nextQuestion = null;
  if (queuedQuestion) {
    updateInterviewQuestionStatus({ questionId: queuedQuestion.id, status: 'answered' });

    const queueItems = listInterviewQuestions(sessionId);
    if (shouldInsertFollowUp({
      queuedQuestion,
      score,
      weaknesses,
      queueItems,
    })) {
      const followUp = await generateFollowUpQuestion({
        queuedQuestion,
        answer,
        weaknesses,
        interviewContext: interviewContext.contextText,
      });
      const followUpItem = {
        id: randomUUID(),
        ...followUp,
      };
      try {
        insertInterviewQuestionAfter({
          sessionId,
          afterOrderNo: queuedQuestion.order_no,
          item: followUpItem,
        });
        nextQuestion = {
          ...followUpItem,
          session_id: sessionId,
          order_no: queuedQuestion.order_no + 1,
        };
      } catch (insertError) {
        console.error('[interview.follow_up.insert_failed]', insertError);
      }
    }
  }
  await emitPhase('planning', '正在规划下一题...');
  if (!nextQuestion) {
    nextQuestion = getNextInterviewQuestion(sessionId);
  }
  if (nextQuestion && nextQuestion.status === 'pending') {
    updateInterviewQuestionStatus({ questionId: nextQuestion.id, status: 'asked' });
    nextQuestion = { ...nextQuestion, status: 'asked' };
  }

  return {
    session_id: sessionId,
    question_id: queuedQuestion?.id || null,
    turn_id: turnId,
    turn_index: turnIndex,
    intent: intentResult.intent,
    intent_confidence: intentResult.confidence,
    intent_reason: intentResult.reason,
    handled_as: 'answer',
    resolved_question_type: questionTypeResult.question_type,
    question_type_reason: questionTypeResult.reason,
    retrieval_planner: retrievalPlanner,
    current_question_status: 'answered',
    retrieval_strategy: evidenceBundle.strategy,
    score,
    dimension_scores,
    strengths,
    weaknesses,
    feedback,
    standard_answer,
    evaluation_text: evaluationText,
    evidence_refs_count: rawEvidenceRefs.length,
    evidence_refs: rawEvidenceRefs,
    next_question: nextQuestion ? {
      id: nextQuestion.id,
      order_no: nextQuestion.order_no,
      stem: nextQuestion.stem,
      source: nextQuestion.source,
      question_type: nextQuestion.question_type,
      difficulty: nextQuestion.difficulty,
      status: nextQuestion.status,
    } : null,
  };
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const corsHeaders = getCorsHeaders(req);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'fementor-api',
      date: new Date().toISOString(),
      db_path: DB_PATH,
      llm: {
        enabled: hasRealLLM(),
        model: OPENAI_MODEL,
        base_url: OPENAI_BASE_URL,
      },
      sirchmunk: getSirchmunkStatus(),
    });
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/sessions/start') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      const title = String(body.title || '').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      const session = createChatSession({ id: randomUUID(), userId, title });
      return json(res, 200, session);
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (
    req.method === 'GET'
    && /^\/v1\/chat\/sessions\/[^/]+\/messages$/.test(url.pathname)
  ) {
    const sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
    if (!sessionId) return json(res, 400, { error: 'session_id is required' });
    const session = getChatSession(sessionId);
    if (!session) return json(res, 404, { error: 'session not found' });
    const limit = Number(url.searchParams.get('limit') || 100);
    const messages = listChatMessages(sessionId, Number.isNaN(limit) ? 100 : limit);
    return json(res, 200, { session, items: messages });
  }

  if (
    req.method === 'POST'
    && /^\/v1\/chat\/sessions\/[^/]+\/messages$/.test(url.pathname)
  ) {
    try {
      const sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
      const body = await readBody(req);
      const content = String(body.content || '').trim();
      const systemPrompt = String(body.system_prompt || '').trim();
      const model = String(body.model || '').trim() || undefined;
      if (!sessionId) return json(res, 400, { error: 'session_id is required' });
      if (!content) return json(res, 400, { error: 'content is required' });
      const session = getChatSession(sessionId);
      if (!session) return json(res, 404, { error: 'session not found' });

      addChatMessage({ id: randomUUID(), sessionId, role: 'user', content });
      const history = listChatMessages(sessionId, 100).map((m) => ({ role: m.role, content: m.content }));
      const messages = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...history,
      ];
      const assistantContent = await chatCompletion({ messages, model });
      const assistantMsg = addChatMessage({
        id: randomUUID(),
        sessionId,
        role: 'assistant',
        content: assistantContent,
      });
      return json(res, 200, { session_id: sessionId, message: assistantMsg });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (
    req.method === 'POST'
    && /^\/v1\/chat\/sessions\/[^/]+\/messages\/stream$/.test(url.pathname)
  ) {
    try {
      const sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
      const body = await readBody(req);
      const content = String(body.content || '').trim();
      const systemPrompt = String(body.system_prompt || '').trim();
      const model = String(body.model || '').trim() || undefined;
      if (!sessionId) return json(res, 400, { error: 'session_id is required' });
      if (!content) return json(res, 400, { error: 'content is required' });
      const session = getChatSession(sessionId);
      if (!session) return json(res, 404, { error: 'session not found' });

      addChatMessage({ id: randomUUID(), sessionId, role: 'user', content });
      const history = listChatMessages(sessionId, 100).map((m) => ({ role: m.role, content: m.content }));
      const messages = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...history,
      ];

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        ...corsHeaders,
      });

      writeSse(res, 'meta', {
        session_id: sessionId,
        model: model || OPENAI_MODEL,
        mock: !hasRealLLM(),
      });

      let full = '';
      for await (const delta of streamCompletion({ messages, model })) {
        full += delta;
        writeSse(res, 'token', { delta });
      }

      const assistantMsg = addChatMessage({
        id: randomUUID(),
        sessionId,
        role: 'assistant',
        content: full,
      });
      writeSse(res, 'done', { message_id: assistantMsg.id, content: full });
      res.end();
      return;
    } catch (e) {
      if (!res.headersSent) {
        return json(res, 400, { error: e.message || 'bad request' });
      }
      writeSse(res, 'error', { error: e.message || 'stream failed' });
      res.end();
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/users/upsert') {
    try {
      const body = await readBody(req);
      const id = String(body.id || '').trim();
      const name = String(body.name || '').trim();
      const resume_summary = String(body.resume_summary || '').trim();
      if (!id) return json(res, 400, { error: 'id is required' });

      const result = upsertUser({ id, name, resume_summary });
      return json(res, 200, {
        user_id: id,
        created: result.created,
        updated_at: result.updated_at,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/retrieval/query-plan') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      const question = String(body.question || '').trim();
      if (!question) return json(res, 400, { error: 'question is required' });
      const user = userId ? getUserById(userId) : null;
      const plan = buildQueryPlan({
        question,
        resumeSummary: user?.resume_summary || '',
      });
      return json(res, 200, plan);
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }


  if (req.method === 'POST' && url.pathname === '/v1/retrieval/search') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      const question = String(body.question || '').trim();
      const limit = Number(body.limit || 20);
      const strategy = String(body.strategy || 'auto').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      if (!question) return json(res, 400, { error: 'question is required' });

      const user = getUserById(userId);
      const result = await retrieveEvidence({
        userId,
        question,
        resumeSummary: user?.resume_summary || '',
        limit: Number.isNaN(limit) ? 20 : limit,
        strategy,
        enableWebFallback: process.env.ENABLE_WEBSEARCH === '1',
      });

      return json(res, 200, {
        strategy: result.strategy,
        query_plan: result.plan,
        local_hits: result.local.items,
        evidence_refs: result.evidence_refs,
        need_fallback: result.need_fallback,
        sirchmunk: result.sirchmunk,
        web_fallback: result.web_fallback,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }


  if (req.method === 'POST' && url.pathname === '/v1/retrieval/local-search') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      const keywords = Array.isArray(body.keywords) ? body.keywords : [];
      const limit = Number(body.limit || 20);
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      if (keywords.length === 0) return json(res, 400, { error: 'keywords is required' });

      const rows = localSearch({
        userId,
        keywords,
        limit: Number.isNaN(limit) ? 20 : limit,
      });
      return json(res, 200, { user_id: userId, items: rows });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/resume/parse') {
    try {
      const isMultipart = String(req.headers['content-type'] || '').includes('multipart/form-data');
      let userId = '';
      let resumeText = '';
      let filename = '';
      let name = '';

      if (isMultipart) {
        const { fields, files } = await readMultipartForm(req);
        userId = pickFormValue(fields.user_id);
        resumeText = pickFormValue(fields.resume_text);
        filename = pickFormValue(fields.filename);
        name = pickFormValue(fields.name);

        const rawFile = Array.isArray(files.resume_file) ? files.resume_file[0] : files.resume_file;
        if (!resumeText && rawFile) {
          filename = filename || rawFile.originalFilename || rawFile.newFilename || 'resume';
          const ext = path.extname(String(filename || '')).toLowerCase();
          if (ext === '.pdf' || ext === '.docx') {
            resumeText = await extractResumeTextFromBinary({
              filename,
              buffer: fs.readFileSync(rawFile.filepath),
            });
          } else {
            resumeText = fs.readFileSync(rawFile.filepath, 'utf8').trim();
          }
        }
      } else {
        const body = await readBody(req);
        userId = String(body.user_id || '').trim();
        resumeText = String(body.resume_text || '').trim();
        filename = String(body.filename || '').trim();
        name = String(body.name || '').trim();
        const fileBase64 = String(body.file_base64 || '').trim();
        if (!resumeText && fileBase64) {
          resumeText = await extractResumeTextFromBinary({ filename, fileBase64 });
        }
      }

      if (!userId) return json(res, 400, { error: 'user_id is required' });
      if (!resumeText) return json(res, 400, { error: 'resume_text is required' });

      const summary = await summarizeResumeWithLLM(resumeText, summarizeResume(resumeText));
      const savedPath = saveResumeDoc({ userId, resumeText, filename });
      upsertUser({ id: userId, name, resume_summary: summary, active_resume_file: path.basename(savedPath) });

      return json(res, 200, {
        user_id: userId,
        resume_summary: summary,
        saved_path: savedPath,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/v1/resume/library') {
    try {
      const userId = String(url.searchParams.get('user_id') || '').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      const user = getUserById(userId);
      const files = listResumeDocs(userId);
      return json(res, 200, {
        user_id: userId,
        profile: user ? {
          id: user.id,
          name: user.name,
          resume_summary: user.resume_summary,
          active_resume_file: user.active_resume_file,
          active_jd_file: user.active_jd_file,
          updated_at: user.updated_at,
        } : null,
        files,
        has_resume: Boolean(user?.resume_summary || files.length > 0),
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/resume/select') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      const fileName = String(body.file_name || '').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      if (!fileName) return json(res, 400, { error: 'file_name is required' });

      const user = getUserById(userId);
      if (!user) return json(res, 404, { error: 'user not found' });

      const doc = readResumeDoc({ userId, fileName });
      if (!doc) return json(res, 404, { error: 'resume file not found' });

      const summary = await summarizeResumeWithLLM(doc.content, summarizeResume(doc.content));
      const updated = setActiveResumeFile({
        userId,
        fileName: doc.name,
        resumeSummary: summary,
      });

      return json(res, 200, {
        user_id: userId,
        active_resume_file: updated?.active_resume_file || doc.name,
        resume_summary: updated?.resume_summary || summary,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/jd/upload') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      const jdText = String(body.jd_text || body.job_description || '').trim();
      const filename = String(body.filename || '').trim() || 'jd.md';
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      if (!jdText) return json(res, 400, { error: 'jd_text is required' });

      const savedPath = saveJdDoc({ userId, jdText, filename });
      upsertUser({ id: userId, active_jd_file: path.basename(savedPath) });

      return json(res, 200, {
        user_id: userId,
        active_jd_file: path.basename(savedPath),
        saved_path: savedPath,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'GET' && url.pathname === '/v1/jd/library') {
    try {
      const userId = String(url.searchParams.get('user_id') || '').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      const user = getUserById(userId);
      const files = listJdDocs(userId);
      return json(res, 200, {
        user_id: userId,
        profile: user ? {
          id: user.id,
          name: user.name,
          active_jd_file: user.active_jd_file,
          updated_at: user.updated_at,
        } : null,
        files,
        has_jd: Boolean(user?.active_jd_file || files.length > 0),
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/jd/select') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      const fileName = String(body.file_name || '').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required' });
      if (!fileName) return json(res, 400, { error: 'file_name is required' });

      const user = getUserById(userId);
      if (!user) return json(res, 404, { error: 'user not found' });

      const doc = readJdDoc({ userId, fileName });
      if (!doc) return json(res, 404, { error: 'jd file not found' });

      const updated = setActiveJdFile({ userId, fileName: doc.name });

      return json(res, 200, {
        user_id: userId,
        active_jd_file: updated?.active_jd_file || doc.name,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/v1/scoring/evaluate') {
    try {
      const body = await readBody(req);
      const user_id = String(body.user_id || '').trim();
      const question = String(body.question || '').trim();
      const answer = String(body.answer || '').trim();
      const mode = String(body.mode || 'practice').trim();
      const evidence_refs = Array.isArray(body.evidence_refs) ? body.evidence_refs : [];
      if (!user_id) return json(res, 400, { error: 'user_id is required' });
      if (!question) return json(res, 400, { error: 'question is required' });
      if (!answer) return json(res, 400, { error: 'answer is required' });

      const user = getUserById(user_id);
      const questionTypeResult = await classifyQuestionType({
        question,
        answer,
        interviewContext: '',
      });
      const retrievalPlanner = await planRetrievalWithLLM({
        question,
        answer,
        questionType: questionTypeResult.question_type,
        intent: 'answer',
        interviewContext: '',
      });
      console.log('[retrieval.planner]', {
        user_id,
        question_type: questionTypeResult.question_type,
        planner: retrievalPlanner,
      });
      const evidenceBundle = await buildEvidenceBundle({
        userId: user_id,
        question,
        answer,
        user,
        questionType: questionTypeResult.question_type,
        retrievalPlanner,
      });
      const rawEvidenceRefs = evidence_refs.length > 0 ? evidence_refs : evidenceBundle.evidenceRefs;
      const focusTerms = [
        ...(evidenceBundle.queryPlan?.keyword_groups?.entity_terms || []),
        ...(evidenceBundle.queryPlan?.keyword_groups?.intent_terms || []),
        ...(evidenceBundle.queryPlan?.keyword_groups?.evidence_terms || []),
      ];
      const activeJd = user?.active_jd_file
        ? readJdDoc({ userId: user_id, fileName: user.active_jd_file })
        : null;
      const { score, dimension_scores, strengths, weaknesses, feedback, standard_answer } = await enhanceEvaluationWithLLM({
        question,
        answer,
        evidenceRefs: rawEvidenceRefs,
        interviewContext: '',
        focusTerms,
        resumeSummary: user?.resume_summary || '',
        jobDescription: activeJd?.content || '',
        questionType: questionTypeResult.question_type,
        retrievalPlan: evidenceBundle.retrievalPlan,
      });
      const evaluation_text = await generateEvaluationNarration({
        question,
        answer,
        score,
        dimensionScores: dimension_scores,
        strengths,
        weaknesses,
        feedback,
        standardAnswer: standard_answer,
        interviewContext: '',
      });

      const attemptId = randomUUID();
      const scoreReportId = randomUUID();
      const normalizedEvidenceRefs = rawEvidenceRefs.map((e) => ({
        id: randomUUID(),
        source_type: String(e.source_type || 'local_doc'),
        source_uri: String(e.source_uri || ''),
        quote: String(e.quote || ''),
        confidence: typeof e.confidence === 'number' ? e.confidence : null,
      }));
      const weaknessRows = weaknesses.map((tag) => ({ id: randomUUID(), tag }));

      saveScoringResult({
        attemptId,
        scoreReportId,
        userId: user_id,
        mode,
        question,
        answer,
        evidenceRefs: normalizedEvidenceRefs,
        score,
        strengths,
        weaknesses,
        feedback,
        weaknessRows,
      });
      const memoryPath = appendMemoryEntry({
        userId: user_id,
        question,
        answer,
        score,
        strengths,
        weaknesses,
        evidenceCount: normalizedEvidenceRefs.length,
      });

      return json(res, 200, {
        attempt_id: attemptId,
        retrieval_strategy: evidenceBundle.strategy,
        resolved_question_type: questionTypeResult.question_type,
        question_type_reason: questionTypeResult.reason,
        retrieval_planner: retrievalPlanner,
        score,
        dimension_scores,
        strengths,
        weaknesses,
        feedback,
        standard_answer,
        evaluation_text,
        evidence_refs_count: normalizedEvidenceRefs.length,
        evidence_refs: normalizedEvidenceRefs.map(({ id, ...rest }) => rest),
        query_plan: evidenceBundle.queryPlan,
        local_hits: evidenceBundle.localHits,
        sirchmunk: evidenceBundle.sirchmunk,
        web_fallback: evidenceBundle.webFallback,
        memory_path: memoryPath,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }


  if (req.method === 'POST' && url.pathname === '/v1/interview/sessions/start') {
    try {
      const body = await readBody(req);
      const userId = String(body.user_id || '').trim();
      let jobDescription = String(body.job_description || body.jd_text || '').trim();
      const targetLevel = String(body.target_level || 'mid').trim();
      if (!userId) return json(res, 400, { error: 'user_id is required' });

      const user = getUserById(userId);
      if (!user) return json(res, 404, { error: 'user not found' });
      if (!jobDescription && user.active_jd_file) {
        const activeJdDoc = readJdDoc({ userId, fileName: user.active_jd_file });
        jobDescription = String(activeJdDoc?.content || '').trim();
      }
      if (!jobDescription) return json(res, 400, { error: 'job_description is required' });

      const sessionId = randomUUID();
      const session = createInterviewSession({ id: sessionId, userId });
      const queueItems = await generateInterviewQuestionQueue({
        user,
        jobDescription,
        targetLevel,
      });
      saveInterviewQuestions({ sessionId, items: queueItems });
      const currentQuestion = getNextInterviewQuestion(sessionId);
      return json(res, 200, {
        ...session,
        interview_mode: 'resume_jd',
        job_description_present: true,
        target_level: targetLevel,
        queue_count: queueItems.length,
        current_question: currentQuestion ? {
          id: currentQuestion.id,
          order_no: currentQuestion.order_no,
          stem: currentQuestion.stem,
          source: currentQuestion.source,
          question_type: currentQuestion.question_type,
          difficulty: currentQuestion.difficulty,
          status: currentQuestion.status,
        } : null,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (
    req.method === 'GET'
    && /^\/v1\/interview\/sessions\/[^/]+\/questions$/.test(url.pathname)
  ) {
    try {
      const sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
      if (!sessionId) return json(res, 400, { error: 'session_id is required' });
      const session = getInterviewSession(sessionId);
      if (!session) return json(res, 404, { error: 'session not found' });
      const items = listInterviewQuestions(sessionId);
      const currentQuestion = items.find((item) => item.status !== 'answered') || null;
      return json(res, 200, {
        session_id: sessionId,
        items,
        current_question: currentQuestion,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }


  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/turns\/stream$/.test(url.pathname)
  ) {
    let sessionId = '';
    let closed = false;
    try {
      sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
      const body = await readBody(req);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...corsHeaders,
      });
      res.flushHeaders?.();

      req.on('aborted', () => {
        if (closed) return;
        closed = true;
        console.warn('[interview.turn.stream.aborted]', {
          session_id: sessionId,
        });
      });
      res.on('close', () => {
        if (closed) return;
        closed = true;
        console.warn('[interview.turn.stream.closed]', {
          session_id: sessionId,
        });
      });

      console.log('[interview.turn.stream.start]', {
        session_id: sessionId,
        question_id: String(body.question_id || '').trim() || null,
      });
      writeSse(res, 'meta', { session_id: sessionId, mode: 'interview_turn_stream' });
      await flushSseFrame();
      const writeStage = async (step, message) => {
        if (closed) return;
        console.log('[interview.turn.stream.stage]', {
          session_id: sessionId,
          step,
          message,
        });
        writeSse(res, 'stage', { step, message });
        await flushSseFrame();
      };
      const writeToken = async (textChunk) => {
        if (closed || !textChunk) return;
        console.log('[interview.turn.stream.token]', {
          session_id: sessionId,
          length: String(textChunk).length,
          preview: String(textChunk).slice(0, 40),
        });
        writeSse(res, 'token', {
          textChunk,
          timestamp: new Date().toISOString(),
        });
        await flushSseFrame();
      };

      await writeStage('saving', '已接收回答，正在准备评分...');
      const result = await submitInterviewTurn({
        sessionId,
        body,
        onPhase: writeStage,
        onToken: writeToken,
      });
      console.log('[interview.turn.stream.result]', {
        session_id: sessionId,
        turn_id: result.turn_id,
        score: result.score,
        evidence_refs_count: result.evidence_refs_count,
        next_question_id: result.next_question?.id || null,
      });
      if (closed) {
        return;
      }
      writeSse(res, 'result', result);
      await flushSseFrame();
      writeSse(res, 'done', {
        turn_id: result.turn_id,
        next_question_id: result.next_question?.id || null,
      });
      closed = true;
      res.end();
      return;
    } catch (e) {
      if (!res.headersSent) {
        return json(res, e.statusCode || 400, { error: e.message || 'bad request' });
      }
      closed = true;
      console.error('[interview.turn.stream.error]', {
        session_id: sessionId,
        error: e.message || 'stream failed',
      });
      writeSse(res, 'error', { error: e.message || 'stream failed' });
      res.end();
      return;
    }
  }

  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/turns$/.test(url.pathname)
  ) {
    try {
      const sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
      const body = await readBody(req);
      const result = await submitInterviewTurn({ sessionId, body });
      return json(res, 200, result);
    } catch (e) {
      return json(res, e.statusCode || 400, { error: e.message || 'bad request' });
    }
  }


  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/finish$/.test(url.pathname)
  ) {
    try {
      const sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
      const body = await readBody(req);
      const summary = String(body.summary || '').trim();
      if (!sessionId) return json(res, 400, { error: 'session_id is required' });
      const session = getInterviewSession(sessionId);
      if (!session) return json(res, 404, { error: 'session not found' });
      const done = finishInterviewSession({ sessionId, summary });
      return json(res, 200, done);
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/retrospect$/.test(url.pathname)
  ) {
    try {
      const sessionId = decodeURIComponent(url.pathname.split('/')[4] || '').trim();
      const body = await readBody(req);
      const chapter = String(body.chapter || '面试复盘').trim();
      const session = getInterviewSession(sessionId);
      if (!session) return json(res, 404, { error: 'session not found' });
      const turns = listInterviewTurns(sessionId);
      if (turns.length === 0) return json(res, 400, { error: 'no interview turns found' });
      const questionItems = listInterviewQuestions(sessionId);
      const questionMap = new Map(
        questionItems.map((item) => [item.id, item]),
      );

      const avgScore = Math.round(turns.reduce((s, t) => s + (t.score || 0), 0) / turns.length);
      const strengthMap = new Map();
      const weaknessMap = new Map();
      for (const t of turns) {
        for (const s of t.strengths || []) strengthMap.set(s, (strengthMap.get(s) || 0) + 1);
        for (const w of t.weaknesses || []) weaknessMap.set(w, (weaknessMap.get(w) || 0) + 1);
      }
      const strengths = Array.from(strengthMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
        .slice(0, 5);
      const weaknesses = Array.from(weaknessMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k)
        .slice(0, 5);

      const today = new Date();
      const in3d = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const qbItems = turns.map((t) => {
        const sourceQuestion = t.question_id ? questionMap.get(t.question_id) : null;
        return {
          id: randomUUID(),
          user_id: session.user_id,
          source_session_id: sessionId,
          source_turn_id: t.id,
          source_question_id: sourceQuestion?.id || null,
          source_question_type: sourceQuestion?.question_type || '',
          source_question_source: sourceQuestion?.source || '',
          chapter,
          question: t.question,
          difficulty: sourceQuestion?.difficulty || (t.score >= 75 ? 'medium' : 'easy'),
          tags: [
            '面试复盘',
            ...(sourceQuestion?.question_type ? [sourceQuestion.question_type] : []),
            ...(sourceQuestion?.source ? [sourceQuestion.source] : []),
            ...(t.weaknesses || []).slice(0, 2),
          ],
          weakness_tag: (t.weaknesses || [])[0] || '',
          next_review_at: in3d,
          review_status: 'pending',
        };
      });
      const promoteStat = saveQuestionBankItems({ items: qbItems });
      const user = getUserById(session.user_id);
      const memorySummary = await summarizeLongTermMemory({
        resumeSummary: user?.resume_summary || '',
        strengths,
        weaknesses,
        turns,
        questionItems,
      });

      const memoryPath = appendMemoryEntry({
        userId: session.user_id,
        question: `session:${sessionId} retrospect`,
        answer: JSON.stringify({
          avg_score: avgScore,
          turns_count: turns.length,
          long_term_memory: memorySummary,
        }),
        score: avgScore,
        strengths,
        weaknesses,
        evidenceCount: turns.reduce((s, t) => s + (t.evidence_refs_count || 0), 0),
      });

      return json(res, 200, {
        session_id: sessionId,
        user_id: session.user_id,
        chapter,
        avg_score: avgScore,
        turns_count: turns.length,
        strengths,
        weaknesses,
        long_term_memory: memorySummary,
        promoted_questions: qbItems.length,
        promoted_new_questions: promoteStat.inserted,
        promoted_updated_questions: promoteStat.updated,
        memory_path: memoryPath,
      });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }


  if (req.method === 'GET' && url.pathname.startsWith('/v1/users/') && url.pathname.endsWith('/weaknesses')) {
    const userId = decodeURIComponent(url.pathname.split('/')[3] || '').trim();
    if (!userId) return json(res, 400, { error: 'user_id is required' });
    const limit = Number(url.searchParams.get('limit') || 20);
    const rows = getWeaknessesByUser(userId, Number.isNaN(limit) ? 20 : limit);
    return json(res, 200, { user_id: userId, items: rows });
  }

  if (req.method === 'GET' && url.pathname === '/v1/attempts') {
    const userId = String(url.searchParams.get('user_id') || '').trim();
    if (!userId) return json(res, 400, { error: 'user_id is required' });
    const limit = Number(url.searchParams.get('limit') || 20);
    const rows = listAttemptsByUser(userId, Number.isNaN(limit) ? 20 : limit);
    return json(res, 200, { user_id: userId, items: rows });
  }

  if (req.method === 'GET' && url.pathname === '/v1/question-bank') {
    const userId = String(url.searchParams.get('user_id') || '').trim();
    const chapter = String(url.searchParams.get('chapter') || '').trim();
    if (!userId) return json(res, 400, { error: 'user_id is required' });
    const limit = Number(url.searchParams.get('limit') || 20);
    const rows = listQuestionBank({
      userId,
      chapter: chapter || undefined,
      limit: Number.isNaN(limit) ? 20 : limit,
    });
    return json(res, 200, { user_id: userId, chapter: chapter || null, items: rows });
  }

  if (req.method === 'GET' && url.pathname === '/v1/practice/next') {
    const userId = String(url.searchParams.get('user_id') || '').trim();
    const chapter = String(url.searchParams.get('chapter') || '').trim();
    const includeFuture = String(url.searchParams.get('include_future') || '0') === '1';
    if (!userId) return json(res, 400, { error: 'user_id is required' });
    const limit = Number(url.searchParams.get('limit') || 10);
    const rows = listPracticeQuestions({
      userId,
      chapter: chapter || undefined,
      limit: Number.isNaN(limit) ? 10 : limit,
      includeFuture,
    });
    return json(res, 200, {
      user_id: userId,
      chapter: chapter || null,
      include_future: includeFuture,
      items: rows,
    });
  }

  if (
    req.method === 'POST'
    && /^\/v1\/question-bank\/[^/]+\/review$/.test(url.pathname)
  ) {
    try {
      const questionId = decodeURIComponent(url.pathname.split('/')[3] || '').trim();
      const body = await readBody(req);
      const reviewStatus = String(body.review_status || 'done').trim();
      const nextReviewAt = String(body.next_review_at || '').trim();
      if (!questionId) return json(res, 400, { error: 'question_id is required' });
      if (!['pending', 'done'].includes(reviewStatus)) {
        return json(res, 400, { error: 'review_status must be pending or done' });
      }
      const ok = markQuestionReviewed({
        questionId,
        reviewStatus,
        nextReviewAt: nextReviewAt || null,
      });
      if (!ok) return json(res, 404, { error: 'question not found' });
      return json(res, 200, { id: questionId, review_status: reviewStatus, next_review_at: nextReviewAt || null });
    } catch (e) {
      return json(res, 400, { error: e.message || 'bad request' });
    }
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[fementor-api] listening on :${PORT}`);
});
