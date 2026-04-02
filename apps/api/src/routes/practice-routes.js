const { getWeaknessesByUser, listAttemptsByUser } = require('../db');
const { json, jsonError, parseNumberOrFallback, readBody, requirePathSegment } = require('../http');
const { getResolvedUserContext } = require('../request-context');
const {
  addQuestionToUserBank,
  listStructuredUserQuestionBank,
  listUnifiedPracticeQuestions,
  listUnifiedQuestionBank,
  promoteQuestionSource,
  recordQuestionAttempt,
  reviewUnifiedQuestion,
} = require('../question-bank/service');

const ALLOWED_QUESTION_ATTEMPT_SESSION_TYPES = ['interview'];

const getWeaknessesResponse = async ({ pathname, searchParams }) => {
  const userId = requirePathSegment(pathname, 3, 'user_id');
  if (!userId) {
    return { statusCode: 400, payload: { error: 'user_id is required' } };
  }
  const limit = parseNumberOrFallback(searchParams.get('limit') || 20, 20);
  return {
    statusCode: 200,
    payload: { user_id: userId, items: await getWeaknessesByUser(userId, limit) },
  };
};

const listAttemptsResponse = async ({ searchParams }) => {
  const userId = String(searchParams.get('user_id') || '').trim();
  if (!userId) {
    return { statusCode: 400, payload: { error: 'user_id is required' } };
  }
  const limit = parseNumberOrFallback(searchParams.get('limit') || 20, 20);
  return {
    statusCode: 200,
    payload: { user_id: userId, items: await listAttemptsByUser(userId, limit) },
  };
};

const questionBankResponse = async ({ req, searchParams }) => {
  const context = await getResolvedUserContext({
    req,
    queryUserId: String(searchParams.get('user_id') || '').trim(),
    requireAuth: true,
  });
  const chapter = String(searchParams.get('chapter') || '').trim();
  const limit = Number(searchParams.get('limit') || 20);
  const rows = await listUnifiedQuestionBank({
    userId: context.userId,
    chapter: chapter || undefined,
    limit: parseNumberOrFallback(limit, 20),
  });
  return {
    statusCode: 200,
    payload: { user_id: context.userId, chapter: chapter || null, items: rows },
  };
};

const nextPracticeResponse = async ({ req, searchParams }) => {
  const context = await getResolvedUserContext({
    req,
    queryUserId: String(searchParams.get('user_id') || '').trim(),
    requireAuth: true,
  });
  const chapter = String(searchParams.get('chapter') || '').trim();
  const includeFuture = String(searchParams.get('include_future') || '0') === '1';
  const limit = Number(searchParams.get('limit') || 10);
  const rows = await listUnifiedPracticeQuestions({
    userId: context.userId,
    chapter: chapter || undefined,
    limit: parseNumberOrFallback(limit, 10),
    includeFuture,
  });
  return {
    statusCode: 200,
    payload: {
      user_id: context.userId,
      chapter: chapter || null,
      include_future: includeFuture,
      items: rows,
    },
  };
};

const reviewQuestionResponse = async ({ req, pathname, body }) => {
  const context = await getResolvedUserContext({ req, requireAuth: true });
  const questionId = requirePathSegment(pathname, 3, 'question_id');
  const reviewStatus = String(body.review_status || 'done').trim();
  const nextReviewAt = String(body.next_review_at || '').trim();
  if (!['pending', 'done'].includes(reviewStatus)) {
    return { statusCode: 400, payload: { error: 'review_status must be pending or done' } };
  }
  const result = await reviewUnifiedQuestion({
    userId: context.userId,
    questionId,
    reviewStatus,
    nextReviewAt: nextReviewAt || null,
  });
  if (!result) {
    return { statusCode: 404, payload: { error: 'question not found' } };
  }
  return {
    statusCode: 200,
    payload: result,
  };
};

const promoteQuestionSourceResponse = async ({ req, body }) => {
  await getResolvedUserContext({ req, requireAuth: true });
  const sourceType = String(body.source_type || '').trim();
  const sourceRefId = String(body.source_ref_id || '').trim();
  const canonicalQuestion = String(body.canonical_question || '').trim();
  const questionText = String(body.question_text || '').trim();

  if (!sourceType) return { statusCode: 400, payload: { error: 'source_type is required' } };
  if (!sourceRefId) return { statusCode: 400, payload: { error: 'source_ref_id is required' } };
  if (!canonicalQuestion) return { statusCode: 400, payload: { error: 'canonical_question is required' } };
  if (!questionText) return { statusCode: 400, payload: { error: 'question_text is required' } };

  const result = await promoteQuestionSource({
    sourceType,
    sourceRefId,
    canonicalQuestion,
    questionText,
    normalizedQuestion: String(body.normalized_question || '').trim(),
    category: String(body.category || '').trim(),
    difficulty: String(body.difficulty || 'medium').trim(),
    track: String(body.track || 'frontend').trim(),
    chapter: String(body.chapter || '').trim(),
    knowledgePoints: Array.isArray(body.knowledge_points) ? body.knowledge_points : [],
    expectedPoints: Array.isArray(body.expected_points) ? body.expected_points : [],
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : {},
  });

  return {
    statusCode: 200,
    payload: result,
  };
};

const addUserQuestionBankResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({ req, requireAuth: true });
  const questionSourceId = String(body.question_source_id || '').trim();
  if (!questionSourceId) {
    return { statusCode: 400, payload: { error: 'question_source_id is required' } };
  }

  const result = await addQuestionToUserBank({
    userId: context.userId,
    questionSourceId,
    track: String(body.track || '').trim(),
    chapter: String(body.chapter || '').trim(),
    customQuestionText: String(body.custom_question_text || '').trim(),
    sourceChannel: String(body.source_channel || '').trim(),
  });

  return {
    statusCode: 200,
    payload: result,
  };
};

