const { createHash, randomUUID } = require('crypto');
const { hasRealLLM, jsonCompletion } = require('../llm');

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

    if (line.length < 6 || isLikelyAnswerLine(line) || !hasQuestionSignal(line)) {
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
  const currentCategory = String(item.category || '').trim();

  return {
    question_text_raw: rawQuestion,
    question_text_normalized: normalizedQuestion,
    question_role: String(item.question_role || 'follow_up').trim() || 'follow_up',
    parent_ref: Number.isInteger(item.parent_ref) ? item.parent_ref : null,
    category: currentCategory || inferCategory(normalizedQuestion || rawQuestion),
    difficulty: String(item.difficulty || 'medium').trim() || 'medium',
    follow_up_intent: String(item.follow_up_intent || 'clarify').trim() || 'clarify',
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

  if (normalizedGroups.length > 0) {
    return normalizedGroups;
  }

  return fallbackTitle
    ? [{
      topic_cluster: '未分类主题',
      canonical_question: fallbackTitle,
      group_type: 'single',
      confidence: 0.2,
      items: [],
    }]
    : [];
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

  return {
    company_name: '',
    role_name: '',
    interview_stage: '未知',
    experience_summary: title || cleanedContent.slice(0, 120),
    topic_groups: normalizeTopicGroups(groupedItems, title || '面经问题'),
    cleaned_content: cleanedContent,
    quality_score: Math.min(100, Math.max(20, cleanedContent.length >= 120 ? 70 : 40)),
    is_valid: cleanedContent.length >= 60,
  };
};

const buildCleanPrompt = ({ title, sourceUrl, publishedAt, keyword, contentRaw }) => {
  const ruleHints = buildRuleHints(contentRaw);
  const candidateQuestions = splitCandidateQuestions(contentRaw).slice(0, 20);
  const cleanedContent = normalizeContentForCleaning(contentRaw);
  return {
    messages: [
    {
      role: 'system',
      content: [
        '你是前端求职训练系统中的面经结构化清洗器。',
        '你的任务是把一篇真实面经整理成可入库、可检索、可联动模拟面试的结构化 JSON。',
        '必须忠于原文，不允许编造公司、岗位、轮次、问题或答案。',
        '规则提示只作为候选标签，不作为最终判断依据。最终分组和分类必须由你基于原文语义独立判断。',
        '只输出 JSON，不要输出额外解释。',
        'JSON 结构：{"company_name":"","role_name":"","interview_stage":"一面|二面|HR面|实习|校招|社招|未知","experience_summary":"","topic_groups":[{"topic_cluster":"","canonical_question":"","group_type":"single|chain|mixed","confidence":0,"items":[{"question_text_raw":"","question_text_normalized":"","question_role":"main|follow_up|probe|compare|scenario","parent_ref":null,"category":"JavaScript|React|Vue|CSS|浏览器|网络|工程化|项目|算法|行为面|其他","difficulty":"easy|medium|hard","follow_up_intent":"clarify|deepen|compare|verify|scenario","knowledge_points":[],"expected_points":[]}]}],"cleaned_content":"","quality_score":0,"is_valid":true}',
        'cleaned_content 要删除广告、内推码、无关评论、表情噪音，但保留原始意思。',
        '不要把面试公司、面试时间、岗位、标题标签、感想、广告、答案解析、代码片段行当作问题项。',
        '如果原文存在多个主题，必须拆成多个 topic_groups，不要把整篇面经塞进一个组。',
        'topic_groups 必须按原文顺序输出。',
        '如果候选标签不合理，你必须拒绝它并按语义重新分组。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        source_platform: 'nowcoder',
        source_url: sourceUrl,
        title,
        published_at: publishedAt,
        keyword,
        rule_hints: ruleHints,
        candidate_questions: candidateQuestions,
        cleaned_content_hint: cleanedContent,
        content_raw: String(contentRaw || '').slice(0, 12000),
      }),
    },
    ],
  };
};

const cleanExperienceContent = async ({ title, sourceUrl, publishedAt, keyword, contentRaw }) => {
  if (!hasRealLLM()) {
    return fallbackCleanExperience({ title, contentRaw });
  }

  try {
    const result = await jsonCompletion(buildCleanPrompt({
      title,
      sourceUrl,
      publishedAt,
      keyword,
      contentRaw,
    }));

    return {
      company_name: String(result.company_name || '').trim(),
      role_name: String(result.role_name || '').trim(),
      interview_stage: String(result.interview_stage || '未知').trim() || '未知',
      experience_summary: normalizeWhitespace(result.experience_summary || ''),
      topic_groups: normalizeTopicGroups(Array.isArray(result.topic_groups) ? result.topic_groups : [], title || '面经问题'),
      cleaned_content: normalizeWhitespace(result.cleaned_content || ''),
      quality_score: Number(result.quality_score || 0),
      is_valid: Boolean(result.is_valid),
    };
  } catch (error) {
    console.error('[experience.cleaner.fallback]', {
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
  quality_score: Number(cleaned.quality_score || 0),
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
