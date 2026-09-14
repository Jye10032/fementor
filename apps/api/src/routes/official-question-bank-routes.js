const { json, jsonError, parseNumberOrFallback, requirePathSegment } = require('../http');
const { getResolvedUserContext } = require('../request-context');
const {
  getOfficialQuestionBankItem,
  getOfficialQuestionSourceStatus,
  importOfficialQuestionBankItem,
  listOfficialQuestionBank,
} = require('../official-question-bank/service');

const getOptionalUserId = async (req) => {
  const context = await getResolvedUserContext({
    req,
    requireAuth: false,
    allowDevFallback: false,
  });
  return context.userId || null;
};

const buildFilters = (searchParams) => ({
  query: String(searchParams.get('query') || '').trim(),
  track: String(searchParams.get('track') || '').trim(),
  chapter: String(searchParams.get('chapter') || '').trim(),
  difficulty: String(searchParams.get('difficulty') || '').trim(),
  category: String(searchParams.get('category') || '').trim(),
  limit: parseNumberOrFallback(searchParams.get('limit') || 20, 20),
  offset: parseNumberOrFallback(searchParams.get('offset') || 0, 0),
});

const listResponse = async ({ req, searchParams }) => {
  const filters = buildFilters(searchParams);
  const payload = await listOfficialQuestionBank({
    filters,
    userId: await getOptionalUserId(req),
  });
  return { statusCode: 200, payload: { ...payload, filters } };
};

const detailResponse = async ({ req, pathname }) => {
  const id = requirePathSegment(pathname, 3, 'question_id');
  return {
    statusCode: 200,
    payload: {
      item: await getOfficialQuestionBankItem({ id, userId: await getOptionalUserId(req) }),
      source: 'remote_official',
      read_only: true,
    },
  };
};

const importResponse = async ({ req, pathname }) => {
  const id = requirePathSegment(pathname, 3, 'question_id');
  const context = await getResolvedUserContext({ req, requireAuth: false, allowDevFallback: false });
  return {
    statusCode: 200,
    payload: await importOfficialQuestionBankItem({ id, userId: context.userId }),
  };
};

const handleOfficialQuestionBankRoutes = async ({ req, res, url }) => {
  if (req.method === 'GET' && url.pathname === '/v1/official-question-bank/status') {
    json(res, 200, await getOfficialQuestionSourceStatus());
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/v1/official-question-bank') {
    try {
      const result = await listResponse({ req, searchParams: url.searchParams });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }
  if (req.method === 'GET' && /^\/v1\/official-question-bank\/[^/]+$/.test(url.pathname)) {
    try {
      const result = await detailResponse({ req, pathname: url.pathname });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }
  if (req.method === 'POST' && /^\/v1\/official-question-bank\/[^/]+\/import$/.test(url.pathname)) {
    try {
      const result = await importResponse({ req, pathname: url.pathname });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }
  return false;
};

async function registerOfficialQuestionBankRoutes(app) {
  app.get('/v1/official-question-bank/status', async () => getOfficialQuestionSourceStatus());
  app.get('/v1/official-question-bank', async (request, reply) => {
    const result = await listResponse({
      req: request.raw,
      searchParams: new URLSearchParams(request.query || {}),
    });
    reply.code(result.statusCode);
    return result.payload;
  });
  app.get('/v1/official-question-bank/:question_id', async (request, reply) => {
    const result = await detailResponse({
      req: request.raw,
      pathname: `/v1/official-question-bank/${request.params.question_id}`,
    });
    reply.code(result.statusCode);
    return result.payload;
  });
  app.post('/v1/official-question-bank/:question_id/import', async (request, reply) => {
    const result = await importResponse({
      req: request.raw,
      pathname: `/v1/official-question-bank/${request.params.question_id}/import`,
    });
    reply.code(result.statusCode);
    return result.payload;
  });
}

module.exports = {
  handleOfficialQuestionBankRoutes,
  importResponse,
  registerOfficialQuestionBankRoutes,
};
