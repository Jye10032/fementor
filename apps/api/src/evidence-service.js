const fs = require('fs');
const { listUserDocs, readJdDoc } = require('./doc');
const { readResumeDoc } = require('./resume');
const { buildQueryPlan, retrieveEvidence } = require('./retrieval');
const { jsonCompletion } = require('./llm');

const planRetrievalWithLLM = async ({
  question,
  answer,
  questionType,
  intent = 'answer',
  interviewContext = '',
}) => {
  return jsonCompletion({
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
};

const classifyQuestionType = async ({
  question,
  answer = '',
  queuedQuestionType = '',
  interviewContext = '',
}) => {
  const result = await jsonCompletion({
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
    .sort((left, right) => left.name.localeCompare(right.name));

  const topKnowledgePaths = knowledgeDocs
    .slice(0, 4)
    .map((item) => item.path);

  let selectedPaths = [];
  if (questionType === 'basic') {
    selectedPaths = [];
  } else {
    selectedPaths = [...topKnowledgePaths];
  }

  const uniqueSelectedPaths = uniqPaths(selectedPaths).filter((item) => fs.existsSync(item));

  return {
    question_type: questionType,
    paths: uniqueSelectedPaths,
    active_resume_path: activeResume?.path || null,
    active_jd_path: activeJd?.path || null,
    selected_knowledge_paths: topKnowledgePaths,
  };
};

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
      evidenceRefs: [],
      strategy: 'none',
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
    plannedQuery: retrievalPlanner?.query || '',
    plannedKeywords: retrievalPlanner?.keywords || [],
    retrievalGoal: retrievalPlanner?.retrieval_goal || 'find_evidence',
  });

  return {
    queryPlan: result.plan,
    localHits: result.local.items,
    sirchmunk: result.sirchmunk,
    evidenceRefs: result.evidence_refs,
    strategy: result.strategy,
    retrievalPlan,
    retrievalPlanner,
  };
};

module.exports = {
  buildEvidenceBundle,
  classifyQuestionType,
  planRetrievalWithLLM,
};
