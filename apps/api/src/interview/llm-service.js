const path = require('path');
const { randomUUID } = require('crypto');
const { jsonCompletion, streamCompletion } = require('../llm');

const streamAssistantText = async ({ messages, onToken, logLabel }) => {
  let full = '';
  let firstDeltaAt = null;
  const streamStartedAt = Date.now();
  for await (const delta of streamCompletion({ messages })) {
    if (firstDeltaAt === null) {
      firstDeltaAt = Date.now();
      console.log('[interview.stream.first_delta]', {
        log_label: logLabel || '[interview.stream.raw]',
        latency_ms: firstDeltaAt - streamStartedAt,
        preview: String(delta).slice(0, 80),
        length: String(delta).length,
      });
    }
    full += delta;
    if (typeof onToken === 'function') {
      await onToken(delta);
    }
  }
  console.log('[interview.stream.completed]', {
    log_label: logLabel || '[interview.stream.raw]',
    total_length: full.length,
    first_delta_latency_ms: firstDeltaAt === null ? null : firstDeltaAt - streamStartedAt,
    total_stream_ms: Date.now() - streamStartedAt,
  });
  console.log(logLabel || '[interview.stream.raw]', { content: full });
  return String(full || '').trim();
};

const classifyInterviewTurnIntent = async ({
  question,
  input,
  interviewContext,
}) => {
  const result = await jsonCompletion({
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
  const result = await jsonCompletion({
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
    score: result.total_score,
    dimension_scores: result.dimension_scores,
    strengths: result.strengths,
    weaknesses: result.weaknesses,
    feedback: result.feedback,
    standard_answer: result.standard_answer,
  };
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
}) => streamAssistantText({
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

const generateInterviewerReply = async ({
  intent,
  queuedQuestion,
  input,
  interviewContext,
  onToken,
}) => streamAssistantText({
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

const normalizeGeneratedQuestions = (items) =>
  items
    .map((item, index) => ({
      id: randomUUID(),
      order_no: index + 1,
      source: String(item.source).trim(),
      question_type: String(item.question_type).trim(),
      difficulty: String(item.difficulty).trim(),
      stem: String(item.stem).trim(),
      expected_points: item.expected_points.map((value) => String(value).trim()).filter(Boolean).slice(0, 5),
      resume_anchor: String(item.resume_anchor).trim(),
      source_ref: String(item.source_ref).trim(),
      status: index === 0 ? 'asked' : 'pending',
    }))
    .slice(0, 5);

const generateInterviewQuestionQueue = async ({ user, jobDescription, targetLevel }) => {
  const result = await jsonCompletion({
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

  return normalizeGeneratedQuestions(result.questions);
};

const summarizeResumeWithLLM = async (resumeText) => {
  const startedAt = Date.now();
  console.log('[resume.summary.start]', {
    text_length: String(resumeText || '').length,
  });
  const result = await jsonCompletion({
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
  console.log('[resume.summary.done]', {
    elapsed_ms: Date.now() - startedAt,
    summary_length: String(result.summary).trim().length,
  });
  return String(result.summary).trim();
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
}) => scoreAnswerWithRubricLLM({
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

const shouldInsertFollowUp = ({ queuedQuestion, score, weaknesses, queueItems }) => {
  if (!queuedQuestion) return false;
  if (queuedQuestion.question_type === 'follow_up') return false;
  if (queuedQuestion.status === 'answered') return false;

  const weaknessList = Array.isArray(weaknesses) ? weaknesses.filter(Boolean) : [];
  const weakSignal = score < 70 || weaknessList.length > 0;
  if (!weakSignal) return false;

  const existedFollowUp = (queueItems || []).some((item) =>
    item.question_type === 'follow_up'
    && item.source_ref === `follow_up_of:${queuedQuestion.id}`,
  );

  return !existedFollowUp;
};

const generateFollowUpQuestion = async ({ queuedQuestion, answer, weaknesses, interviewContext }) => {
  const result = await jsonCompletion({
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
    source: 'llm',
    question_type: 'follow_up',
    difficulty: String(result.difficulty).trim(),
    stem: String(result.stem).trim(),
    expected_points: result.expected_points.map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
    resume_anchor: String(result.resume_anchor).trim(),
    source_ref: `follow_up_of:${queuedQuestion.id}`,
    status: 'asked',
  };
};

module.exports = {
  classifyInterviewTurnIntent,
  enhanceEvaluationWithLLM,
  generateEvaluationNarration,
  generateFollowUpQuestion,
  generateInterviewQuestionQueue,
  generateInterviewerReply,
  shouldInsertFollowUp,
  summarizeResumeWithLLM,
};
