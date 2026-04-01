const { randomUUID } = require('crypto');
const {
  getUserById,
  listInterviewSessions,
  createInterviewSession,
  deleteInterviewSession,
  getInterviewSession,
  saveInterviewQuestions,
  getNextInterviewQuestion,
  listInterviewQuestions,
  listInterviewTurns,
  finishInterviewSession,
  countSessionsStartedOnUtcDate,
  getSessionKeywordQueue,
  updateSessionKeywordQueue,
} = require('../db');
const { readJdDoc } = require('../doc');
const { appendMemoryEntry } = require('../memory');
const { json, jsonError, parseNumberOrFallback, readBody, writeSse, flushSseFrame, getErrorMessage } = require('../http');
const { getResolvedUserContext, ensureLocalUserProfile, ensureSessionOwner } = require('../request-context');
const { summarizeLongTermMemory } = require('../interview/context-service');
const { generateInterviewQuestionQueue, generateKeywordQueue, generateQuestionForKeyword } = require('../interview/llm-service');
const { submitInterviewTurn } = require('../interview/turn-service');
const { searchExperienceQuestionItems } = require('../experience/service');
const { recallExperienceChains, recallQuestionForKeyword } = require('../experience/recall');
const { getEmbeddingCacheSize } = require('../experience/embedding-cache');
const { getLevel2Vocabulary } = require('../experience/knowledge-graph');
const { promoteInterviewRetrospectQuestions } = require('../question-bank/service');
const { getSessionLlmConfig } = require('../lib/session-llm-config-store');

const USE_KEYWORD_QUEUE = process.env.INTERVIEW_QUEUE_VERSION !== 'legacy';

const EXPERIENCE_QUERY_HINTS = [
  { label: 'React', patterns: ['react'] },
  { label: 'Vue', patterns: ['vue'] },
  { label: 'TypeScript', patterns: ['typescript', 'ts'] },
  { label: 'JavaScript', patterns: ['javascript', 'js'] },
  { label: '浏览器', patterns: ['浏览器'] },
  { label: '网络', patterns: ['网络', 'http'] },
  { label: '工程化', patterns: ['工程化', 'webpack', 'vite'] },
  { label: '性能优化', patterns: ['性能优化', '性能'] },
  { label: '移动端', patterns: ['移动端', 'h5', 'react native'] },
];

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

const buildRecalledQueueQuestions = (chains) =>
  chains.map((chain) => {
    const mainItem = (chain.items || []).find((i) => i.question_role === 'main') || chain.items?.[0];
    const followUpChain = (chain.items || []).filter((i) => i.question_role !== 'main');
    return {
      source: 'experience',
      question_type: chain.group_type === 'chain' ? 'project' : 'knowledge',
      difficulty: mainItem?.difficulty || 'medium',
      stem: mainItem?.question_text_normalized || mainItem?.question_text_raw || chain.canonical_question,
      expected_points: mainItem?.expected_points || [],
      resume_anchor: '',
      source_ref: `experience_group:${chain.id}`,
      status: 'pending',
      _follow_up_chain: followUpChain,
    };
  }).filter((item) => String(item.stem || '').trim());

