const { getWeaknessesByUser, listAttemptsByUser, listQuestionBank, listPracticeQuestions, markQuestionReviewed } = require('../db');
const { json, jsonError, parseNumberOrFallback, readBody, requirePathSegment } = require('../http');
const { getResolvedUserContext } = require('../request-context');

const getWeaknessesResponse = ({ pathname, searchParams }) => {
  const userId = requirePathSegment(pathname, 3, 'user_id');
  if (!userId) {
    return { statusCode: 400, payload: { error: 'user_id is required' } };
  }
  const limit = parseNumberOrFallback(searchParams.get('limit') || 20, 20);
  return {
    statusCode: 200,
    payload: { user_id: userId, items: getWeaknessesByUser(userId, limit) },
  };
};

const listAttemptsResponse = ({ searchParams }) => {
  const userId = String(searchParams.get('user_id') || '').trim();
  if (!userId) {
    return { statusCode: 400, payload: { error: 'user_id is required' } };
  }
  const limit = parseNumberOrFallback(searchParams.get('limit') || 20, 20);
  return {
    statusCode: 200,
    payload: { user_id: userId, items: listAttemptsByUser(userId, limit) },
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
  const rows = listQuestionBank({
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
  const rows = listPracticeQuestions({
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
  await getResolvedUserContext({ req, requireAuth: true });
  const questionId = requirePathSegment(pathname, 3, 'question_id');
  const reviewStatus = String(body.review_status || 'done').trim();
  const nextReviewAt = String(body.next_review_at || '').trim();
  if (!['pending', 'done'].includes(reviewStatus)) {
    return { statusCode: 400, payload: { error: 'review_status must be pending or done' } };
  }
  const ok = markQuestionReviewed({
    questionId,
    reviewStatus,
    nextReviewAt: nextReviewAt || null,
  });
  if (!ok) {
    return { statusCode: 404, payload: { error: 'question not found' } };
  }
  return {
    statusCode: 200,
    payload: { id: questionId, review_status: reviewStatus, next_review_at: nextReviewAt || null },
  };
};

const handlePracticeRoutes = async ({ req, res, url }) => {
  if (req.method === 'GET' && url.pathname.startsWith('/v1/users/') && url.pathname.endsWith('/weaknesses')) {
    const result = getWeaknessesResponse({
      pathname: url.pathname,
      searchParams: url.searchParams,
    });
    json(res, result.statusCode, result.payload);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/attempts') {
    const result = listAttemptsResponse({ searchParams: url.searchParams });
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
    const result = getWeaknessesResponse({
      pathname: `/v1/users/${request.params.user_id}/weaknesses`,
      searchParams,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/attempts', async (request, reply) => {
    const searchParams = new URLSearchParams(request.query || {});
    const result = listAttemptsResponse({ searchParams });
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
