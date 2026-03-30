const { randomUUID } = require('crypto');
const { getUserById, listInterviewSessions, createInterviewSession, saveInterviewQuestions, getNextInterviewQuestion, listInterviewQuestions, listInterviewTurns, finishInterviewSession } = require('../db');
const { readJdDoc } = require('../doc');
const { appendMemoryEntry } = require('../memory');
const { json, jsonError, parseNumberOrFallback, readBody, writeSse, flushSseFrame, getErrorMessage } = require('../http');
const { getResolvedUserContext, ensureLocalUserProfile, ensureSessionOwner } = require('../request-context');
const { summarizeLongTermMemory } = require('../interview/context-service');
const { generateInterviewQuestionQueue } = require('../interview/llm-service');
const { submitInterviewTurn } = require('../interview/turn-service');
const { searchExperienceQuestionItems } = require('../experience/service');
const { promoteInterviewRetrospectQuestions } = require('../question-bank/service');

const buildExperienceQueueQuestions = ({ query, limit = 2 }) =>
  searchExperienceQuestionItems({ query, limit })
    .map((item) => ({
      source: 'experience',
      question_type: 'project',
      difficulty: item.difficulty || 'medium',
      stem: item.question_text_normalized || item.question_text_raw,
      expected_points: [],
      resume_anchor: '',
      source_ref: `experience:${item.id}`,
      status: 'pending',
    }))
    .filter((item) => String(item.stem || '').trim());

const mergeExperienceQuestionsIntoQueue = ({ queueItems, experienceQuestions = [] }) => {
  if (experienceQuestions.length === 0) {
    return queueItems;
  }

  const base = Array.isArray(queueItems) ? [...queueItems] : [];
  const first = base[0] ? [base[0]] : [];
  const middle = base.slice(1, Math.max(1, base.length - experienceQuestions.length));
  const merged = [...first, ...experienceQuestions, ...middle].slice(0, 5);

  return merged.map((item, index) => ({
    ...item,
    status: index === 0 ? 'asked' : 'pending',
  }));
};

