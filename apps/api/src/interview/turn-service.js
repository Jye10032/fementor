const { randomUUID } = require('crypto');
const { getUserById, getInterviewSession, listInterviewTurns, getInterviewQuestionById, updateInterviewQuestionStatus, getNextInterviewQuestion, addInterviewTurn, listInterviewQuestions, insertInterviewQuestionAfter, getSessionKeywordQueue, updateSessionKeywordQueue } = require('../db');
const { readJdDoc } = require('../doc');
const { classifyQuestionType } = require('../evidence-service');
const { buildInterviewContextWindow } = require('./context-service');
const {
  classifyInterviewTurnIntent,
  enhanceEvaluationWithLLM,
  generateEvaluationNarration,
  generateFollowUpQuestion,
  generateInterviewerReply,
  processInterviewTurnWithLLM,
  shouldInsertFollowUp,
} = require('./llm-service');
const { selectOrGenerateFollowUp, rankFollowUpByRelevance, adaptFollowUp } = require('../experience/follow-up-reuse');
const { recallQuestionForKeyword } = require('../experience/recall');
const { createHttpError } = require('../http');

const USE_UNIFIED_PIPELINE = process.env.INTERVIEW_PIPELINE_VERSION !== 'legacy';

/** Pick the best candidate follow-up from the experience chain (no LLM). */
const pickCandidateFollowUp = (queuedQuestion) => {
  const chain = queuedQuestion?._follow_up_chain;
  if (!Array.isArray(chain) || chain.length === 0) return null;
  // Sort by intent priority (deepen > compare > verify/scenario > clarify)
  const INTENT_PRIORITY = { deepen: 4, compare: 3, verify: 2, scenario: 2, clarify: 1 };
  const sorted = [...chain].sort(
    (a, b) => (INTENT_PRIORITY[b.follow_up_intent] || 0) - (INTENT_PRIORITY[a.follow_up_intent] || 0),
  );
  return sorted[0] || null;
};

