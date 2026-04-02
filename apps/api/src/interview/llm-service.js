const { randomUUID } = require('crypto');
const { jsonCompletion, streamCompletion } = require('../llm');
const { createContentStreamSplitter } = require('./content-stream-splitter');

const streamAssistantText = async ({ messages, onToken, logLabel, sessionContext }) => {
  let full = '';
  let firstDeltaAt = null;
  const streamStartedAt = Date.now();
  for await (const delta of streamCompletion({ messages, sessionContext })) {
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

/** @deprecated Use processInterviewTurnWithLLM instead. Kept for legacy pipeline fallback. */
const classifyInterviewTurnIntent = async ({
  question,
  input,
  interviewContext,
  sessionContext,
}) => {
  const result = await jsonCompletion({
    sessionContext,
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
  resumeSummary,
  jobDescription,
  questionType = 'project',
  sessionContext,
}) => {
  const result = await jsonCompletion({
    sessionContext,
    messages: [
      {
        role: 'system',
        content: [
          '你是前端模拟面试评分官。',
          '请结合候选人的回答、当前问题、题型、简历摘要、JD、历史上下文和检索证据，进行 rubric 评分。',
          '四个维度各 0-25 分：technical_depth 技术深度、structure_clarity 表达结构、evidence_grounding 证据支撑、role_fit 与岗位匹配度。',
          '必须先判断回答本身是否合理，再参考证据是否能支撑或补强；不要用简单关键词命中替代判断。',
          'project / scenario 题要重点判断方案是否合理、是否符合项目背景、是否讲清取舍与验证；knowledge 题要重点判断技术结论是否正确；basic 题要重点判断项目背景、职责与成果表达是否可信且贴合 JD。',
          '只输出 JSON：{"dimension_scores":{"technical_depth":0,"structure_clarity":0,"evidence_grounding":0,"role_fit":0},"total_score":0,"strengths":["..."],"weaknesses":["..."],"feedback":"...","standard_answer":"...","knowledge_boundary":{"mentioned_but_shallow":["..."],"conspicuously_absent":["..."]}}。',
          'strengths 和 weaknesses 各 1-3 条，必须紧扣回答质量；feedback 用一句话指出最优先改进点；standard_answer 必须优先参考 evidence_refs、resume_summary、job_description 组织更优回答。',
          'knowledge_boundary 用于追问决策：mentioned_but_shallow 列出候选人提到但没深入的知识点（0-3个）；conspicuously_absent 列出候选人明显遗漏的相关知识点（0-3个）。',
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
    knowledge_boundary: {
      mentioned_but_shallow: Array.isArray(result.knowledge_boundary?.mentioned_but_shallow)
        ? result.knowledge_boundary.mentioned_but_shallow : [],
      conspicuously_absent: Array.isArray(result.knowledge_boundary?.conspicuously_absent)
        ? result.knowledge_boundary.conspicuously_absent : [],
    },
  };
};

/** @deprecated Use processInterviewTurnWithLLM instead. Kept for legacy pipeline fallback. */
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
  sessionContext,
}) => streamAssistantText({
  onToken,
  logLabel: '[interview.evaluation.raw]',
  sessionContext,
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
  sessionContext,
}) => streamAssistantText({
  onToken,
  logLabel: '[interview.reply.raw]',
  sessionContext,
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

const generateInterviewQuestionQueue = async ({ user, jobDescription, targetLevel, sessionContext }) => {
  const result = await jsonCompletion({
    sessionContext,
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

const summarizeResumeWithLLM = async (resumeText, sessionContext) => {
  const startedAt = Date.now();
  console.log('[resume.summary.start]', {
    text_length: String(resumeText || '').length,
  });
  const result = await jsonCompletion({
    sessionContext,
    messages: [
      {
        role: 'system',
        content: [
          '你是前端候选人画像助手。请输出 JSON：',
          '{"summary":"不超过120字的中文摘要",',
          '"projects":[{"name":"项目名","original_description":"简历中该项目的原始描述，完整保留不要改写或压缩","tech_entities":["技术词"],"key_features":["关键技术实现点"]}],',
          '"all_tech_entities":["所有提到的技术词"]}',
          '规则：',
          '1. tech_entities 由你自由提取，忠于原文提到的技术，不推测没写的。',
          '2. projects 最多 5 个，按重要性排序。',
          '3. original_description 必须是简历原文中该项目段落的完整内容，逐字保留，不要归纳、压缩或改写。如果原文有多条描述就全部保留。',
          '4. key_features 提取 2-5 个关键技术实现点，每个点用一句话描述具体做了什么。',
        ].join(''),
      },
      {
        role: 'user',
        content: `请分析这份简历，提取摘要、项目列表和技术实体。\n\n${String(resumeText || '').slice(0, 5000)}`,
      },
    ],
  });

  const structured = {
    summary: String(result.summary || '').trim().slice(0, 200),
    projects: Array.isArray(result.projects) ? result.projects.slice(0, 5).map((p) => ({
      name: String(p.name || '').trim(),
      original_description: String(p.original_description || p.description || '').trim(),
      tech_entities: Array.isArray(p.tech_entities) ? p.tech_entities.map((t) => String(t).trim()).filter(Boolean) : [],
      key_features: Array.isArray(p.key_features) ? p.key_features.map((f) => String(f).trim()).filter(Boolean) : [],
    })) : [],
    all_tech_entities: Array.isArray(result.all_tech_entities)
      ? result.all_tech_entities.map((t) => String(t).trim()).filter(Boolean)
      : [],
  };

  console.log('[resume.summary.done]', {
    elapsed_ms: Date.now() - startedAt,
    summary_length: structured.summary.length,
    project_count: structured.projects.length,
    tech_entity_count: structured.all_tech_entities.length,
  });
  return structured;
};

/** @deprecated Use processInterviewTurnWithLLM instead. Kept for legacy pipeline fallback. */
const enhanceEvaluationWithLLM = async ({
  question,
  answer,
  evidenceRefs,
  interviewContext,
  resumeSummary = '',
  jobDescription = '',
  questionType = 'project',
  sessionContext,
}) => scoreAnswerWithRubricLLM({
  question,
  answer,
  evidenceRefs,
  interviewContext,
  resumeSummary,
  jobDescription,
  questionType,
  sessionContext,
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

const generateFollowUpQuestion = async ({
  queuedQuestion,
  answer,
  weaknesses,
  interviewContext,
  sessionContext,
}) => {
  const result = await jsonCompletion({
    sessionContext,
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

const buildUnifiedTurnSystemPrompt = ({ candidateFollowUp, keywordContext }) => {
  const parts = [
    '你是资深中文前端模拟面试官，负责一次性完成意图判断、题型分类、评分和自然语言评价。',
    '',
    '## 输出规则',
    '1. 只输出一个 JSON 对象，不要输出任何其他内容。',
    '2. 字段必须严格按下方顺序输出，content 必须是最后一个字段。',
    '3. 如果用户输入不是正式回答（intent 不是 answer），只输出 intent、intent_confidence、content 三个字段，省略其他所有字段。',
    '',
    '## 意图判断',
    'intent 取值：answer（可评分回答）、clarify（没理解题意）、question_back（反问面试官）、skip（明确跳过）、meta（问流程/规则）、invalid（内容太短或无效）。',
    '如果输入同时含少量寒暄和有效回答，以 answer 为准。',
    '',
    '## 题型分类',
    'question_type 取值：basic（自我介绍/背景）、project（项目经历/实现细节）、knowledge（概念/原理/底层机制）、scenario（故障排查/方案设计/权衡取舍）、follow_up（追问）。',
    '',
    '## 评分维度（各 0-25 分）',
    '- technical_depth：技术深度',
    '- structure_clarity：表达结构',
    '- evidence_grounding：证据支撑（回答与证据、简历、JD 是否互相印证）',
    '- role_fit：与岗位匹配度',
    '',
    '评分规则：',
    '- project/scenario 题重点判断方案是否合理、是否讲清取舍与验证',
    '- knowledge 题重点判断技术结论是否正确',
    '- basic 题重点判断背景、职责与成果表达是否可信且贴合 JD',
    '- 回答如果只停留在抽象定义或空泛结论，应明显扣分',
    '',
    '## knowledge_boundary',
    'mentioned_but_shallow：候选人提到但没深入的知识点（0-3 个）',
    'conspicuously_absent：候选人明显遗漏的相关知识点（0-3 个）',
  ];

  if (keywordContext) {
    parts.push(
      '',
      '## 关键词考察上下文',
      `当前考察关键词：${keywordContext.keyword}`,
      `已用轮次：${keywordContext.turnsUsed}/${keywordContext.maxTurns}`,
      '',
      '## expected_points 命中判断',
      '在 expected_points_hit 中列出候选人回答命中的期望点。',
      '在 expected_points_missed 中列出候选人回答未命中的期望点。',
      '',
      '## next_action 决策',
      '判断下一步动作：',
      '- follow_up_expected_point：候选人回答中有明显薄弱点需要追问，且当前关键词轮次未用完',
      '- follow_up_from_bank：候选追问题（candidate_follow_up）适合当前薄弱点，且轮次未用完',
      '- new_keyword：当前关键词已考察充分或轮次已用完，应进入下一个关键词',
      `当已用轮次 >= ${keywordContext.maxTurns} 时，必须输出 new_keyword。`,
      '',
      '## keyword_proficiency_snapshot',
      '当 next_action 为 new_keyword 时，必须输出 keyword_proficiency_snapshot：',
      '一句话总结候选人对当前关键词的掌握情况。',
    );
  }

  if (candidateFollowUp) {
    parts.push(
      '',
      '## 追问验证',
      '输入中提供了一道候选追问题（candidate_follow_up），请判断该追问是否适合当前回答的薄弱点。',
      '在 follow_up_validation 中输出 { "suitable": true/false, "reason": "简短原因" }。',
      '如果候选追问与当前薄弱点不匹配，suitable 设为 false。',
    );
  }

  const fieldOrder = [
    'intent → intent_confidence → question_type → question_type_reason → dimension_scores → total_score → strengths → weaknesses → feedback → standard_answer → knowledge_boundary',
    keywordContext ? '→ expected_points_hit → expected_points_missed → next_action → next_action_reason → keyword_proficiency_snapshot' : '',
    candidateFollowUp ? '→ follow_up_validation' : '',
    '→ content',
  ].filter(Boolean).join(' ');

  parts.push(
    '',
    '## content 字段',
    '当 intent 为 answer 时：输出 3-5 句中文面试官评价，先给整体判断，再点出优点，接着指出改进点，最后给建议。语气克制、专业。',
    '当 intent 不为 answer 时：输出 2-4 句面试官回复（clarify 换说法重述题目；skip 确认跳过；meta 简短回答流程问题；invalid 提示给出可评分回答）。',
    '',
    '## 输出字段顺序（严格遵守）',
    fieldOrder,
  );

  return parts.join('\n');
};

const buildUnifiedTurnUserContent = ({
  question,
  answer,
  interviewContext,
  resumeSummary,
  jobDescription,
  evidenceRefs,
  questionTypeHint,
  candidateFollowUp,
  keywordContext,
}) => {
  const payload = {
    question: String(question || '').slice(0, 300),
    question_type_hint: String(questionTypeHint || ''),
    answer: String(answer || '').slice(0, 3000),
    resume_summary: String(resumeSummary || '').slice(0, 800),
    job_description: String(jobDescription || '').slice(0, 1800),
    interview_context: String(interviewContext || '').slice(0, 1800),
    evidence_refs: (evidenceRefs || []).slice(0, 6).map((item) => ({
      source_type: item.source_type,
      source_uri: item.source_uri,
      quote: String(item.quote || '').slice(0, 220),
      confidence: item.confidence,
    })),
  };

  if (keywordContext) {
    payload.keyword_context = {
      keyword: keywordContext.keyword,
      turns_used: keywordContext.turnsUsed,
      max_turns: keywordContext.maxTurns,
    };
  }

  if (candidateFollowUp) {
    payload.candidate_follow_up = {
      stem: String(candidateFollowUp.stem || '').slice(0, 200),
      knowledge_points: (candidateFollowUp.knowledge_points || []).slice(0, 5),
      difficulty: candidateFollowUp.difficulty || 'medium',
      follow_up_intent: candidateFollowUp.follow_up_intent || '',
    };
  }

  return JSON.stringify(payload);
};

const processInterviewTurnWithLLM = async ({
  question,
  answer,
  interviewContext,
  resumeSummary,
  jobDescription,
  evidenceRefs,
  questionTypeHint,
  candidateFollowUp,
  keywordContext,
  onToken,
  sessionContext,
}) => {
  const startedAt = Date.now();
  let firstDeltaAt = null;

  const splitter = createContentStreamSplitter({
    onContentToken: async (token) => {
      if (firstDeltaAt === null) {
        firstDeltaAt = Date.now();
        console.log('[interview.unified.first_content_token]', {
          latency_ms: firstDeltaAt - startedAt,
        });
      }
      if (typeof onToken === 'function') {
        await onToken(token);
      }
    },
  });

  const messages = [
    {
      role: 'system',
      content: buildUnifiedTurnSystemPrompt({ candidateFollowUp, keywordContext }),
    },
    {
      role: 'user',
      content: buildUnifiedTurnUserContent({
        question,
        answer,
        interviewContext,
        resumeSummary,
        jobDescription,
        evidenceRefs,
        questionTypeHint,
        candidateFollowUp,
        keywordContext,
      }),
    },
  ];

  for await (const delta of streamCompletion({ messages, sessionContext })) {
    await splitter.feed(delta);
  }

  const result = splitter.end();

  console.log('[interview.unified.completed]', {
    elapsed_ms: Date.now() - startedAt,
    first_content_latency_ms: firstDeltaAt ? firstDeltaAt - startedAt : null,
    intent: result.intent,
    score: result.total_score,
    content_streamed: result._contentWasStreamed,
  });

  // If content was not streamed (field order issue), push it now
  if (!result._contentWasStreamed && result.content && typeof onToken === 'function') {
    await onToken(result.content);
  }

  return {
    intent: result.intent || 'invalid',
    intent_confidence: result.intent_confidence || 0,
    intent_reason: result.intent_reason || '',
    question_type: result.question_type || questionTypeHint || 'project',
    question_type_reason: result.question_type_reason || '',
    score: result.total_score || 0,
    dimension_scores: result.dimension_scores || {},
    strengths: Array.isArray(result.strengths) ? result.strengths : [],
    weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : [],
    feedback: result.feedback || '',
    standard_answer: result.standard_answer || '',
    knowledge_boundary: {
      mentioned_but_shallow: Array.isArray(result.knowledge_boundary?.mentioned_but_shallow)
        ? result.knowledge_boundary.mentioned_but_shallow : [],
      conspicuously_absent: Array.isArray(result.knowledge_boundary?.conspicuously_absent)
        ? result.knowledge_boundary.conspicuously_absent : [],
    },
    follow_up_validation: result.follow_up_validation || null,
    expected_points_hit: Array.isArray(result.expected_points_hit) ? result.expected_points_hit : [],
    expected_points_missed: Array.isArray(result.expected_points_missed) ? result.expected_points_missed : [],
    next_action: result.next_action || null,
    next_action_reason: result.next_action_reason || '',
    keyword_proficiency_snapshot: result.keyword_proficiency_snapshot || null,
    content: result.content || '',
  };
};

const generateKeywordQueue = async ({ resumeStructured, jobDescription, targetLevel, level2Vocabulary, sessionContext }) => {
  const result = await jsonCompletion({
    sessionContext,
    messages: [
      {
        role: 'system',
        content: [
          '你是前端面试规划师。',
          '你的任务是分析候选人简历和目标岗位 JD，提取一组面试考察关键词队列。',
          '',
          '## 关键词粒度',
          '关键词必须对齐 Level 2（子话题）粒度，不要太粗（如"React"）也不要太细（如"useState"）。',
          '参考词表（优先使用，但不限于此）：',
          (level2Vocabulary || []).join('、'),
          '',
          '## 提取规则',
          '1. 每个关键词必须能追溯到简历中的具体描述，在 resume_anchor 中给出原文片段',
          '2. 同一段简历描述可以拆出多个关键词',
          '3. JD 中明确要求但简历未提及的技能，也要提取，resume_anchor 标记为 "JD要求，简历未提及"',
          '4. 按面试价值排序：JD 强相关 + 简历有深度描述的排前面',
          '5. 总数控制在 6-10 个',
          '',
          '只输出 JSON，不要输出其他内容。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          target_level: targetLevel,
          resume: {
            summary: String(resumeStructured?.summary || '').slice(0, 400),
            projects: (resumeStructured?.projects || []).slice(0, 5).map((p) => ({
              name: p.name,
              description: String(p.original_description || p.description || '').slice(0, 300),
              tech_entities: (p.tech_entities || []).slice(0, 8),
              key_features: (p.key_features || []).slice(0, 4),
            })),
            all_tech_entities: (resumeStructured?.all_tech_entities || []).slice(0, 20),
          },
          job_description: String(jobDescription || '').slice(0, 2000),
          output_contract: {
            keywords: [{
              keyword: 'Level 2 子话题名称',
              category: 'Level 1 大类名称',
              resume_anchor: '简历中的原文片段',
              interview_angle: '建议的提问切入角度',
            }],
          },
        }),
      },
    ],
  });

  return (result.keywords || []).slice(0, 10).map((item) => ({
    keyword: String(item.keyword || '').trim(),
    category: String(item.category || '').trim(),
    resume_anchor: String(item.resume_anchor || '').trim(),
    interview_angle: String(item.interview_angle || '').trim(),
    status: 'pending',
    turns_used: 0,
    proficiency: null,
  }));
};

const generateQuestionForKeyword = async ({ keyword, resumeAnchor, resumeSummary, jobDescription, targetLevel, sessionContext }) => {
  const result = await jsonCompletion({
    sessionContext,
    messages: [
      {
        role: 'system',
        content: [
          '你是前端面试官。请基于给定的知识点关键词生成 1 道面试题。',
          '题目必须口语化、自然、可直接用于中文面试现场发问。',
          '如果提供了 resume_anchor，题目应结合候选人简历中的具体描述来提问。',
          '只输出 JSON。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          keyword,
          resume_anchor: String(resumeAnchor || '').slice(0, 300),
          resume_summary: String(resumeSummary || '').slice(0, 600),
          job_description: String(jobDescription || '').slice(0, 1200),
          target_level: targetLevel,
          output_contract: {
            question_type: 'project|knowledge|scenario',
            difficulty: 'easy|medium|hard',
            stem: '题干',
            expected_points: ['要点1', '要点2'],
          },
        }),
      },
    ],
  });

  return {
    id: randomUUID(),
    source: 'llm',
    question_type: String(result.question_type || 'knowledge').trim(),
    difficulty: String(result.difficulty || 'medium').trim(),
    stem: String(result.stem || '').trim(),
    expected_points: (result.expected_points || []).map((p) => String(p).trim()).filter(Boolean).slice(0, 5),
    resume_anchor: String(resumeAnchor || '').trim(),
    source_ref: 'keyword_generated',
    status: 'pending',
  };
};

const generateInterviewReport = async ({ keywordQueue, turns, resumeSummary, jobDescription, sessionContext }) => {
  const keywordResults = (keywordQueue?.entries || [])
    .filter((e) => e.status === 'completed' && e.proficiency)
    .map((e) => ({
      keyword: e.keyword,
      category: e.category || '',
      resume_anchor: e.resume_anchor || '',
      proficiency: e.proficiency,
      turns_used: e.turns_used,
    }));

  const turnsSummary = (turns || []).map((t) => ({
    turn_index: t.turn_index,
    question: String(t.question || '').slice(0, 120),
    score: t.score,
    strengths: t.strengths || [],
    weaknesses: t.weaknesses || [],
  }));

  const avgScore = turns.length > 0
    ? Math.round(turns.reduce((s, t) => s + (t.score || 0), 0) / turns.length)
    : 0;

  const result = await jsonCompletion({
    sessionContext,
    messages: [
      {
        role: 'system',
        content: [
          '你是前端面试评估专家。',
          '请基于候选人在各个知识点关键词上的表现，生成一份结构化面试报告。',
          '报告应包含：整体评价、各关键词详细评估、跨关键词观察、推荐学习路径。',
          '只输出 JSON。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          resume_summary: String(resumeSummary || '').slice(0, 600),
          job_description: String(jobDescription || '').slice(0, 1200),
          keyword_results: keywordResults,
          turns_summary: turnsSummary.slice(0, 20),
          avg_score: avgScore,
          output_contract: {
            overall_score: '0-100',
            overall_assessment: '整体评价（2-3句）',
            keyword_assessments: [{
              keyword: '关键词',
              score: '0-100',
              verdict: 'strong|adequate|weak',
              summary: '一句话评价',
            }],
            cross_keyword_observations: ['跨关键词观察'],
            recommended_focus: ['推荐学习路径'],
          },
        }),
      },
    ],
  });

  return {
    overall_score: result.overall_score || avgScore,
    overall_assessment: result.overall_assessment || '',
    keyword_assessments: Array.isArray(result.keyword_assessments) ? result.keyword_assessments : [],
    cross_keyword_observations: Array.isArray(result.cross_keyword_observations) ? result.cross_keyword_observations : [],
    recommended_focus: Array.isArray(result.recommended_focus) ? result.recommended_focus : [],
  };
};

module.exports = {
  classifyInterviewTurnIntent,
  enhanceEvaluationWithLLM,
  generateEvaluationNarration,
  generateFollowUpQuestion,
  generateInterviewQuestionQueue,
  generateInterviewerReply,
  generateInterviewReport,
  generateKeywordQueue,
  generateQuestionForKeyword,
  processInterviewTurnWithLLM,
  shouldInsertFollowUp,
  summarizeResumeWithLLM,
};
