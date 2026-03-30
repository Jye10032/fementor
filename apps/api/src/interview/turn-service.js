const { randomUUID } = require('crypto');
const { getUserById, getInterviewSession, listInterviewTurns, getInterviewQuestionById, updateInterviewQuestionStatus, getNextInterviewQuestion, addInterviewTurn, listInterviewQuestions, insertInterviewQuestionAfter } = require('../db');
const { readJdDoc } = require('../doc');
const { buildEvidenceBundle, classifyQuestionType, planRetrievalWithLLM } = require('../evidence-service');
const { buildInterviewContextWindow } = require('./context-service');
const {
  classifyInterviewTurnIntent,
  enhanceEvaluationWithLLM,
  generateEvaluationNarration,
  generateFollowUpQuestion,
  generateInterviewerReply,
  shouldInsertFollowUp,
} = require('./llm-service');
const { createHttpError } = require('../http');

const submitInterviewTurn = async ({ sessionId, body, onPhase, onToken }) => {
  const turnStartedAt = Date.now();
  const emitPhase = async (phase, message) => {
    if (typeof onPhase === 'function') {
      await onPhase(phase, message);
    }
  };

  const questionId = String(body.question_id || '').trim();
  const queuedQuestion = questionId ? getInterviewQuestionById(questionId) : null;
  const question = String(body.question || queuedQuestion?.stem || '').trim();
  const answer = String(body.answer || '').trim();
  const evidenceRefs = Array.isArray(body.evidence_refs) ? body.evidence_refs : [];

  console.log('[interview.turn.timing.start]', {
    session_id: sessionId,
    question_id: questionId || null,
    started_at: new Date(turnStartedAt).toISOString(),
  });

  if (!sessionId) throw new Error('session_id is required');
  if (!question) throw new Error('question is required');
  if (questionId && (!queuedQuestion || queuedQuestion.session_id !== sessionId)) throw new Error('question_id is invalid');
  if (queuedQuestion?.status === 'answered') throw new Error('question already answered');
  if (!answer) throw new Error('answer is required');

  const session = getInterviewSession(sessionId);
  if (!session) {
    throw createHttpError(404, 'session not found');
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
  const rawEvidenceRefs = evidenceRefs.length > 0 ? evidenceRefs : evidenceBundle.evidenceRefs;
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
  console.log('[interview.turn.timing.before_narration]', {
    session_id: sessionId,
    elapsed_ms: Date.now() - turnStartedAt,
    score,
    evidence_refs_count: rawEvidenceRefs.length,
  });
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
    await emitPhase('planning', '正在判断是否需要追问...');
    const needsFollowUp = shouldInsertFollowUp({
      queuedQuestion,
      score,
      weaknesses,
      queueItems,
    });

    if (needsFollowUp) {
      await emitPhase('reply', '正在生成追问题目...');
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

module.exports = {
  submitInterviewTurn,
};
