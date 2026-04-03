const { DB_PATH, getUserById, upsertUser } = require('../db');
const { DATABASE_URL, isPostgresEnabled } = require('../postgres');
const { hasRealLLM, getLlmConfig, setRuntimeLlmConfig, validateLlmRuntimeConfig } = require('../llm');
const { json, jsonError, readBody } = require('../http');
const {
  buildViewerPayload,
  ensureLocalUserProfile,
  getAppRuntimeMode,
  getExperienceStorageDriver,
  getExperienceStorageTarget,
  getPublicSourceDriver,
  getResolvedUserContext,
  getRuntimeStorageTarget,
} = require('../request-context');
const { classifyQuestionType } = require('../evidence-service');
const { enhanceEvaluationWithLLM, generateEvaluationNarration } = require('../interview/llm-service');
const { appendMemoryEntry } = require('../memory');
const { readJdDoc } = require('../doc');
const { saveScoringResult } = require('../db');
const { randomUUID } = require('crypto');
const {
  deleteSessionLlmConfig,
  getSessionLlmConfig,
  toPublicSessionConfig,
  upsertSessionLlmConfig,
} = require('../lib/session-llm-config-store');
const { getGraph, getBuildStatus } = require('../experience/knowledge-graph');

const hasText = (value) => String(value || '').trim() !== '';

const readSessionLlmBody = ({ body }) => ({
  baseUrl: String(body.base_url || '').trim(),
  apiKey: String(body.api_key || '').trim(),
  model: String(body.model || '').trim(),
});

const getRequestSessionContext = async ({ req }) =>
  getResolvedUserContext({ req, requireAuth: true, allowDevFallback: false });

const getSessionLlmConfigResponse = async ({ req }) => {
  const context = await getRequestSessionContext({ req });
  const sessionConfig = getSessionLlmConfig({
    userId: context.userId,
    token: context.token,
  });
  return {
    statusCode: 200,
    payload: {
      configured: Boolean(sessionConfig?.apiKey),
      config: toPublicSessionConfig({ sessionConfig }),
    },
  };
};

const upsertSessionLlmConfigResponse = async ({ req, body }) => {
  const context = await getRequestSessionContext({ req });
  const payload = readSessionLlmBody({ body });

  if (!hasText(payload.baseUrl) && !hasText(payload.apiKey) && !hasText(payload.model)) {
    return {
      statusCode: 400,
      payload: {
        error: 'base_url, model or api_key is required',
      },
    };
  }

  const stored = upsertSessionLlmConfig({
    userId: context.userId,
    token: context.token,
    baseUrl: payload.baseUrl,
    model: payload.model,
    apiKey: payload.apiKey,
  });

  if (!stored) {
    return {
      statusCode: 400,
      payload: {
        error: 'invalid session llm config',
      },
    };
  }

  const sessionConfig = getSessionLlmConfig({ userId: context.userId, token: context.token });
  return {
    statusCode: 200,
    payload: {
      configured: Boolean(sessionConfig?.apiKey),
      config: toPublicSessionConfig({ sessionConfig }),
      message: 'LLM session config updated',
    },
  };
};

const validateSessionLlmConfigResponse = async ({ req, body }) => {
  const context = await getRequestSessionContext({ req });
  const existing = getSessionLlmConfig({
    userId: context.userId,
    token: context.token,
  });
  const payload = readSessionLlmBody({ body });
  const toValidate = {
    baseUrl: hasText(payload.baseUrl) ? payload.baseUrl : existing?.baseUrl || '',
    apiKey: hasText(payload.apiKey) ? payload.apiKey : existing?.apiKey || '',
    model: hasText(payload.model) ? payload.model : existing?.model || '',
  };

  if (!hasText(toValidate.apiKey)) {
    return {
      statusCode: 400,
      payload: {
        error: 'api_key is required',
      },
    };
  }

  await validateLlmRuntimeConfig({
    baseUrl: toValidate.baseUrl,
    apiKey: toValidate.apiKey,
    model: toValidate.model,
  });

  return {
    statusCode: 200,
    payload: {
      valid: true,
      configured: true,
      config: toPublicSessionConfig({
        sessionConfig: {
          baseUrl: toValidate.baseUrl,
          model: toValidate.model,
          apiKey: toValidate.apiKey,
        },
      }),
    },
  };
};

