const { json, jsonError } = require('../http');
const {
  assertCanManagePublicSources,
  getResolvedViewerAccessContext,
} = require('../request-context');
const {
  buildLocalPublicSourceStatus,
  checkLocalPublicSourceUpdate,
  syncLocalPublicQuestionSources,
} = require('../public-question-source-sync/service');

const getLocalStatusResponse = async () => ({
  statusCode: 200,
  payload: await buildLocalPublicSourceStatus(),
});

const checkUpdateResponse = async ({ req }) => {
  const context = await getResolvedViewerAccessContext({ req });
  assertCanManagePublicSources(context);
  return {
  statusCode: 200,
  payload: await checkLocalPublicSourceUpdate(),
};
};

const syncPublicSourceResponse = async ({ req }) => {
  const context = await getResolvedViewerAccessContext({ req });
  assertCanManagePublicSources(context);
  return {
  statusCode: 200,
  payload: await syncLocalPublicQuestionSources(),
};
};

const handlePublicQuestionSourceRoutes = async ({ req, res, url }) => {
  if (req.method === 'GET' && url.pathname === '/v1/public-question-sources/local-status') {
    try {
      const result = await getLocalStatusResponse();
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/public-question-sources/check-update') {
    try {
      const result = await checkUpdateResponse({ req });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/public-question-sources/sync') {
    try {
      const result = await syncPublicSourceResponse({ req });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  return false;
};

async function registerPublicQuestionSourceRoutes(app) {
  app.get('/v1/public-question-sources/local-status', async (request, reply) => {
    const result = await getLocalStatusResponse();
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/public-question-sources/check-update', async (request, reply) => {
    const result = await checkUpdateResponse({ req: request.raw });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/public-question-sources/sync', async (request, reply) => {
    const result = await syncPublicSourceResponse({ req: request.raw });
    reply.code(result.statusCode);
    return result.payload;
  });
}

module.exports = {
  handlePublicQuestionSourceRoutes,
  registerPublicQuestionSourceRoutes,
};
