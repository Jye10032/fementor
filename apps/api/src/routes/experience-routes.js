const {
  json,
  jsonError,
  parseNumberOrFallback,
  readBody,
  requirePathSegment,
} = require('../http');
const { getResolvedUserContext } = require('../request-context');
const {
  startExperienceSync,
  getExperienceSyncJobById,
  listExperiencePosts,
  getExperiencePostDetail,
  searchExperienceQuestionItems,
} = require('../experience/service');

const createSyncJobResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(body.user_id || '').trim(),
    requireAuth: true,
  });

  const keyword = String(body.keyword || '').trim();
  const days = parseNumberOrFallback(body.days || 7, 7);
  const limit = Math.min(10, parseNumberOrFallback(body.limit || 10, 10));

  if (!keyword) {
    return { statusCode: 400, payload: { error: 'keyword is required' } };
  }

  const job = startExperienceSync({
    userId: context.userId,
    keyword,
    days,
    limit,
  });

  return {
    statusCode: 200,
    payload: {
      job_id: job.id,
      status: job.status,
    },
  };
};

const getSyncJobResponse = async ({ req, pathname }) => {
  const context = await getResolvedUserContext({ req, requireAuth: true });
  const jobId = requirePathSegment(pathname, 4, 'job_id');
  const job = getExperienceSyncJobById(jobId);
  if (!job) {
    return { statusCode: 404, payload: { error: 'job not found' } };
  }
  if (job.user_id !== context.userId) {
    return { statusCode: 403, payload: { error: 'forbidden' } };
  }
  return {
    statusCode: 200,
    payload: { job },
  };
};

const listExperiencesResponse = async ({ req, searchParams }) => {
  await getResolvedUserContext({ req, requireAuth: true });
  const query = String(searchParams.get('query') || '').trim();
  const company = String(searchParams.get('company') || '').trim();
  const role = String(searchParams.get('role') || '').trim();
  const days = parseNumberOrFallback(searchParams.get('days') || 0, 0);
  const page = Math.max(1, parseNumberOrFallback(searchParams.get('page') || 1, 1));
  const pageSize = Math.min(50, Math.max(1, parseNumberOrFallback(searchParams.get('page_size') || 20, 20)));
  const onlyValid = String(searchParams.get('only_valid') || '1') !== '0';

  const result = listExperiencePosts({
    query,
    company,
    role,
    days,
    onlyValid,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    statusCode: 200,
    payload: {
      items: result.items,
      page,
      page_size: pageSize,
      total: result.total,
    },
  };
};

const getExperienceDetailResponse = async ({ req, pathname }) => {
  await getResolvedUserContext({ req, requireAuth: true });
  const experienceId = requirePathSegment(pathname, 3, 'id');
  const item = getExperiencePostDetail(experienceId);
  if (!item) {
    return { statusCode: 404, payload: { error: 'experience not found' } };
  }
  return {
    statusCode: 200,
    payload: { item },
  };
};

const previewExperienceRetrievalResponse = async ({ req, body }) => {
  await getResolvedUserContext({ req, requireAuth: true });
  const query = String(body.keyword || body.experience_query || '').trim();
  const limit = Math.min(20, Math.max(1, parseNumberOrFallback(body.limit || 10, 10)));

  if (!query) {
    return { statusCode: 400, payload: { error: 'keyword is required' } };
  }

  const items = searchExperienceQuestionItems({ query, limit }).map((item, index) => ({
    ...item,
    score: Number((1 - index * 0.03).toFixed(2)),
  }));

  return {
    statusCode: 200,
    payload: { items },
  };
};

const handleExperienceRoutes = async ({ req, res, url }) => {
  if (req.method === 'POST' && url.pathname === '/v1/experiences/sync') {
    try {
      const body = await readBody(req);
      const result = await createSyncJobResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && /^\/v1\/experiences\/sync\/[^/]+$/.test(url.pathname)) {
    try {
      const result = await getSyncJobResponse({ req, pathname: url.pathname });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/experiences') {
    try {
      const result = await listExperiencesResponse({
        req,
        searchParams: url.searchParams,
      });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && /^\/v1\/experiences\/[^/]+$/.test(url.pathname)) {
    try {
      const result = await getExperienceDetailResponse({ req, pathname: url.pathname });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/interview/experience-retrieval/preview') {
    try {
      const body = await readBody(req);
      const result = await previewExperienceRetrievalResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  return false;
};

async function registerExperienceRoutes(app) {
  app.post('/v1/experiences/sync', async (request, reply) => {
    const result = await createSyncJobResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/experiences/sync/:job_id', async (request, reply) => {
    const result = await getSyncJobResponse({
      req: request.raw,
      pathname: `/v1/experiences/sync/${request.params.job_id}`,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/experiences', async (request, reply) => {
    const searchParams = new URLSearchParams(request.query || {});
    const result = await listExperiencesResponse({
      req: request.raw,
      searchParams,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/experiences/:id', async (request, reply) => {
    const result = await getExperienceDetailResponse({
      req: request.raw,
      pathname: `/v1/experiences/${request.params.id}`,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/interview/experience-retrieval/preview', async (request, reply) => {
    const result = await previewExperienceRetrievalResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });
}

module.exports = {
  handleExperienceRoutes,
  registerExperienceRoutes,
};
