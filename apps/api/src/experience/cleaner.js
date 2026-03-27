const { createHash, randomUUID } = require('crypto');
const { hasRealLLM, jsonCompletion } = require('../llm');

const normalizeWhitespace = (value) =>
  String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const splitCandidateQuestions = (content) =>
  String(content || '')
    .split(/\n+/)
    .map((line) => line.replace(/^[\s\-*•\d.、()（）]+/, '').trim())
    .filter((line) => line.length >= 6)
    .slice(0, 20);

const inferCategory = (question) => {
  const text = String(question || '').toLowerCase();
  if (/react/.test(text)) return 'React';
  if (/vue/.test(text)) return 'Vue';
  if (/css|flex|布局/.test(text)) return 'CSS';
  if (/浏览器|缓存|http|cookie|storage|跨域/.test(text)) return '浏览器';
  if (/webpack|vite|工程化|构建/.test(text)) return '工程化';
  if (/项目|实习|场景/.test(text)) return '项目';
  if (/算法|排序|链表|树|数组/.test(text)) return '算法';
  if (/promise|async|await|js|javascript/.test(text)) return 'JavaScript';
  return '其他';
};

const fallbackCleanExperience = ({ title, contentRaw }) => {
  const candidateQuestions = splitCandidateQuestions(contentRaw);
  const cleanedContent = normalizeWhitespace(contentRaw)
    .replace(/#牛客AI配图神器#/g, '')
    .replace(/内推码?.*$/gm, '')
    .trim();

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

  return {
    company_name: '',
    role_name: '',
    interview_stage: '未知',
    experience_summary: title || cleanedContent.slice(0, 120),
    topic_groups: items.length > 0
      ? [{
        topic_cluster: '未分类主题',
        canonical_question: items[0].question_text_normalized || title || '面经问题',
        group_type: items.length > 1 ? 'mixed' : 'single',
        confidence: 0.3,
        items,
      }]
      : [],
    cleaned_content: cleanedContent,
    quality_score: Math.min(100, Math.max(20, cleanedContent.length >= 120 ? 70 : 40)),
    is_valid: cleanedContent.length >= 60,
  };
};

const buildCleanPrompt = ({ title, sourceUrl, publishedAt, keyword, contentRaw }) => ({
  messages: [
    {
      role: 'system',
      content: [
        '你是前端求职训练系统中的面经结构化清洗器。',
        '你的任务是把一篇真实面经整理成可入库、可检索、可联动模拟面试的结构化 JSON。',
        '必须忠于原文，不允许编造公司、岗位、轮次、问题或答案。',
        '只输出 JSON，不要输出额外解释。',
        'JSON 结构：{"company_name":"","role_name":"","interview_stage":"一面|二面|HR面|实习|校招|社招|未知","experience_summary":"","topic_groups":[{"topic_cluster":"","canonical_question":"","group_type":"single|chain|mixed","confidence":0,"items":[{"question_text_raw":"","question_text_normalized":"","question_role":"main|follow_up|probe|compare|scenario","parent_ref":null,"category":"JavaScript|React|Vue|CSS|浏览器|网络|工程化|项目|算法|行为面|其他","difficulty":"easy|medium|hard","follow_up_intent":"clarify|deepen|compare|verify|scenario","knowledge_points":[],"expected_points":[]}]}],"cleaned_content":"","quality_score":0,"is_valid":true}',
        'cleaned_content 要删除广告、内推码、无关评论、表情噪音，但保留原始意思。',
        'topic_groups 必须按原文顺序输出。',
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
        content_raw: String(contentRaw || '').slice(0, 12000),
      }),
    },
  ],
});

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
      topic_groups: Array.isArray(result.topic_groups) ? result.topic_groups : [],
      cleaned_content: normalizeWhitespace(result.cleaned_content || ''),
      quality_score: Number(result.quality_score || 0),
      is_valid: Boolean(result.is_valid),
    };
  } catch {
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
