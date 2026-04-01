const { createHash, randomUUID } = require('crypto');
const { hasRealLLM, jsonCompletion } = require('../llm');

const PIPELINE_MAX_RETRIES = 2;
const PIPELINE_RETRY_DELAY_MS = 500;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const jsonCompletionWithRetry = async (prompt, label = 'step') => {
  let lastError;
  for (let attempt = 0; attempt <= PIPELINE_MAX_RETRIES; attempt += 1) {
    try {
      return await jsonCompletion(prompt);
    } catch (error) {
      lastError = error;
      if (attempt < PIPELINE_MAX_RETRIES) {
        console.warn(`[pipeline.${label}.retry]`, { attempt: attempt + 1, error: error.message });
        await sleep(PIPELINE_RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }
  throw lastError;
};

const normalizeWhitespace = (value) =>
  String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const QUESTION_SECTION_PATTERNS = [
  /^项目$/,
  /^八股$/,
  /^算法$/,
  /^开放题$/,
  /^反问$/,
  /^面试问题[:：]?$/,
  /^问题[:：]?$/,
  /^[^A-Za-z0-9\u4e00-\u9fa5]*面试问题[:：]?$/,
];

const METADATA_LINE_PATTERNS = [
  /^#.*#$/,
  /^📍面试公司[:：]/,
  /^🕐面试时间[:：]/,
  /^💻面试岗位[:：]/,
  /^🙌面试感想[:：]?$/,
  /^牛客网在线编程$/,
  /^牛客企业服务$/,
  /^面试公司[:：]/,
  /^面试时间[:：]/,
  /^面试岗位[:：]/,
  /^岗位[:：]/,
  /^公司[:：]/,
  /^内推码/i,
];

const CODE_LIKE_LINE_PATTERN = /[{}();=>]/;
const INTERVIEW_HINT_PATTERN = /什么|如何|为什么|怎么|哪些|区别|原理|流程|方式|实现|介绍|讲一下|讲讲|说一下|是否|有没有|能不能|了解|设计|优化|列举|解释|阐述|输出|作用|优势|步骤|策略|方案|思路|贡献|多吗|吗|么/;
const NON_QUESTION_LINE_PATTERN = /准备了|感觉|觉得|感受|聊得|聊的|挂了|挂掉|凉了|寄了|心态|难受|好难|难找|找不到|满意的实习|上午面完|下午面完|晚上|没怎么考察|一直问我|面试体验|流程很快|许愿|求捞|祝大家|已oc|offer|通过了|没过|淘汰/i;

const stripListMarker = (line) => String(line || '').replace(/^[\s\-*•\d.、()（）]+/, '').trim();

const isMetadataLine = (line) => METADATA_LINE_PATTERNS.some((pattern) => pattern.test(line));

const isCodeLikeLine = (line) => CODE_LIKE_LINE_PATTERN.test(line) && !/[\u4e00-\u9fa5]/.test(line);

const isLikelyAnswerLine = (line) => {
  if (isCodeLikeLine(line)) {
    return true;
  }

  if (/^[A-Za-z][A-Za-z\s/]+[:：]/.test(line)) {
    return true;
  }

  if (/^[\u4e00-\u9fa5A-Za-z0-9]+[:：]/.test(line) && !INTERVIEW_HINT_PATTERN.test(line)) {
    return true;
  }

  return false;
};

const hasQuestionSignal = (line) => INTERVIEW_HINT_PATTERN.test(line) || /[?？]$/.test(line);

const isValidQuestionText = (line) => {
  const normalizedLine = stripListMarker(normalizeWhitespace(line));
  if (normalizedLine.length < 6) {
    return false;
  }

  if (isMetadataLine(normalizedLine) || isLikelyAnswerLine(normalizedLine)) {
    return false;
  }

  if (NON_QUESTION_LINE_PATTERN.test(normalizedLine) && !/[?？]$/.test(normalizedLine)) {
    return false;
  }

  return hasQuestionSignal(normalizedLine);
};

const normalizeContentForCleaning = (content) =>
  normalizeWhitespace(content)
    .replace(/#牛客AI配图神器#/g, '')
    .replace(/内推码?.*$/gm, '')
    .replace(/牛客网在线编程/g, '')
    .replace(/牛客企业服务/g, '')
    .trim();

const extractQuestionLines = (content) => {
  const normalizedContent = normalizeContentForCleaning(content);
  const lines = normalizedContent
    .split('\n')
    .map((line) => stripListMarker(line))
    .filter(Boolean);

  const questionLines = [];
  let skipRemaining = false;

  for (const line of lines) {
    if (/^面试感想[:：]?/.test(line)) {
      skipRemaining = true;
      continue;
    }

    if (skipRemaining || isMetadataLine(line) || QUESTION_SECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      continue;
    }

    if (!isValidQuestionText(line)) {
      continue;
    }

    questionLines.push(line);
  }

  return questionLines;
};

const splitCandidateQuestions = (content) => extractQuestionLines(content).slice(0, 20);

const inferCategory = (question) => {
  const text = String(question || '').toLowerCase();
  if (/react/.test(text)) return 'React';
  if (/vue/.test(text)) return 'Vue';
  if (/css|flex|布局/.test(text)) return 'CSS';
  if (/浏览器|缓存|http|cookie|storage|跨域/.test(text)) return '浏览器';
  if (/webpack|vite|工程化|构建/.test(text)) return '工程化';
  if (/项目|实习|场景/.test(text)) return '项目';
  if (/promise|async|await|js|javascript|闭包|原型|this|作用域|遍历|对象/.test(text)) return 'JavaScript';
  if (/算法|排序|链表|二叉树|树|动态规划|dp|贪心|回溯/.test(text)) return '算法';
  return '其他';
};

const EXPERIENCE_ANCHOR_SIGNALS = /你[们的]|你这个|你当时|你负责|你做的|你们团队|你项目|贵司|你公司/;

const inferItemChainAnchor = (questionTextRaw) =>
  EXPERIENCE_ANCHOR_SIGNALS.test(String(questionTextRaw || ''))
    ? 'experience_anchored'
    : 'generic';

const buildTopicClusterByCategory = (category) => {
  switch (category) {
    case 'Vue':
      return 'Vue 核心问题';
    case 'React':
      return 'React 核心问题';
    case 'JavaScript':
      return 'JavaScript 基础问题';
    case 'CSS':
      return 'CSS 与布局问题';
    case '浏览器':
      return '浏览器与网络问题';
    case '工程化':
      return '工程化问题';
    case '项目':
      return '项目与场景问题';
    case '算法':
      return '算法与数据结构问题';
    case '行为面':
      return '行为面问题';
    default:
      return '未分类主题';
  }
};

const buildRuleHints = (contentRaw) => {
  const candidateQuestions = splitCandidateQuestions(contentRaw).slice(0, 12);
  const categories = new Set();
  const topicClusters = new Set();
  const questionHints = candidateQuestions.map((question) => {
    const suggestedCategory = inferCategory(question);
    categories.add(suggestedCategory);
    topicClusters.add(buildTopicClusterByCategory(suggestedCategory));
    return {
      question,
      suggested_category: suggestedCategory,
      suggested_topic_cluster: buildTopicClusterByCategory(suggestedCategory),
    };
  });

  return {
    candidate_categories: Array.from(categories),
    candidate_topic_clusters: Array.from(topicClusters),
    question_hints: questionHints,
  };
};

const normalizeQuestionItem = (item, fallbackQuestion = '') => {
  const rawQuestion = normalizeWhitespace(item.question_text_raw || fallbackQuestion);
  const normalizedQuestion = normalizeWhitespace(item.question_text_normalized || rawQuestion);
  const effectiveQuestion = normalizedQuestion || rawQuestion;

  if (effectiveQuestion.length < 4) {
    return null;
  }

  const currentCategory = String(item.category || '').trim();

  return {
    question_text_raw: rawQuestion,
    question_text_normalized: normalizedQuestion,
    question_role: String(item.question_role || 'follow_up').trim() || 'follow_up',
    parent_ref: Number.isInteger(item.parent_ref) ? item.parent_ref : null,
    category: currentCategory || inferCategory(normalizedQuestion || rawQuestion),
    difficulty: String(item.difficulty || 'medium').trim() || 'medium',
    follow_up_intent: String(item.follow_up_intent || 'clarify').trim() || 'clarify',
    chain_anchor: String(item.chain_anchor || '').trim() || inferItemChainAnchor(rawQuestion),
    knowledge_points: Array.isArray(item.knowledge_points) ? item.knowledge_points : [],
    expected_points: Array.isArray(item.expected_points) ? item.expected_points : [],
  };
};

const normalizeQuestionGroupItems = (items = []) => {
  const normalizedItems = items
    .map((item) => normalizeQuestionItem(item))
    .filter((item) => item.question_text_raw || item.question_text_normalized);

  if (normalizedItems.length === 0) {
    return [];
  }

  const hasMainQuestion = normalizedItems.some((item) => item.question_role === 'main');

  return normalizedItems.map((item, index) => ({
    ...item,
    question_role: !hasMainQuestion && index === 0
      ? 'main'
      : (index === 0 && item.question_role === 'follow_up' ? 'main' : item.question_role),
    parent_ref: index === 0 ? null : (Number.isInteger(item.parent_ref) ? item.parent_ref : 0),
  }));
};

const normalizeTopicGroups = (topicGroups = [], fallbackTitle = '') => {
  const normalizedGroups = [];

  for (const group of Array.isArray(topicGroups) ? topicGroups : []) {
    const normalizedItems = normalizeQuestionGroupItems(Array.isArray(group.items) ? group.items : []);
    if (normalizedItems.length === 0) {
      continue;
    }

    const primaryCategory = normalizedItems[0]?.category || '其他';
    const topicCluster = normalizeWhitespace(group.topic_cluster || '');
    const canonicalQuestion = normalizeWhitespace(group.canonical_question || '');

    normalizedGroups.push({
      topic_cluster: topicCluster || buildTopicClusterByCategory(primaryCategory),
      canonical_question: canonicalQuestion
        || normalizedItems[0]?.question_text_normalized
        || normalizedItems[0]?.question_text_raw
        || fallbackTitle
        || buildTopicClusterByCategory(primaryCategory),
      group_type: String(group.group_type || (normalizedItems.length > 1 ? 'chain' : 'single')).trim() || 'single',
      confidence: Number(group.confidence || 0),
      items: normalizedItems,
    });
  }

  return normalizedGroups;
};

const fallbackCleanExperience = ({ title, contentRaw }) => {
  const candidateQuestions = splitCandidateQuestions(contentRaw);
  const cleanedContent = normalizeContentForCleaning(contentRaw);

  const items = candidateQuestions.slice(0, 8).map((question, index) => ({
    question_text_raw: question,
    question_text_normalized: question,
    question_role: index === 0 ? 'main' : 'follow_up',
    parent_ref: index === 0 ? null : 0,
    category: inferCategory(question),
    difficulty: 'medium',
    follow_up_intent: index === 0 ? 'clarify' : 'deepen',
    chain_anchor: inferItemChainAnchor(question),
    knowledge_points: [],
    expected_points: [],
  }));

  const groupedItems = [];

  for (const item of items) {
    const topicCluster = buildTopicClusterByCategory(item.category);
    const currentGroup = groupedItems[groupedItems.length - 1];

    if (!currentGroup || currentGroup.topic_cluster !== topicCluster) {
      groupedItems.push({
        topic_cluster: topicCluster,
        canonical_question: item.question_text_normalized || title || '面经问题',
        group_type: 'single',
        confidence: 0.35,
        items: [{
          ...item,
          question_role: 'main',
          parent_ref: null,
          follow_up_intent: 'clarify',
        }],
      });
      continue;
    }

    currentGroup.group_type = 'mixed';
    currentGroup.items.push({
      ...item,
      question_role: 'follow_up',
      parent_ref: 0,
      follow_up_intent: 'deepen',
    });
  }

  const topicGroups = normalizeTopicGroups(groupedItems, title || '面经问题');
  const hasValidQuestions = topicGroups.some((group) => group.items.length > 0);

  return {
    company_name: '',
    role_name: '',
    interview_stage: '未知',
    experience_summary: title || cleanedContent.slice(0, 120),
    topic_groups: topicGroups,
    cleaned_content: cleanedContent,
    is_valid: hasValidQuestions && cleanedContent.length >= 60,
  };
};

// ── Pipeline Step 1: Metadata + Question extraction (merged) ──

const buildExtractionPrompt = ({ title, contentRaw }) => ({
  messages: [
    {
      role: 'system',
      content: [
        '从面经原文中提取元数据和所有面试问题。只输出 JSON，不要解释。',
        '输出：{“is_valid”:true,”company_name”:””,”role_name”:””,”interview_stage”:”一面|二面|HR面|实习|校招|社招|未知”,”experience_summary”:””,”questions”:[{“raw”:””,”normalized”:””,”difficulty”:”easy|medium|hard”,”category”:”JavaScript|React|Vue|CSS|浏览器|网络|工程化|项目|算法|行为面|其他”}]}',
        'is_valid 默认 true，只有完全无面试问题（纯广告/内推/感想）才为 false，此时 questions 留空数组。',
        'normalized 规则：去除口头过渡词（”可以，””好的，””嗯，”等）；含”你/你们/你项目”等指代词时改写为通用形式。',
        '只有题目类型标签（如”代码输出题”）而没有具体内容的，跳过不提取。',
        '不要把公司、岗位、时间、感想、广告、答案当作问题。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `标题：字节前端一面\n\n自我介绍\n说一下闭包\n闭包会导致内存泄漏吗\n怎么排查内存泄漏\nCSS 水平垂直居中有哪些方案\n你们项目里为什么选 Redis Cluster\n手写防抖\n代码输出题\n#内推码# abc123\n写面经攒人品`,
    },
    {
      role: 'assistant',
      content: JSON.stringify({
        is_valid: true,
        company_name: '字节',
        role_name: '前端',
        interview_stage: '一面',
        experience_summary: '字节前端一面，涉及闭包、内存泄漏排查、CSS 布局、项目技术选型和手写防抖。',
        questions: [
          { raw: '自我介绍', normalized: '自我介绍', difficulty: 'easy', category: '行为面' },
          { raw: '说一下闭包', normalized: '讲讲闭包的概念和应用场景', difficulty: 'medium', category: 'JavaScript' },
          { raw: '闭包会导致内存泄漏吗', normalized: '闭包会导致内存泄漏吗？', difficulty: 'medium', category: 'JavaScript' },
          { raw: '怎么排查内存泄漏', normalized: '怎么排查内存泄漏？', difficulty: 'hard', category: 'JavaScript' },
          { raw: 'CSS 水平垂直居中有哪些方案', normalized: 'CSS 水平垂直居中有哪些方案？', difficulty: 'easy', category: 'CSS' },
          { raw: '你们项目里为什么选 Redis Cluster', normalized: '什么场景下应该选 Redis Cluster 而不是单机 Redis？', difficulty: 'medium', category: '项目' },
          { raw: '手写防抖', normalized: '手写防抖', difficulty: 'medium', category: 'JavaScript' },
        ],
      }),
    },
    {
      role: 'user',
      content: `标题：${title || ''}\n\n${String(contentRaw || '').slice(0, 12000)}`,
    },
  ],
});

// ── Pipeline Step 3: Grouping ──

const buildGroupingPrompt = ({ questions }) => ({
  messages: [
    {
      role: 'system',
      content: [
        '将面试问题按主题分组。只输出 JSON，不要解释。',
        '输出：{“groups”:[{“topic_cluster”:”中文短语主题”,”canonical_question”:”代表性问题”,”group_type”:”single|chain|mixed”,”confidence”:0.0,”items”:[{“index”:0,”question_role”:”main|follow_up”,”parent_ref”:null,”follow_up_intent”:”clarify|deepen|compare|verify|scenario”,”chain_anchor”:”generic|experience_anchored”}]}]}',
        'index 引用输入 questions 数组的下标。',
        'chain：后一个问题是对前一个的逐步深入追问，话题连贯。parent_ref 指向它追问的 item 在当前 group items 中的位置。',
        'mixed：同话题下的独立问题，parent_ref 为 null。',
        'single：只有一道题。',
        '不同话题必须拆成不同 group，宁可多拆也不要混在一起。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify([
        { index: 0, question: '讲讲闭包的概念和应用场景' },
        { index: 1, question: '闭包会导致内存泄漏吗？' },
        { index: 2, question: '怎么排查内存泄漏？' },
        { index: 3, question: 'CSS 水平垂直居中有哪些方案？' },
        { index: 4, question: '手写防抖' },
      ]),
    },
    {
      role: 'assistant',
      content: JSON.stringify({ groups: [
        { topic_cluster: '闭包与内存管理', canonical_question: '讲讲闭包的概念和应用场景', group_type: 'chain', confidence: 0.95, items: [
          { index: 0, question_role: 'main', parent_ref: null, follow_up_intent: 'clarify', chain_anchor: 'generic' },
          { index: 1, question_role: 'follow_up', parent_ref: 0, follow_up_intent: 'deepen', chain_anchor: 'generic' },
          { index: 2, question_role: 'follow_up', parent_ref: 1, follow_up_intent: 'deepen', chain_anchor: 'generic' },
        ] },
        { topic_cluster: 'CSS 布局', canonical_question: 'CSS 水平垂直居中有哪些方案？', group_type: 'single', confidence: 0.99, items: [
          { index: 3, question_role: 'main', parent_ref: null, follow_up_intent: 'clarify', chain_anchor: 'generic' },
        ] },
        { topic_cluster: '手写题', canonical_question: '手写防抖', group_type: 'single', confidence: 0.99, items: [
          { index: 4, question_role: 'main', parent_ref: null, follow_up_intent: 'clarify', chain_anchor: 'generic' },
        ] },
      ] }),
    },
    {
      role: 'user',
      content: JSON.stringify(questions.map((q, i) => ({ index: i, question: q.normalized || q.raw }))),
    },
  ],
});

// ── Pipeline Step 4: Annotation ──

const buildAnnotationPrompt = ({ questions }) => ({
  messages: [
    {
      role: 'system',
      content: [
        '为每道面试问题标注知识点和评分要点。只输出 JSON，不要解释。',
        '输出：{“annotations”:[{“index”:0,”knowledge_points”:[“短词标签”],”expected_points”:[“句子粒度的评分要点”]}]}',
        'knowledge_points：该题考察的知识领域标签，短词粒度，用于检索（如 [“闭包”, “垃圾回收”]）。',
        'expected_points：候选人回答应覆盖的要点，句子粒度，用于评分（如 [“闭包的定义和形成条件”]）。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify(questions.map((q, i) => ({ index: i, question: q.normalized || q.raw, category: q.category }))),
    },
  ],
});

// ── Pipeline orchestration ──

const assemblePipelineResult = ({ metadata, questions, grouping, annotations, cleanedContent }) => {
  const annotationMap = new Map();
  for (const a of annotations) {
    annotationMap.set(a.index, a);
  }

  const topicGroups = grouping.map((group) => ({
    topic_cluster: group.topic_cluster || '',
    canonical_question: group.canonical_question || '',
    group_type: group.group_type || 'single',
    confidence: Number(group.confidence || 0),
    items: (group.items || []).map((ref) => {
      const q = questions[ref.index];
      if (!q) return null;
      const ann = annotationMap.get(ref.index) || {};
      return {
        question_text_raw: q.raw || '',
        question_text_normalized: q.normalized || q.raw || '',
        question_role: ref.question_role || 'follow_up',
        parent_ref: Number.isInteger(ref.parent_ref) ? ref.parent_ref : null,
        category: q.category || '其他',
        difficulty: q.difficulty || 'medium',
        follow_up_intent: ref.follow_up_intent || 'clarify',
        chain_anchor: ref.chain_anchor || 'generic',
        knowledge_points: Array.isArray(ann.knowledge_points) ? ann.knowledge_points : [],
        expected_points: Array.isArray(ann.expected_points) ? ann.expected_points : [],
      };
    }).filter(Boolean),
  }));

  return {
    company_name: String(metadata.company_name || '').trim(),
    role_name: String(metadata.role_name || '').trim(),
    interview_stage: String(metadata.interview_stage || '未知').trim() || '未知',
    experience_summary: normalizeWhitespace(metadata.experience_summary || ''),
    topic_groups: normalizeTopicGroups(topicGroups),
    cleaned_content: cleanedContent,
    is_valid: Boolean(metadata.is_valid),
  };
};

const cleanExperienceContent = async ({ title, sourceUrl, publishedAt, keyword, contentRaw }) => {
  if (!hasRealLLM()) {
    return fallbackCleanExperience({ title, contentRaw });
  }

  const cleanedContent = normalizeContentForCleaning(contentRaw);

  try {
    console.log('[pipeline.input]', {
      title,
      source_url: sourceUrl,
      content_length: contentRaw?.length || 0,
      content_preview: String(contentRaw || '').slice(0, 200),
    });

    // Step 1: Extract metadata + questions
    const extractionResult = await jsonCompletionWithRetry(
      buildExtractionPrompt({ title, contentRaw }), 'extraction',
    ).catch((err) => {
      console.warn('[pipeline.extraction.failed]', err.message);
      return null;
    });

    const metadata = {
      is_valid: extractionResult?.is_valid !== false,
      company_name: extractionResult?.company_name || '',
      role_name: extractionResult?.role_name || '',
      interview_stage: extractionResult?.interview_stage || '未知',
      experience_summary: extractionResult?.experience_summary || '',
    };

    if (!metadata.is_valid) {
      return {
        company_name: String(metadata.company_name).trim(),
        role_name: String(metadata.role_name).trim(),
        interview_stage: String(metadata.interview_stage).trim() || '未知',
        experience_summary: normalizeWhitespace(metadata.experience_summary),
        topic_groups: [],
        cleaned_content: cleanedContent,
        is_valid: false,
      };
    }

    // Question fallback: regex extraction
    const questions = Array.isArray(extractionResult?.questions) && extractionResult.questions.length > 0
      ? extractionResult.questions
      : splitCandidateQuestions(contentRaw).map((q) => ({
          raw: q,
          normalized: q,
          difficulty: 'medium',
          category: inferCategory(q),
        }));

    if (questions.length === 0) {
      return {
        ...metadata,
        topic_groups: [],
        cleaned_content: cleanedContent,
        is_valid: false,
      };
    }

    // Step 3 + Step 4: parallel (both depend on Step 2)
    const [groupingResult, annotationResult] = await Promise.all([
      jsonCompletionWithRetry(buildGroupingPrompt({ questions }), 'grouping').catch((err) => {
        console.warn('[pipeline.step3.failed]', err.message);
        return null;
      }),
      jsonCompletionWithRetry(buildAnnotationPrompt({ questions }), 'annotation').catch((err) => {
        console.warn('[pipeline.step4.failed]', err.message);
        return null;
      }),
    ]);

    // Step 3 fallback: each question as a single group
    const grouping = Array.isArray(groupingResult?.groups) && groupingResult.groups.length > 0
      ? groupingResult.groups
      : questions.map((q, i) => ({
          topic_cluster: buildTopicClusterByCategory(q.category || inferCategory(q.normalized || q.raw)),
          canonical_question: q.normalized || q.raw,
          group_type: 'single',
          confidence: 0.3,
          items: [{ index: i, question_role: 'main', parent_ref: null, follow_up_intent: 'clarify', chain_anchor: inferItemChainAnchor(q.raw) }],
        }));

    const annotations = Array.isArray(annotationResult?.annotations) ? annotationResult.annotations : [];

    return assemblePipelineResult({
      metadata,
      questions,
      grouping,
      annotations,
      cleanedContent,
    });
  } catch (error) {
    console.error('[experience.cleaner.pipeline.fallback]', {
      title,
      source_url: sourceUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackCleanExperience({ title, contentRaw });
  }
};

const buildPostInsertPayload = ({ jobId, keyword, article, cleaned }) => ({
  id: randomUUID(),
  source_platform: 'nowcoder',
  source_post_id: String(article.url || '').split('/').pop()?.split('?')[0] || randomUUID(),
  source_url: article.url || '',
  keyword,
  title: article.title || '',
  author_name: article.author || '',
  published_at: article.publishedAt || '',
  content_raw: article.content || '',
  content_cleaned: cleaned.cleaned_content || '',
  summary: cleaned.experience_summary || article.summary || '',
  company_name: cleaned.company_name || '',
  role_name: cleaned.role_name || '',
  interview_stage: cleaned.interview_stage || '未知',
  popularity: Number(article.popularity || 0),
  is_valid: Boolean(cleaned.is_valid),
  clean_status: 'completed',
  crawl_job_id: jobId,
  content_hash: createHash('sha1').update(String(article.content || '')).digest('hex'),
});

const buildGroupsInsertPayload = ({ postId, topicGroups = [] }) =>
  topicGroups.map((group, groupIndex) => {
    const groupId = randomUUID();
    const items = Array.isArray(group.items) ? group.items : [];
    const itemIdByIndex = new Map();

    const normalizedItems = items.map((item, itemIndex) => {
      const itemId = randomUUID();
      itemIdByIndex.set(itemIndex, itemId);
      return {
        id: itemId,
        question_text_raw: normalizeWhitespace(item.question_text_raw || ''),
        question_text_normalized: normalizeWhitespace(item.question_text_normalized || item.question_text_raw || ''),
        question_role: String(item.question_role || (itemIndex === 0 ? 'main' : 'follow_up')).trim(),
        order_in_group: itemIndex + 1,
        parent_ref: item.parent_ref,
        category: String(item.category || '其他').trim() || '其他',
        difficulty: String(item.difficulty || 'medium').trim() || 'medium',
        follow_up_intent: String(item.follow_up_intent || 'clarify').trim() || 'clarify',
        chain_anchor: String(item.chain_anchor || 'generic').trim(),
        expected_points: Array.isArray(item.expected_points) ? item.expected_points : [],
        knowledge_points: Array.isArray(item.knowledge_points) ? item.knowledge_points : [],
      };
    });

    return {
      id: groupId,
      post_id: postId,
      topic_cluster: normalizeWhitespace(group.topic_cluster || ''),
      canonical_question: normalizeWhitespace(group.canonical_question || normalizedItems[0]?.question_text_normalized || ''),
      group_order: groupIndex + 1,
      group_type: String(group.group_type || (normalizedItems.length > 1 ? 'mixed' : 'single')).trim(),
      frequency_score: 0,
      confidence: Number(group.confidence || 0),
      items: normalizedItems.map((item) => ({
        ...item,
        parent_item_id: Number.isInteger(item.parent_ref) ? itemIdByIndex.get(item.parent_ref) || null : null,
      })),
    };
  });

module.exports = {
  cleanExperienceContent,
  buildPostInsertPayload,
  buildGroupsInsertPayload,
};
