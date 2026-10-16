const { randomUUID } = require('node:crypto');
const { createHttpError } = require('../../http');
const { getUserById } = require('../../db');
const { readJdDoc } = require('../../doc');
const { createInterviewTurnPlan } = require('../turn-commit');
const { buildBudgetedTurnContext } = require('../turn-context');
const { excerpt, countTokens } = require('../token-budget');
const { listCompletedSubmissions, getSubmission } = require('../answer-submission');
const { evaluationSchema, parseEvaluation } = require('../../agent-runtime/codex/evaluation');
const { buildDirectorBundle, parseDirectorDecision, buildQuestionBundle, parseDesignedQuestion, validateToolArgs } = require('./contracts');
const { saveArtifact, assertLive } = require('./artifact-store');
const { AgentRuntimeError } = require('../../agent-runtime/contracts');
const invalid = () => new AgentRuntimeError('invalid_output', 'Director referenced an unavailable specialist artifact');
const publicQuestion = (question) => question ? Object.fromEntries(['id', 'order_no', 'stem', 'source', 'question_type', 'difficulty', 'status'].map((key) => [key, question[key]])) : null;

function conversationHistory(turns, submissions) {
  const timestamp = (value) => value instanceof Date ? value.toISOString() : String(value || '');
  const linked = new Set(submissions.map((row) => row.result.turn_id).filter(Boolean));
  return [...turns.filter((turn) => !linked.has(turn.id)), ...submissions.map((row) => ({
    ...row, score: row.result.score, strengths: row.result.strengths, weaknesses: row.result.weaknesses,
    reply_text: row.result.reply_text || row.result.evaluation_text, action: row.result.agent_decision?.action || row.result.handled_as,
  }))].sort((a, b) => timestamp(a.created_at).localeCompare(timestamp(b.created_at)) || a.id.localeCompare(b.id))
    .map((row, index) => ({ ...row, turn_index: index + 1 }));
}
function validateEvaluation(result, input) {
  if (!result || !['answer', 'clarify', 'question_back', 'skip', 'meta', 'invalid'].includes(result.intent)) throw invalid();
  const raw = result.intent === 'answer'
    ? Object.fromEntries(Object.keys(evaluationSchema.properties).map((key) => [key, key === 'total_score' ? result.score : result[key]]))
    : { intent: result.intent, intent_confidence: result.intent_confidence, content: result.content };
  return parseEvaluation(JSON.stringify({ result: raw }), input);
}
async function submitInterviewTurnDirector({ sessionId, body, sessionContext, submission, signal, onPhase, onToken }) {
  assertLive(signal);
  if (!submission?.attempt_id || submission.session_id !== sessionId || submission.status !== 'running') throw createHttpError(409, '面试提交尚未领取');
  const live = await getSubmission(sessionId, submission.id);
  if (live?.attempt_id !== submission.attempt_id || live.status !== 'running') throw createHttpError(409, '面试提交已变化');
  const plan = await createInterviewTurnPlan(sessionId, { signal, submission });
  const session = await plan.getInterviewSession();
  if (!session || session.user_id !== sessionContext?.userId) throw createHttpError(403, 'forbidden');
  const current = await plan.getNextInterviewQuestion();
  if (session.status !== 'in_progress' || !current || current.id !== submission.question_id
    || current.stem !== submission.question || body.question_id !== current.id
    || body.question !== submission.question || body.answer !== submission.answer) throw createHttpError(409, '请提交当前面试题目的回答');
  const turns = await plan.listInterviewTurns();
  const questions = await plan.listInterviewQuestions();
  const queue = await plan.getSessionKeywordQueue();
  const active = queue?.entries.find((entry) => entry.status === 'active');
  const user = await getUserById(session.user_id);
  const jd = user?.active_jd_file ? await readJdDoc({ userId: session.user_id, fileName: user.active_jd_file }) : null;
  const input = {
    question: submission.question, answer: submission.answer, questionTypeHint: current.question_type,
    resumeSummary: String(user?.resume_summary || ''), jobDescription: String(jd?.content || ''), evidenceRefs: [],
    allowed_topics: [...new Set([...(queue?.entries || []).map((entry) => entry.keyword), ...questions.map((question) => question.keyword)].filter(Boolean))],
    current_question: { ...publicQuestion(current), topic: current.keyword || null },
    remaining_questions: questions.filter((question) => question.status === 'pending' && question.id !== current.id)
      .map((question) => ({ ...publicQuestion(question), topic: question.keyword || null })),
    counts: { scored: turns.length, pending: questions.filter((question) => question.status === 'pending').length },
    keyword_coverage: queue || null,
  };
  const history = conversationHistory(turns, await listCompletedSubmissions(sessionId));
  const context = buildBudgetedTurnContext({ input, turns: history, buildBundle: buildDirectorBundle,
    additionalInputReserve: 16384,
    serializeTurn: (turn) => JSON.stringify({ turn_index: turn.turn_index, question: turn.question, answer: turn.answer,
      score: turn.score, strengths: turn.strengths, weaknesses: turn.weaknesses, reply_text: turn.reply_text, action: turn.action }) });
  const boundInput = { ...input, interviewContext: context.contextText, contextBudget: context.metadata };
  // This map is the sole reference authority; durable artifacts from older
  // attempts are audit records and can never be selected for this commit.
  const artifacts = new Map();
  await onPhase?.('evaluation', '面试官正在分析回答');
  const output = await require('../../agent-runtime/codex/interview-runner').runCodexInterviewDirector({
    interviewSessionId: sessionId, input: boundInput, signal, onPhase,
    taskSpec: { taskType: 'direct-interview', buildBundle: buildDirectorBundle, parseOutput: parseDirectorDecision },
    onTool: async ({ name, args, callId, signal: toolSignal, runChild }) => {
      assertLive(signal); assertLive(toolSignal);
      if (name !== 'run_expert') throw invalid();
      validateToolArgs(args, boundInput);
      // Bind exactly the host's original material. purpose/topic are instructions
      // only for question design, never replacements for the grading evidence.
      let result;
      if (args.expert === 'evaluate_answer') {
        const evaluationInput = { question: input.question, answer: input.answer, questionTypeHint: input.questionTypeHint,
          interviewContext: context.contextText, resumeSummary: input.resumeSummary, jobDescription: input.jobDescription, evidenceRefs: [] };
        result = validateEvaluation(await runChild({ input: evaluationInput }), evaluationInput);
      } else {
        const questionInput = { ...boundInput, purpose: args.purpose, topic: args.topic };
        const raw = await runChild({ taskSpec: { taskType: 'design-question', buildBundle: buildQuestionBundle, parseOutput: parseDesignedQuestion }, input: questionInput });
        const { agent_runtime, ...question } = raw;
        result = parseDesignedQuestion(JSON.stringify({ question }), questionInput);
      }
      assertLive(signal); assertLive(toolSignal);
      const persistenceSignal = signal && toolSignal ? AbortSignal.any([signal, toolSignal]) : toolSignal || signal;
      const artifact = await saveArtifact({ submission, expert: args.expert, callId, result, signal: persistenceSignal });
      assertLive(signal); assertLive(toolSignal);
      artifacts.set(artifact.artifact_id, structuredClone(artifact));
      // Only a short sanitized evidence summary is returned to the main agent.
      const summary = args.expert === 'evaluate_answer' ? {
        intent: result.intent, score: result.intent === 'answer' ? result.score : null,
        strengths: result.strengths.map((text) => excerpt(text, 128, context.metadata.encoding)),
        weaknesses: result.weaknesses.map((text) => excerpt(text, 128, context.metadata.encoding)),
        feedback: excerpt(result.feedback, 512, context.metadata.encoding),
      } : { ...result, stem: excerpt(result.stem, 512, context.metadata.encoding),
        expected_points: result.expected_points.map((text) => excerpt(text, 128, context.metadata.encoding)) };
      if (countTokens(JSON.stringify(summary), context.metadata.encoding) > 8192) throw invalid();
      return { artifact_id: artifact.artifact_id, expert: artifact.expert, result: summary };
    },
  });
  assertLive(signal);
  const { agent_runtime, ...rawDecision } = output;
  const decision = parseDirectorDecision(JSON.stringify({ decision: rawDecision }), boundInput);
  const lookup = (ref, expert) => {
    if (ref === null) return null;
    const artifact = artifacts.get(ref);
    if (!artifact || artifact.expert !== expert) throw invalid();
    return artifact.result;
  };
  const evaluation = lookup(decision.evaluation_ref, 'evaluate_answer');
  const designed = lookup(decision.question_ref, 'design_question');
  if (evaluation && evaluation.intent !== 'answer') throw invalid();
  const scored = Boolean(evaluation);
  const turnId = scored ? randomUUID() : null;
  if (scored) {
    await plan.addInterviewTurn({ id: turnId, questionId: current.id, turnIndex: turns.length + 1,
      question: submission.question, answer: submission.answer, score: evaluation.score,
      strengths: evaluation.strengths, weaknesses: evaluation.weaknesses, evidenceRefsCount: 0 });
    await plan.updateInterviewQuestionStatus({ questionId: current.id, status: 'answered' });
    if (active) active.turns_used = (active.turns_used || 0) + 1;
  } else if (decision.action === 'skip') await plan.updateInterviewQuestionStatus({ questionId: current.id, status: 'skipped' });
  let next;
  if (designed) {
    const item = { id: randomUUID(), source: 'llm', stem: designed.stem, expected_points: designed.expected_points,
      question_type: decision.action === 'follow_up' ? 'follow_up' : designed.question_type, difficulty: designed.difficulty,
      keyword: decision.action === 'follow_up' ? (active?.keyword || current.keyword || '') : (designed.topic || active?.keyword || ''), status: 'asked' };
    await plan.insertInterviewQuestionAfter({ afterOrderNo: current.order_no, item });
    next = await plan.getInterviewQuestionById(item.id);
  } else if (decision.next_question_id) {
    await plan.promotePendingQuestion({ questionId: decision.next_question_id, afterQuestionId: current.id });
    next = await plan.getInterviewQuestionById(decision.next_question_id);
  } else if (decision.action !== 'finish') next = await plan.getNextInterviewQuestion();
  if (next && next.status === 'pending') {
    await plan.updateInterviewQuestionStatus({ questionId: next.id, status: 'asked' });
    next.status = 'asked';
  }
  if (queue) {
    if (next?.keyword && next.keyword !== active?.keyword && decision.action !== 'follow_up') {
      if (active) { active.status = 'completed'; if (evaluation) active.proficiency = { summary: evaluation.feedback, score: evaluation.score, strengths: evaluation.strengths, weaknesses: evaluation.weaknesses }; }
      const target = queue.entries.find((entry) => entry.keyword === next.keyword);
      if (target) target.status = 'active';
    }
    await plan.updateSessionKeywordQueue({ keywordQueueJson: JSON.stringify(queue) });
  }
  if (decision.action === 'finish' || (decision.action === 'skip' && !next)) await plan.finishInterviewSession();
  const result = {
    submission_id: submission.id, session_id: sessionId, question_id: current.id, turn_id: turnId, turn_index: turns.length + 1,
    intent: scored ? 'answer' : decision.action === 'finish' ? 'meta' : decision.action,
    handled_as: scored ? 'answer' : decision.action === 'skip' ? 'skip' : decision.action === 'finish' ? 'finish' : 'non_answer',
    current_question_status: scored ? 'answered' : decision.action === 'skip' ? 'skipped' : current.status,
    evaluation_text: decision.reply_text, reply_text: decision.reply_text, standard_answer: '',
    next_question: session.status === 'completed' ? null : publicQuestion(next),
    session_status: session.status, ended_at: session.ended_at || null,
    agent_decision: { action: decision.action, reason: decision.reason, evaluation_ref: decision.evaluation_ref, question_ref: decision.question_ref },
    agent_runtime,
    ...(scored ? { score: evaluation.score, dimension_scores: evaluation.dimension_scores, strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses, feedback: evaluation.feedback, resolved_question_type: evaluation.question_type,
      question_type_reason: evaluation.question_type_reason } : {}),
  };
  await onPhase?.('persist', '正在保存面试进度');
  await plan.commit(result);
  await onToken?.(result.reply_text);
  return result;
}
module.exports = { submitInterviewTurnDirector, conversationHistory };