// --- Unified pipeline (1 LLM call) ---
const submitInterviewTurnUnified = async ({ sessionId, body, onPhase, onToken, sessionContext }) => {
  const turnStartedAt = Date.now();
  const emitPhase = async (phase, message) => {
    if (typeof onPhase === 'function') await onPhase(phase, message);
  };

  const questionId = String(body.question_id || '').trim();
  const queuedQuestion = questionId ? await getInterviewQuestionById(questionId) : null;
  const question = String(body.question || queuedQuestion?.stem || '').trim();
  const answer = String(body.answer || '').trim();

  console.log('[interview.turn.unified.start]', {
    session_id: sessionId,
    question_id: questionId || null,
    started_at: new Date(turnStartedAt).toISOString(),
  });

  if (!sessionId) throw new Error('session_id is required');
  if (!question) throw new Error('question is required');
  if (questionId && (!queuedQuestion || queuedQuestion.session_id !== sessionId)) throw new Error('question_id is invalid');
  if (queuedQuestion?.status === 'answered') throw new Error('question already answered');
  if (!answer) throw new Error('answer is required');

  const session = await getInterviewSession(sessionId);
  if (!session) throw createHttpError(404, 'session not found');
  if (session.status !== 'in_progress') throw new Error('session is not in progress');

  const turns = await listInterviewTurns(sessionId);
  const turnIndex = turns.length + 1;
  const interviewContext = await buildInterviewContextWindow({
    turns,
    currentQuestion: question,
    sessionContext,
  });
  const user = await getUserById(session.user_id);
  const activeJd = user?.active_jd_file
    ? await readJdDoc({ userId: session.user_id, fileName: user.active_jd_file })
    : null;
  const resumeSummary = String(user?.resume_summary || '').trim();
  const jobDescription = String(activeJd?.content || '').trim();

  const evidenceRefs = [];

  // 2. Search candidate follow-up from experience bank (non-LLM)
  const candidateFollowUp = pickCandidateFollowUp(queuedQuestion);

  // 2.5 Load keyword queue context
  const keywordQueue = await getSessionKeywordQueue(sessionId);
  const currentKeywordEntry = keywordQueue?.entries?.find((e) => e.status === 'active') || null;
  const keywordContext = currentKeywordEntry ? {
    keyword: currentKeywordEntry.keyword,
    turnsUsed: currentKeywordEntry.turns_used,
    maxTurns: keywordQueue.max_turns_per_keyword || 3,
  } : null;

  // 3. Unified LLM call
  await emitPhase('evaluation', '评估回答');
  const llmResult = await processInterviewTurnWithLLM({
    question,
    answer,
    interviewContext: interviewContext.contextText,
    resumeSummary,
    jobDescription,
    evidenceRefs,
    questionTypeHint: queuedQuestion?.question_type || '',
    candidateFollowUp,
    keywordContext,
    onToken,
    sessionContext,
  });

  // 4. Handle non-answer intents
  if (llmResult.intent !== 'answer') {
    if (llmResult.intent === 'skip' && queuedQuestion) {
      await updateInterviewQuestionStatus({ questionId: queuedQuestion.id, status: 'skipped' });
    }
    let nextQuestion = await getNextInterviewQuestion(sessionId);
    if (nextQuestion && nextQuestion.status === 'pending') {
      await updateInterviewQuestionStatus({ questionId: nextQuestion.id, status: 'asked' });
      nextQuestion = { ...nextQuestion, status: 'asked' };
    }
    return {
      session_id: sessionId,
      question_id: queuedQuestion?.id || null,
      turn_id: null,
      turn_index: turnIndex,
      intent: llmResult.intent,
      intent_confidence: llmResult.intent_confidence,
      intent_reason: llmResult.intent_reason,
      handled_as: llmResult.intent === 'skip' ? 'skip' : 'non_answer',
      current_question_status: llmResult.intent === 'skip' ? 'skipped' : (queuedQuestion?.status || 'asked'),
      reply_text: llmResult.content,
      evaluation_text: llmResult.content,
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

  // 5. Persist answer turn
  const turnId = randomUUID();
  await addInterviewTurn({
    id: turnId,
    sessionId,
    questionId: queuedQuestion?.id || null,
    turnIndex,
    question,
    answer,
    score: llmResult.score,
    strengths: llmResult.strengths,
    weaknesses: llmResult.weaknesses,
    evidenceRefsCount: evidenceRefs.length,
  });

  // 6. Follow-up and keyword handling
  let nextQuestion = null;
  if (queuedQuestion) {
    await updateInterviewQuestionStatus({ questionId: queuedQuestion.id, status: 'answered' });
    const queueItems = await listInterviewQuestions(sessionId);
    await emitPhase('planning', '准备下一题');

    // Update keyword turns_used
    if (currentKeywordEntry) {
      currentKeywordEntry.turns_used += 1;
    }

    const nextAction = llmResult.next_action;
    const forceNewKeyword = currentKeywordEntry
      && currentKeywordEntry.turns_used >= (keywordQueue?.max_turns_per_keyword || 3);

    if (nextAction === 'new_keyword' || forceNewKeyword) {
      // --- Keyword completed: record proficiency, move to next keyword ---
      if (currentKeywordEntry) {
        currentKeywordEntry.status = 'completed';
        currentKeywordEntry.proficiency = llmResult.keyword_proficiency_snapshot || {
          summary: '',
          score: llmResult.score || 0,
          strengths: llmResult.strengths || [],
          weaknesses: llmResult.weaknesses || [],
        };

        // Pick next pending keyword
        const nextKeywordEntry = keywordQueue.entries.find((e) => e.status === 'pending');
        if (nextKeywordEntry) {
          nextKeywordEntry.status = 'active';

          // Recall question for next keyword from experience bank
          const recalled = await recallQuestionForKeyword({
            keyword: nextKeywordEntry.keyword,
            resumeAnchor: nextKeywordEntry.resume_anchor,
            targetLevel: 'mid',
            sessionContext,
          });

          if (recalled) {
            const mainItem = (recalled.items || []).find((i) => i.question_role === 'main') || recalled.items?.[0];
            const followUpChain = (recalled.items || []).filter((i) => i.question_role !== 'main');
            const newQuestion = {
              id: randomUUID(),
              source: 'experience',
              question_type: mainItem?.category === 'project' ? 'project' : 'knowledge',
              difficulty: mainItem?.difficulty || 'medium',
              stem: mainItem?.question_text_normalized || mainItem?.question_text_raw || recalled.canonical_question,
              expected_points: mainItem?.expected_points || [],
              resume_anchor: nextKeywordEntry.resume_anchor || '',
              source_ref: `experience_group:${recalled.id}`,
              status: 'asked',
              keyword: nextKeywordEntry.keyword,
              _follow_up_chain: followUpChain,
            };
            try {
              await insertInterviewQuestionAfter({ sessionId, afterOrderNo: queuedQuestion.order_no, item: newQuestion });
              nextQuestion = { ...newQuestion, session_id: sessionId, order_no: queuedQuestion.order_no + 1 };
            } catch (err) {
              console.error('[interview.keyword.insert_failed]', err);
            }
          } else {
            // Fallback: generate via LLM
            const { generateQuestionForKeyword } = require('./llm-service');
            const generated = await generateQuestionForKeyword({
              keyword: nextKeywordEntry.keyword,
              resumeAnchor: nextKeywordEntry.resume_anchor,
              resumeSummary,
              jobDescription,
              targetLevel: 'mid',
              sessionContext,
            });
            generated.keyword = nextKeywordEntry.keyword;
            generated.status = 'asked';
            const genItem = { id: generated.id || randomUUID(), ...generated };
            try {
              await insertInterviewQuestionAfter({ sessionId, afterOrderNo: queuedQuestion.order_no, item: genItem });
              nextQuestion = { ...genItem, session_id: sessionId, order_no: queuedQuestion.order_no + 1 };
            } catch (err) {
              console.error('[interview.keyword.generate_insert_failed]', err);
            }
          }
        }
        // else: all keywords exhausted, interview ends naturally

        await updateSessionKeywordQueue({ sessionId, keywordQueueJson: JSON.stringify(keywordQueue) });
      }
    } else {
      // --- Follow-up within current keyword ---
      const needsFollowUp = shouldInsertFollowUp({
        queuedQuestion,
        score: llmResult.score,
        weaknesses: llmResult.weaknesses,
        queueItems,
      });

      if (needsFollowUp) {
        const validation = llmResult.follow_up_validation;
        if (validation?.suitable && candidateFollowUp) {
          const adaptedStem = await adaptFollowUp({
            bankItem: candidateFollowUp,
            currentQuestion: queuedQuestion.stem,
            lastAnswer: answer,
            resumeAnchor: queuedQuestion.resume_anchor,
            sessionContext,
          });
          const followUpItem = {
            id: randomUUID(),
            source: 'experience',
            question_type: 'follow_up',
            difficulty: candidateFollowUp.difficulty || 'medium',
            stem: adaptedStem,
            expected_points: candidateFollowUp.expected_points || [],
            resume_anchor: queuedQuestion.resume_anchor || '',
            source_ref: `follow_up_of:${queuedQuestion.id}`,
            status: 'asked',
            keyword: currentKeywordEntry?.keyword || '',
          };
          try {
            await insertInterviewQuestionAfter({ sessionId, afterOrderNo: queuedQuestion.order_no, item: followUpItem });
            nextQuestion = { ...followUpItem, session_id: sessionId, order_no: queuedQuestion.order_no + 1 };
          } catch (err) {
            console.error('[interview.follow_up.insert_failed]', err);
          }
        } else {
          const generated = await generateFollowUpQuestion({
            queuedQuestion,
            answer,
            weaknesses: llmResult.weaknesses,
            interviewContext: interviewContext.contextText,
            sessionContext,
          });
          const followUpItem = { id: randomUUID(), ...generated, keyword: currentKeywordEntry?.keyword || '' };
          try {
            await insertInterviewQuestionAfter({ sessionId, afterOrderNo: queuedQuestion.order_no, item: followUpItem });
            nextQuestion = { ...followUpItem, session_id: sessionId, order_no: queuedQuestion.order_no + 1 };
          } catch (err) {
            console.error('[interview.follow_up.insert_failed]', err);
          }
        }
      }

      // Save updated turns_used
      if (keywordQueue) {
        await updateSessionKeywordQueue({ sessionId, keywordQueueJson: JSON.stringify(keywordQueue) });
      }
    }
  }

  await emitPhase('planning', '准备下一题');
  if (!nextQuestion) {
    nextQuestion = await getNextInterviewQuestion(sessionId);
  }
  if (nextQuestion && nextQuestion.status === 'pending') {
    await updateInterviewQuestionStatus({ questionId: nextQuestion.id, status: 'asked' });
    nextQuestion = { ...nextQuestion, status: 'asked' };
  }
  await emitPhase('persist', '数据整理入库');

  return {
    session_id: sessionId,
    question_id: queuedQuestion?.id || null,
    turn_id: turnId,
    turn_index: turnIndex,
    intent: llmResult.intent,
    intent_confidence: llmResult.intent_confidence,
    intent_reason: llmResult.intent_reason,
    handled_as: 'answer',
    resolved_question_type: llmResult.question_type,
    question_type_reason: llmResult.question_type_reason,
    current_question_status: 'answered',
    score: llmResult.score,
    dimension_scores: llmResult.dimension_scores,
    strengths: llmResult.strengths,
    weaknesses: llmResult.weaknesses,
    feedback: llmResult.feedback,
    standard_answer: llmResult.standard_answer,
    evaluation_text: llmResult.content,
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

// --- Legacy pipeline (5+ LLM calls) ---
const submitInterviewTurnLegacy = async ({ sessionId, body, onPhase, onToken, sessionContext }) => {
  const turnStartedAt = Date.now();
  const emitPhase = async (phase, message) => {
    if (typeof onPhase === 'function') {
      await onPhase(phase, message);
    }
  };

  const questionId = String(body.question_id || '').trim();
  const queuedQuestion = questionId ? await getInterviewQuestionById(questionId) : null;
  const question = String(body.question || queuedQuestion?.stem || '').trim();
  const answer = String(body.answer || '').trim();

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

  const session = await getInterviewSession(sessionId);
  if (!session) {
    throw createHttpError(404, 'session not found');
  }
  if (session.status !== 'in_progress') throw new Error('session is not in progress');

  const turns = await listInterviewTurns(sessionId);
  const turnIndex = turns.length + 1;
  const interviewContext = await buildInterviewContextWindow({
    turns,
    currentQuestion: question,
    sessionContext,
  });
  const user = await getUserById(session.user_id);
  const activeJd = user?.active_jd_file
    ? await readJdDoc({ userId: session.user_id, fileName: user.active_jd_file })
    : null;
  const resumeSummary = String(user?.resume_summary || '').trim();
  const jobDescription = String(activeJd?.content || '').trim();

  await emitPhase('intent', '接收回答');
  const intentResult = await classifyInterviewTurnIntent({
    question,
    input: answer,
    interviewContext: interviewContext.contextText,
    sessionContext,
  });

  if (intentResult.intent !== 'answer') {
    if (intentResult.intent === 'skip') {
      await emitPhase('planning', '准备下一题');
      if (queuedQuestion) {
        await updateInterviewQuestionStatus({ questionId: queuedQuestion.id, status: 'skipped' });
      }
      let nextQuestion = await getNextInterviewQuestion(sessionId);
      if (nextQuestion && nextQuestion.status === 'pending') {
        await updateInterviewQuestionStatus({ questionId: nextQuestion.id, status: 'asked' });
        nextQuestion = { ...nextQuestion, status: 'asked' };
      }
      const replyText = await generateInterviewerReply({
        intent: 'skip',
        queuedQuestion,
        input: answer,
        interviewContext: interviewContext.contextText,
        onToken,
        sessionContext,
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

    await emitPhase('reply', '接收回答');
    const replyText = await generateInterviewerReply({
      intent: intentResult.intent,
      queuedQuestion,
      input: answer,
      interviewContext: interviewContext.contextText,
      onToken,
      sessionContext,
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

  await emitPhase('question_type', '评估回答');
  const questionTypeResult = await classifyQuestionType({
    question,
    answer,
    queuedQuestionType: queuedQuestion?.question_type || '',
    interviewContext: interviewContext.contextText,
    sessionContext,
  });

  const rawEvidenceRefs = [];

  await emitPhase('evaluation', '评估回答');
  const {
    score,
    dimension_scores,
    strengths,
    weaknesses,
    feedback,
    standard_answer,
    knowledge_boundary,
  } = await enhanceEvaluationWithLLM({
    question,
    answer,
    evidenceRefs: rawEvidenceRefs,
    interviewContext: interviewContext.contextText,
    resumeSummary,
    jobDescription,
    questionType: questionTypeResult.question_type,
    sessionContext,
  });

  await emitPhase('feedback', '评估回答');
  console.log('[interview.turn.timing.before_narration]', {
    session_id: sessionId,
    elapsed_ms: Date.now() - turnStartedAt,
    score,
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
    sessionContext,
  });

  const turnId = randomUUID();
  await addInterviewTurn({
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
    await updateInterviewQuestionStatus({ questionId: queuedQuestion.id, status: 'answered' });
    const queueItems = await listInterviewQuestions(sessionId);
    await emitPhase('planning', '准备下一题');
    const needsFollowUp = shouldInsertFollowUp({
      queuedQuestion,
      score,
      weaknesses,
      queueItems,
    });

    if (needsFollowUp) {
      await emitPhase('reply', '准备下一题');
      const followUp = await selectOrGenerateFollowUp({
        queuedQuestion,
        answer,
        knowledgeBoundary: knowledge_boundary,
        weaknesses,
        interviewContext: interviewContext.contextText,
        sessionContext,
        generateFollowUpQuestion,
      });
      const followUpItem = {
        id: randomUUID(),
        ...followUp,
      };
      try {
        await insertInterviewQuestionAfter({
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

  await emitPhase('planning', '准备下一题');
  if (!nextQuestion) {
    nextQuestion = await getNextInterviewQuestion(sessionId);
  }
  if (nextQuestion && nextQuestion.status === 'pending') {
    await updateInterviewQuestionStatus({ questionId: nextQuestion.id, status: 'asked' });
    nextQuestion = { ...nextQuestion, status: 'asked' };
  }
  await emitPhase('persist', '数据整理入库');

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
    current_question_status: 'answered',
    score,
    dimension_scores,
    strengths,
    weaknesses,
    feedback,
    standard_answer,
    evaluation_text: evaluationText,
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

// --- Dispatcher ---
const submitInterviewTurn = USE_UNIFIED_PIPELINE
  ? submitInterviewTurnUnified
  : submitInterviewTurnLegacy;

module.exports = {
  submitInterviewTurn,
};