const buildExperienceQuery = ({ resumeSummary = '', jobDescription = '' }) => {
  const sourceText = `${String(resumeSummary || '')}\n${String(jobDescription || '')}`.toLowerCase();
  const matchedTerms = EXPERIENCE_QUERY_HINTS
    .filter(({ patterns }) => patterns.some((pattern) => sourceText.includes(pattern)))
    .map(({ label }) => label);

  const uniqueTerms = Array.from(new Set(matchedTerms)).slice(0, 3);
  return ['前端', '面经', ...uniqueTerms].join(' ');
};

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

  if (
    req.method === 'GET'
    && /^\/v1\/interview\/sessions\/[^/]+$/.test(url.pathname)
  ) {
    try {
      const { session } = await ensureSessionOwner({ req, pathname: url.pathname });
      json(res, 200, session);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'DELETE'
    && /^\/v1\/interview\/sessions\/[^/]+$/.test(url.pathname)
  ) {
    try {
      const { session } = await ensureSessionOwner({ req, pathname: url.pathname });
      deleteInterviewSession(session.id);
      json(res, 200, { deleted: true });
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
      const user = ensureLocalUserProfile({ userId, authUser: context.authUser });
      const experienceQuery = String(body.experience_query || '').trim();
      if (!jobDescription && user.active_jd_file) {
        const activeJdDoc = readJdDoc({ userId, fileName: user.active_jd_file });
        jobDescription = String(activeJdDoc?.content || '').trim();
      }
      if (!jobDescription) return json(res, 400, { error: 'job_description is required' });
      const todayUsedCount = countSessionsStartedOnUtcDate({ userId });
      const hasUserSessionKey = Boolean(getSessionLlmConfig({ userId, token: context.token })?.apiKey);
      if (todayUsedCount >= 1 && !hasUserSessionKey) {
        return json(res, 403, {
          error: 'NEED_USER_LLM_KEY',
          free_limit: 1,
          used_today: todayUsedCount,
          remaining_free: 0,
          message: '请先上传 session 级 LLM Key 后再启动本日更多模拟面试',
        });
      }

      const sessionId = randomUUID();
      const session = createInterviewSession({ id: sessionId, userId });

      if (USE_KEYWORD_QUEUE) {
        // --- Keyword queue driven flow ---
        const resumeStructured = (() => {
          try { return JSON.parse(user?.resume_structured_json || ''); } catch { return null; }
        })();
        const level2Vocabulary = getLevel2Vocabulary();

        const keywordEntries = await generateKeywordQueue({
          resumeStructured,
          jobDescription,
          targetLevel,
          level2Vocabulary,
          sessionContext: { userId, token: context.token },
        });

        if (keywordEntries.length > 0) {
          keywordEntries[0].status = 'active';
        }
        const keywordQueueJson = JSON.stringify({
          max_turns_per_keyword: 3,
          entries: keywordEntries,
        });
        updateSessionKeywordQueue({ sessionId, keywordQueueJson });

        // Self-intro question (fixed template)
        const selfIntroQuestion = {
          id: randomUUID(),
          order_no: 1,
          source: 'llm',
          question_type: 'basic',
          difficulty: 'easy',
          stem: '请先做一个简短的自我介绍，重点讲讲你最有代表性的一段项目经历。',
          expected_points: ['个人背景', '核心项目', '技术栈', '个人职责', '项目成果'],
          resume_anchor: '',
          source_ref: 'self_intro_template',
          status: 'asked',
          keyword: '',
        };

        // Recall first keyword's question from experience bank
        const firstKeyword = keywordEntries[0];
        let firstKeywordQuestion = null;
        if (firstKeyword) {
          const recalled = await recallQuestionForKeyword({
            keyword: firstKeyword.keyword,
            resumeAnchor: firstKeyword.resume_anchor,
            targetLevel,
            sessionContext: { userId, token: context.token },
          });
          if (recalled) {
            const mainItem = (recalled.items || []).find((i) => i.question_role === 'main') || recalled.items?.[0];
            const followUpChain = (recalled.items || []).filter((i) => i.question_role !== 'main');
            firstKeywordQuestion = {
              id: randomUUID(),
              order_no: 2,
              source: 'experience',
              question_type: mainItem?.category === 'project' ? 'project' : 'knowledge',
              difficulty: mainItem?.difficulty || 'medium',
              stem: mainItem?.question_text_normalized || mainItem?.question_text_raw || recalled.canonical_question,
              expected_points: mainItem?.expected_points || [],
              resume_anchor: firstKeyword.resume_anchor,
              source_ref: `experience_group:${recalled.id}`,
              status: 'pending',
              keyword: firstKeyword.keyword,
              _follow_up_chain: followUpChain,
            };
          }
        }

        // Fallback: generate via LLM if recall failed
        if (!firstKeywordQuestion && firstKeyword) {
          firstKeywordQuestion = await generateQuestionForKeyword({
            keyword: firstKeyword.keyword,
            resumeAnchor: firstKeyword.resume_anchor,
            resumeSummary: user?.resume_summary || '',
            jobDescription,
            targetLevel,
            sessionContext: { userId, token: context.token },
          });
          firstKeywordQuestion.order_no = 2;
          firstKeywordQuestion.keyword = firstKeyword.keyword;
        }

        const queueItems = [selfIntroQuestion, firstKeywordQuestion].filter(Boolean);
        saveInterviewQuestions({ sessionId, items: queueItems });
        const currentQuestion = selfIntroQuestion;

        json(res, 200, {
          ...session,
          interview_mode: 'keyword_driven',
          job_description_present: true,
          target_level: targetLevel,
          queue_count: queueItems.length,
          keyword_queue: keywordEntries.map((e) => ({ keyword: e.keyword, category: e.category, status: e.status })),
          current_question: {
            id: currentQuestion.id,
            order_no: currentQuestion.order_no,
            stem: currentQuestion.stem,
            source: currentQuestion.source,
            question_type: currentQuestion.question_type,
            difficulty: currentQuestion.difficulty,
            status: currentQuestion.status,
          },
        });
      } else {
        // --- Legacy: pre-generate 5 questions ---
        let queueItems = await generateInterviewQuestionQueue({
          user,
          jobDescription,
          targetLevel,
          sessionContext: { userId, token: context.token },
        });
        const resolvedExperienceQuery = experienceQuery || buildExperienceQuery({
          resumeSummary: user?.resume_summary || '',
          jobDescription,
        });

        let experienceQuestions = [];
        if (useExperienceQuestions) {
          const resumeStructured = (() => {
            try { return JSON.parse(user?.resume_structured_json || ''); } catch { return null; }
          })();
          if (resumeStructured?.projects?.length > 0) {
            const chains = await recallExperienceChains({
              resumeStructured,
              targetLevel,
              limit: 2,
              sessionContext: { userId, token: context.token },
            });
            experienceQuestions = buildRecalledQueueQuestions(chains);
          }
          if (experienceQuestions.length === 0 && resolvedExperienceQuery) {
            experienceQuestions = buildExperienceQueueQuestions({
              query: resolvedExperienceQuery,
              limit: 2,
            });
          }
        }
        queueItems = mergeExperienceQuestionsIntoQueue({ queueItems, experienceQuestions });
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
      }
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
      const ownership = await ensureSessionOwner({
        req,
        pathname: url.pathname,
        bodyUserId: String(body.user_id || '').trim(),
      });
      ({ sessionId } = ownership);

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

      await writeStage('preparing', '已接收回答，正在准备...');
      const result = await submitInterviewTurn({
        sessionId,
        body,
        onPhase: writeStage,
        onToken: writeToken,
        sessionContext: {
          userId: ownership.context.userId,
          token: ownership.context.token,
        },
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
    req.method === 'GET'
    && /^\/v1\/interview\/sessions\/[^/]+\/turns$/.test(url.pathname)
  ) {
    try {
      const { sessionId } = await ensureSessionOwner({ req, pathname: url.pathname });
      json(res, 200, {
        session_id: sessionId,
        items: listInterviewTurns(sessionId),
      });
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/interview\/sessions\/[^/]+\/turns$/.test(url.pathname)
  ) {
    try {
      const body = await readBody(req);
      const ownership = await ensureSessionOwner({
        req,
        pathname: url.pathname,
        bodyUserId: String(body.user_id || '').trim(),
      });
      json(res, 200, await submitInterviewTurn({
        sessionId: ownership.sessionId,
        body,
        sessionContext: {
          userId: ownership.context.userId,
          token: ownership.context.token,
        },
      }));
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
    && /^\/v1\/interview\/sessions\/[^/]+\/report$/.test(url.pathname)
  ) {
    try {
      const { sessionId, context } = await ensureSessionOwner({ req, pathname: url.pathname });
      const session = getInterviewSession(sessionId);
      const keywordQueue = getSessionKeywordQueue(sessionId);
      if (!keywordQueue) {
        return json(res, 400, { error: 'session has no keyword queue (legacy mode)' });
      }
      const turns = listInterviewTurns(sessionId);
      const user = getUserById(session.user_id);
      const activeJd = user?.active_jd_file
        ? readJdDoc({ userId: session.user_id, fileName: user.active_jd_file })
        : null;

      const { generateInterviewReport } = require('../interview/llm-service');
      const report = await generateInterviewReport({
        keywordQueue,
        turns,
        resumeSummary: user?.resume_summary || '',
        jobDescription: String(activeJd?.content || '').trim(),
        sessionContext: { userId: context.userId, token: context.token },
      });
      json(res, 200, report);
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