const handleInterviewRoutes = async ({ req, res, url, corsHeaders }) => {
  if (req.method === 'GET' && url.pathname === '/v1/interview/sessions') {
    try {
      const context = await getResolvedUserContext({
        req,
        queryUserId: String(url.searchParams.get('user_id') || '').trim(),
        requireAuth: true,
      });
      const limit = parseNumberOrFallback(url.searchParams.get('limit') || 20, 20);
      json(res, 200, { user_id: context.userId, items: listInterviewSessions({ userId: context.userId, limit }) });
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/interview/sessions/start') {
    try {
      const body = await readBody(req);
      const context = await getResolvedUserContext({
        req,
        bodyUserId: String(body.user_id || '').trim(),
        requireAuth: true,
      });
      const userId = context.userId;
      let jobDescription = String(body.job_description || body.jd_text || '').trim();
      const targetLevel = String(body.target_level || 'mid').trim();
      const useExperienceQuestions = body.use_experience_questions === true;
      const experienceQuery = String(body.experience_query || '').trim();
      const user = ensureLocalUserProfile({ userId, authUser: context.authUser });
      if (!jobDescription && user.active_jd_file) {
        const activeJdDoc = readJdDoc({ userId, fileName: user.active_jd_file });
        jobDescription = String(activeJdDoc?.content || '').trim();
      }
      if (!jobDescription) return json(res, 400, { error: 'job_description is required' });

      const sessionId = randomUUID();
      const session = createInterviewSession({ id: sessionId, userId });
      let queueItems = await generateInterviewQuestionQueue({
        user,
        jobDescription,
        targetLevel,
      });
      const experienceQuestions = useExperienceQuestions && experienceQuery
        ? buildExperienceQueueQuestions({
          query: experienceQuery,
          limit: 2,
        })
        : [];
      queueItems = mergeExperienceQuestionsIntoQueue({
        queueItems,
        experienceQuestions,
      });
      saveInterviewQuestions({ sessionId, items: queueItems });
      const currentQuestion = getNextInterviewQuestion(sessionId);
      json(res, 200, {
        ...session,
        interview_mode: 'resume_jd',
        job_description_present: true,
        target_level: targetLevel,
        queue_count: queueItems.length,
        experience_question_count: experienceQuestions.length,
        queue_sources: Array.from(new Set(queueItems.map((item) => item.source))),
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
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'GET'
    && /^\/v1\/interview\/sessions\/[^/]+\/questions$/.test(url.pathname)
  ) {
    try {
      const { sessionId } = await ensureSessionOwner({ req, pathname: url.pathname });
      const items = listInterviewQuestions(sessionId);
      const currentQuestion = items.find((item) => item.status !== 'answered') || null;
      json(res, 200, {
        session_id: sessionId,
        items,
        current_question: currentQuestion,
      });
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/turns\/stream$/.test(url.pathname)
  ) {
    let sessionId = '';
    let closed = false;
    let streamRequestStartedAt = 0;
    let firstTokenSentAt = null;
    try {
      const body = await readBody(req);
      streamRequestStartedAt = Date.now();
      ({ sessionId } = await ensureSessionOwner({
        req,
        pathname: url.pathname,
        bodyUserId: String(body.user_id || '').trim(),
      }));

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
        console.warn('[interview.turn.stream.aborted]', { session_id: sessionId });
      });
      res.on('close', () => {
        if (closed) return;
        closed = true;
        console.warn('[interview.turn.stream.closed]', { session_id: sessionId });
      });

      console.log('[interview.turn.stream.start]', {
        session_id: sessionId,
        question_id: String(body.question_id || '').trim() || null,
        started_at: new Date(streamRequestStartedAt).toISOString(),
      });
      writeSse(res, 'meta', { session_id: sessionId, mode: 'interview_turn_stream' });
      await flushSseFrame();

      const writeStage = async (step, message) => {
        if (closed) return;
        console.log('[interview.turn.stream.stage]', { session_id: sessionId, step, message });
        writeSse(res, 'stage', { step, message });
        await flushSseFrame();
      };

      const writeToken = async (textChunk) => {
        if (closed || !textChunk) return;
        if (firstTokenSentAt === null) {
          firstTokenSentAt = Date.now();
          console.log('[interview.turn.stream.first_token_sent]', {
            session_id: sessionId,
            latency_ms: firstTokenSentAt - streamRequestStartedAt,
            length: String(textChunk).length,
            preview: String(textChunk).slice(0, 80),
          });
        }
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
        elapsed_ms: Date.now() - streamRequestStartedAt,
        first_token_latency_ms: firstTokenSentAt === null ? null : firstTokenSentAt - streamRequestStartedAt,
      });
      if (!closed) {
        writeSse(res, 'result', result);
        await flushSseFrame();
        writeSse(res, 'done', {
          turn_id: result.turn_id,
          next_question_id: result.next_question?.id || null,
        });
        closed = true;
        res.end();
      }
    } catch (error) {
      if (!res.headersSent) {
        jsonError(res, error);
      } else {
        closed = true;
        console.error('[interview.turn.stream.error]', {
          session_id: sessionId,
          error: getErrorMessage(error, 'stream failed'),
        });
        writeSse(res, 'error', { error: getErrorMessage(error, 'stream failed') });
        res.end();
      }
    }
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/turns$/.test(url.pathname)
  ) {
    try {
      const body = await readBody(req);
      const { sessionId } = await ensureSessionOwner({
        req,
        pathname: url.pathname,
        bodyUserId: String(body.user_id || '').trim(),
      });
      json(res, 200, await submitInterviewTurn({ sessionId, body }));
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/finish$/.test(url.pathname)
  ) {
    try {
      const body = await readBody(req);
      const summary = String(body.summary || '').trim();
      const { sessionId } = await ensureSessionOwner({
        req,
        pathname: url.pathname,
        bodyUserId: String(body.user_id || '').trim(),
      });
      json(res, 200, finishInterviewSession({ sessionId, summary }));
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/retrospect$/.test(url.pathname)
  ) {
    try {
      const body = await readBody(req);
      const chapter = String(body.chapter || '面试复盘').trim();
      const { session, sessionId } = await ensureSessionOwner({
        req,
        pathname: url.pathname,
        bodyUserId: String(body.user_id || '').trim(),
      });
      const turns = listInterviewTurns(sessionId);
      if (turns.length === 0) return json(res, 400, { error: 'no interview turns found' });
      const questionItems = listInterviewQuestions(sessionId);
      const questionMap = new Map(questionItems.map((item) => [item.id, item]));

      const avgScore = Math.round(turns.reduce((sum, turn) => sum + (turn.score || 0), 0) / turns.length);
      const strengthMap = new Map();
      const weaknessMap = new Map();
      for (const turn of turns) {
        for (const strength of turn.strengths || []) strengthMap.set(strength, (strengthMap.get(strength) || 0) + 1);
        for (const weakness of turn.weaknesses || []) weaknessMap.set(weakness, (weaknessMap.get(weakness) || 0) + 1);
      }
      const strengths = Array.from(strengthMap.entries()).sort((a, b) => b[1] - a[1]).map(([key]) => key).slice(0, 5);
      const weaknesses = Array.from(weaknessMap.entries()).sort((a, b) => b[1] - a[1]).map(([key]) => key).slice(0, 5);

      const nextReviewAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const promoteResult = promoteInterviewRetrospectQuestions({
        session,
        sessionId,
        chapter,
        turns,
        questionMap,
        nextReviewAt,
      });
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
        evidenceCount: turns.reduce((sum, turn) => sum + (turn.evidence_refs_count || 0), 0),
      });

      json(res, 200, {
        session_id: sessionId,
        user_id: session.user_id,
        chapter,
        avg_score: avgScore,
        turns_count: turns.length,
        strengths,
        weaknesses,
        long_term_memory: memorySummary,
        promoted_questions: promoteResult.items.length,
        promoted_new_questions: promoteResult.legacyStat.inserted,
        promoted_updated_questions: promoteResult.legacyStat.updated,
        promoted_source_created: promoteResult.sourceCreated,
        promoted_source_updated: promoteResult.sourceUpdated,
        promoted_user_bank_created: promoteResult.bankCreated,
        promoted_user_bank_updated: promoteResult.bankUpdated,
        memory_path: memoryPath,
      });
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  return false;
};

module.exports = {
  handleInterviewRoutes,
};