const deleteSessionLlmConfigResponse = async ({ req }) => {
  const context = await getRequestSessionContext({ req });
  deleteSessionLlmConfig({ userId: context.userId, token: context.token });
  return {
    statusCode: 200,
    payload: {
      deleted: true,
      configured: false,
      config: toPublicSessionConfig({ sessionConfig: null }),
    },
  };
};

const getHealthPayload = () => {
  const llmConfig = getLlmConfig();
  const postgresEnabled = isPostgresEnabled();
  const runtimeStorageTarget = getRuntimeStorageTarget();
  return {
    ok: true,
    service: 'fementor-api',
    date: new Date().toISOString(),
    database: {
      driver: postgresEnabled ? 'postgres' : 'sqlite',
      target: postgresEnabled
        ? runtimeStorageTarget === 'remote_postgres'
          ? 'remote_postgres'
          : 'local_postgres'
        : 'local_sqlite',
      sqlite_fallback_path: DB_PATH,
    },
    llm: {
      enabled: hasRealLLM(),
      model: llmConfig.model,
      base_url: llmConfig.baseUrl,
      has_api_key: Boolean(llmConfig.apiKey),
    },
    auth: {
      clerk_enabled: Boolean(process.env.CLERK_SECRET_KEY || process.env.CLERK_JWT_KEY),
    },
    postgres: {
      enabled: postgresEnabled,
      database_url_present: Boolean(DATABASE_URL),
    },
    runtime: {
      mode: getAppRuntimeMode(),
      public_source_driver: getPublicSourceDriver(),
      public_source_storage_target: runtimeStorageTarget,
      experience_storage_driver: getExperienceStorageDriver(),
      experience_storage_target: getExperienceStorageTarget(),
    },
  };
};

const updateRuntimeLlmConfig = async ({ body }) => {
  const nextConfig = setRuntimeLlmConfig({
    baseUrl: body.base_url,
    apiKey: body.api_key,
    model: body.model,
  });

  return {
    ok: true,
    message: 'LLM runtime config updated',
    config: {
      base_url: nextConfig.baseUrl,
      model: nextConfig.model,
      has_api_key: Boolean(nextConfig.apiKey),
    },
  };
};

const getViewerResponse = async ({ req }) => {
  const context = await getResolvedUserContext({ req, requireAuth: true, allowDevFallback: false });
  return buildViewerPayload({
    userId: context.userId,
    authUser: context.authUser,
  });
};

const upsertUserResponse = async ({ body }) => {
  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim();
  const resumeSummary = String(body.resume_summary || '').trim();
  if (!id) {
    return { statusCode: 400, payload: { error: 'id is required' } };
  }

  const result = await upsertUser({ id, name, resume_summary: resumeSummary });
  return {
    statusCode: 200,
    payload: {
      user_id: id,
      created: result.created,
      updated_at: result.updated_at,
    },
  };
};

const scoringEvaluateResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(body.user_id || '').trim(),
    requireAuth: true,
  });
  const userId = context.userId;
  const question = String(body.question || '').trim();
  const answer = String(body.answer || '').trim();
  const mode = String(body.mode || 'practice').trim();
  if (!question) {
    return { statusCode: 400, payload: { error: 'question is required' } };
  }
  if (!answer) {
    return { statusCode: 400, payload: { error: 'answer is required' } };
  }

  const user = await ensureLocalUserProfile({ userId, authUser: context.authUser });
  const questionTypeResult = await classifyQuestionType({
    question,
    answer,
    interviewContext: '',
  });
  const rawEvidenceRefs = [];
  const activeJd = user?.active_jd_file
    ? await readJdDoc({ userId, fileName: user.active_jd_file })
    : null;
  const { score, dimension_scores, strengths, weaknesses, feedback, standard_answer } = await enhanceEvaluationWithLLM({
    question,
    answer,
    evidenceRefs: rawEvidenceRefs,
    interviewContext: '',
    resumeSummary: user?.resume_summary || '',
    jobDescription: activeJd?.content || '',
    questionType: questionTypeResult.question_type,
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
    interviewContext: '',
  });

  const attemptId = randomUUID();
  const scoreReportId = randomUUID();
  const normalizedEvidenceRefs = rawEvidenceRefs.map((item) => ({
    id: randomUUID(),
    source_type: String(item.source_type || 'local_doc'),
    source_uri: String(item.source_uri || ''),
    quote: String(item.quote || ''),
    confidence: typeof item.confidence === 'number' ? item.confidence : null,
  }));
  const weaknessRows = weaknesses.map((tag) => ({ id: randomUUID(), tag }));

  await saveScoringResult({
    attemptId,
    scoreReportId,
    userId,
    mode,
    question,
    answer,
    evidenceRefs: normalizedEvidenceRefs,
    score,
    strengths,
    weaknesses,
    feedback,
    weaknessRows,
  });
  const memoryPath = appendMemoryEntry({
    userId,
    question,
    answer,
    score,
    strengths,
    weaknesses,
    evidenceCount: normalizedEvidenceRefs.length,
  });

  return {
    statusCode: 200,
    payload: {
      attempt_id: attemptId,
      resolved_question_type: questionTypeResult.question_type,
      question_type_reason: questionTypeResult.reason,
      score,
      dimension_scores,
      strengths,
      weaknesses,
      feedback,
      standard_answer,
      evaluation_text: evaluationText,
      evidence_refs_count: normalizedEvidenceRefs.length,
      evidence_refs: normalizedEvidenceRefs.map(({ id, ...rest }) => rest),
      memory_path: memoryPath,
    },
  };
};