const listUserQuestionBankResponse = async ({ req, searchParams }) => {
  const context = await getResolvedUserContext({
    req,
    queryUserId: String(searchParams.get('user_id') || '').trim(),
    requireAuth: true,
  });

  const result = await listStructuredUserQuestionBank({
    userId: context.userId,
    track: String(searchParams.get('track') || '').trim() || undefined,
    chapter: String(searchParams.get('chapter') || '').trim() || undefined,
    reviewStatus: String(searchParams.get('review_status') || '').trim() || undefined,
    limit: parseNumberOrFallback(searchParams.get('limit') || 20, 20),
    offset: parseNumberOrFallback(searchParams.get('offset') || 0, 0),
  });

  return {
    statusCode: 200,
    payload: {
      user_id: context.userId,
      items: result.items,
      total: result.total,
    },
  };
};

const createQuestionAttemptResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({ req, requireAuth: true });
  const userQuestionBankId = String(body.user_question_bank_id || '').trim();
  const sessionType = String(body.session_type || '').trim();
  const answer = String(body.answer || '').trim();

  if (!userQuestionBankId) {
    return { statusCode: 400, payload: { error: 'user_question_bank_id is required' } };
  }
  if (!sessionType) {
    return { statusCode: 400, payload: { error: 'session_type is required' } };
  }
  if (!answer) {
    return { statusCode: 400, payload: { error: 'answer is required' } };
  }
  if (!ALLOWED_QUESTION_ATTEMPT_SESSION_TYPES.includes(sessionType)) {
    return {
      statusCode: 400,
      payload: {
        error: `session_type must be one of: ${ALLOWED_QUESTION_ATTEMPT_SESSION_TYPES.join(', ')}`,
      },
    };
  }

  const item = await recordQuestionAttempt({
    userId: context.userId,
    userQuestionBankId,
    sessionType,
    sessionId: String(body.session_id || '').trim() || null,
    answer,
    score: parseNumberOrFallback(body.score, 0),
    strengths: Array.isArray(body.strengths) ? body.strengths : [],
    weaknesses: Array.isArray(body.weaknesses) ? body.weaknesses : [],
    evidenceRefs: Array.isArray(body.evidence_refs) ? body.evidence_refs : [],
    feedback: String(body.feedback || '').trim(),
    mastered: body.mastered === true,
    nextReviewAt: String(body.next_review_at || '').trim() || null,
  });

  if (!item) {
    return {
      statusCode: 404,
      payload: { error: 'question not found' },
    };
  }

  return {
    statusCode: 200,
    payload: {
      item,
    },
  };
};

const handlePracticeRoutes = async ({ req, res, url }) => {
  if (req.method === 'GET' && url.pathname.startsWith('/v1/users/') && url.pathname.endsWith('/weaknesses')) {
    const result = await getWeaknessesResponse({
      pathname: url.pathname,
      searchParams: url.searchParams,
    });
    json(res, result.statusCode, result.payload);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/attempts') {
    const result = await listAttemptsResponse({ searchParams: url.searchParams });
    json(res, result.statusCode, result.payload);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/question-bank') {
    try {
      const result = await questionBankResponse({
        req,
        searchParams: url.searchParams,
      });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/question-sources/promote') {
    try {
      const body = await readBody(req);
      const result = await promoteQuestionSourceResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/user-question-bank') {
    try {
      const body = await readBody(req);
      const result = await addUserQuestionBankResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/user-question-bank') {
    try {
      const result = await listUserQuestionBankResponse({
        req,
        searchParams: url.searchParams,
      });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/question-attempts') {
    try {
      const body = await readBody(req);
      const result = await createQuestionAttemptResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/practice/next') {
    try {
      const result = await nextPracticeResponse({
        req,
        searchParams: url.searchParams,
      });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/question-bank\/[^/]+\/review$/.test(url.pathname)
  ) {
    try {
      const body = await readBody(req);
      const result = await reviewQuestionResponse({
        req,
        pathname: url.pathname,
        body,
      });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  return false;
};

async function registerPracticeRoutes(app) {
  app.get('/v1/users/:user_id/weaknesses', async (request, reply) => {
    const searchParams = new URLSearchParams(request.query || {});
    const result = await getWeaknessesResponse({
      pathname: `/v1/users/${request.params.user_id}/weaknesses`,
      searchParams,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/attempts', async (request, reply) => {
    const searchParams = new URLSearchParams(request.query || {});
    const result = await listAttemptsResponse({ searchParams });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/question-bank', async (request, reply) => {
    const searchParams = new URLSearchParams(request.query || {});
    const result = await questionBankResponse({
      req: request.raw,
      searchParams,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/question-sources/promote', async (request, reply) => {
    const result = await promoteQuestionSourceResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/user-question-bank', async (request, reply) => {
    const result = await addUserQuestionBankResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/user-question-bank', async (request, reply) => {
    const searchParams = new URLSearchParams(request.query || {});
    const result = await listUserQuestionBankResponse({
      req: request.raw,
      searchParams,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/question-attempts', async (request, reply) => {
    const result = await createQuestionAttemptResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/practice/next', async (request, reply) => {
    const searchParams = new URLSearchParams(request.query || {});
    const result = await nextPracticeResponse({
      req: request.raw,
      searchParams,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/question-bank/:question_id/review', async (request, reply) => {
    const result = await reviewQuestionResponse({
      req: request.raw,
      pathname: `/v1/question-bank/${request.params.question_id}/review`,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });
}

module.exports = {
  handlePracticeRoutes,
  registerPracticeRoutes,
};
