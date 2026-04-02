const { randomUUID } = require('crypto');
const { createChatSession, getChatSession, addChatMessage, listChatMessages } = require('../db');
const { chatCompletion, getLlmConfig, streamCompletion } = require('../llm');
const { getErrorMessage, json, jsonError, parseNumberOrFallback, readBody, requirePathSegment, writeSse } = require('../http');

const buildChatMessages = async ({ sessionId, content, systemPrompt = '' }) => {
  await addChatMessage({ id: randomUUID(), sessionId, role: 'user', content });
  const history = await listChatMessages(sessionId, 100);
  const serializedHistory = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  return [
    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
    ...serializedHistory,
  ];
};

const startChatSessionResponse = async ({ body }) => {
  const userId = String(body.user_id || '').trim();
  const title = String(body.title || '').trim();
  if (!userId) {
    return { statusCode: 400, payload: { error: 'user_id is required' } };
  }

  return {
    statusCode: 200,
    payload: await createChatSession({ id: randomUUID(), userId, title }),
  };
};

const listChatMessagesResponse = async ({ sessionId, limit }) => {
  const session = await getChatSession(sessionId);
  if (!session) {
    return { statusCode: 404, payload: { error: 'session not found' } };
  }

  return {
    statusCode: 200,
    payload: { session, items: await listChatMessages(sessionId, limit) },
  };
};

const createChatMessageResponse = async ({ sessionId, body }) => {
  const content = String(body.content || '').trim();
  const systemPrompt = String(body.system_prompt || '').trim();
  const model = String(body.model || '').trim() || undefined;
  if (!content) {
    return { statusCode: 400, payload: { error: 'content is required' } };
  }

  const session = await getChatSession(sessionId);
  if (!session) {
    return { statusCode: 404, payload: { error: 'session not found' } };
  }

  const messages = await buildChatMessages({ sessionId, content, systemPrompt });
  const assistantContent = await chatCompletion({ messages, model });
  const assistantMsg = await addChatMessage({
    id: randomUUID(),
    sessionId,
    role: 'assistant',
    content: assistantContent,
  });

  return {
    statusCode: 200,
    payload: { session_id: sessionId, message: assistantMsg },
  };
};

const handleChatRoutes = async ({ req, res, url, corsHeaders }) => {
  if (req.method === 'POST' && url.pathname === '/v1/chat/sessions/start') {
    try {
      const body = await readBody(req);
      const result = await startChatSessionResponse({ body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'GET'
    && /^\/v1\/chat\/sessions\/[^/]+\/messages$/.test(url.pathname)
  ) {
    const sessionId = requirePathSegment(url.pathname, 4, 'session_id');
    const limit = parseNumberOrFallback(url.searchParams.get('limit') || 100, 100);
    const result = await listChatMessagesResponse({ sessionId, limit });
    json(res, result.statusCode, result.payload);
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/chat\/sessions\/[^/]+\/messages$/.test(url.pathname)
  ) {
    try {
      const sessionId = requirePathSegment(url.pathname, 4, 'session_id');
      const body = await readBody(req);
      const result = await createChatMessageResponse({ sessionId, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (
    req.method === 'POST'
    && /^\/v1\/chat\/sessions\/[^/]+\/messages\/stream$/.test(url.pathname)
  ) {
    try {
      const sessionId = requirePathSegment(url.pathname, 4, 'session_id');
      const body = await readBody(req);
      const content = String(body.content || '').trim();
      const systemPrompt = String(body.system_prompt || '').trim();
      const model = String(body.model || '').trim() || undefined;
      if (!content) return json(res, 400, { error: 'content is required' });
      const session = await getChatSession(sessionId);
      if (!session) return json(res, 404, { error: 'session not found' });

      const messages = await buildChatMessages({ sessionId, content, systemPrompt });
      const llmConfig = getLlmConfig();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        ...corsHeaders,
      });

      writeSse(res, 'meta', {
        session_id: sessionId,
        model: model || llmConfig.model,
      });

      let full = '';
      for await (const delta of streamCompletion({ messages, model })) {
        full += delta;
        writeSse(res, 'token', { delta });
      }

      const assistantMsg = await addChatMessage({
        id: randomUUID(),
        sessionId,
        role: 'assistant',
        content: full,
      });
      writeSse(res, 'done', { message_id: assistantMsg.id, content: full });
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        jsonError(res, error);
      } else {
        writeSse(res, 'error', { error: getErrorMessage(error, 'stream failed') });
        res.end();
      }
    }
    return true;
  }

  return false;
};

async function registerChatRoutes(app) {
  app.post('/v1/chat/sessions/start', async (request, reply) => {
    const result = await startChatSessionResponse({ body: request.body || {} });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/chat/sessions/:session_id/messages', async (request, reply) => {
    const limit = parseNumberOrFallback(request.query?.limit || 100, 100);
    const result = await listChatMessagesResponse({
      sessionId: request.params.session_id,
      limit,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/chat/sessions/:session_id/messages', async (request, reply) => {
    const result = await createChatMessageResponse({
      sessionId: request.params.session_id,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });
}

module.exports = {
  handleChatRoutes,
  registerChatRoutes,
};