const handleSystemRoutes = async ({ req, res, url }) => {
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, getHealthPayload());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/runtime/llm-config') {
    try {
      const body = await readBody(req);
      json(res, 200, await updateRuntimeLlmConfig({ body }));
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/runtime/session-llm-config') {
    try {
      const result = await getSessionLlmConfigResponse({ req });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'PUT' && url.pathname === '/v1/runtime/session-llm-config') {
    try {
      const body = await readBody(req);
      const result = await upsertSessionLlmConfigResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/runtime/session-llm-config') {
    try {
      const body = await readBody(req);
      const result = await validateSessionLlmConfigResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/runtime/session-llm-config/validate') {
    try {
      const body = await readBody(req);
      const result = await validateSessionLlmConfigResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/runtime/session-llm-config') {
    try {
      const result = await deleteSessionLlmConfigResponse({ req });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/me') {
    try {
      json(res, 200, await getViewerResponse({ req }));
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/users/upsert') {
    try {
      const body = await readBody(req);
      const result = await upsertUserResponse({ body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/scoring/evaluate') {
    try {
      const body = await readBody(req);
      const result = await scoringEvaluateResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/knowledge-graph') {
    const graph = getGraph();
    const nodeCount = Object.keys(graph).length;
    const sources = { skeleton: 0, cooccurrence: 0, both: 0 };
    for (const node of Object.values(graph)) sources[node.source || 'unknown']++;
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    json(res, 200, { graph, _debug: { nodeCount, sources, build: getBuildStatus() } });
    return true;
  }

  return false;
};

async function registerSystemRoutes(app) {
  app.get('/health', async () => getHealthPayload());

  app.post('/v1/runtime/llm-config', async (request, reply) => {
    const payload = await updateRuntimeLlmConfig({ body: request.body || {} });
    reply.code(200);
    return payload;
  });

  app.get('/v1/runtime/session-llm-config', async (request, reply) => {
    const result = await getSessionLlmConfigResponse({ req: request.raw });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.put('/v1/runtime/session-llm-config', async (request, reply) => {
    const result = await upsertSessionLlmConfigResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/runtime/session-llm-config', async (request, reply) => {
    const result = await validateSessionLlmConfigResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/runtime/session-llm-config/validate', async (request, reply) => {
    const result = await validateSessionLlmConfigResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.delete('/v1/runtime/session-llm-config', async (request, reply) => {
    const result = await deleteSessionLlmConfigResponse({ req: request.raw });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/me', async (request, reply) => {
    const payload = await getViewerResponse({ req: request.raw });
    reply.code(200);
    return payload;
  });

  app.post('/v1/users/upsert', async (request, reply) => {
    const result = await upsertUserResponse({ body: request.body || {} });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/scoring/evaluate', async (request, reply) => {
    const result = await scoringEvaluateResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/knowledge-graph', async (request, reply) => {
    const graph = getGraph();
    const nodeCount = Object.keys(graph).length;
    const sources = { skeleton: 0, cooccurrence: 0, both: 0 };
    for (const node of Object.values(graph)) sources[node.source || 'unknown']++;
    reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
    return { graph, _debug: { nodeCount, sources, build: getBuildStatus() } };
  });
}

module.exports = {
  handleSystemRoutes,
  registerSystemRoutes,
};
