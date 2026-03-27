const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const { initPostgres } = require('./postgres');
const { init } = require('./db');
const { json } = require('./http');
const { registerSystemRoutes } = require('./routes/system-routes');
const { handleChatRoutes, registerChatRoutes } = require('./routes/chat-routes');
const { registerDocumentRoutes } = require('./routes/document-routes');
const { handleInterviewRoutes } = require('./routes/interview-routes');
const { handlePracticeRoutes, registerPracticeRoutes } = require('./routes/practice-routes');
const { handleExperienceRoutes, registerExperienceRoutes } = require('./routes/experience-routes');
const { errorHandlerPlugin } = require('./plugins/error-handler');
const { requestContextPlugin } = require('./plugins/request-context');

const MULTIPART_LIMIT_BYTES = 8 * 1024 * 1024;

const routeHandlers = [
  handleChatRoutes,
  handleInterviewRoutes,
  handleExperienceRoutes,
];

async function buildApp() {
  init();
  void initPostgres().catch((error) => {
    console.error('[postgres.init.failed]', error);
  });

  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origin || '*');
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MULTIPART_LIMIT_BYTES,
      files: 1,
    },
  });

  await errorHandlerPlugin(app);
  await requestContextPlugin(app);
  await app.register(registerSystemRoutes);
  await app.register(registerChatRoutes);
  await app.register(registerPracticeRoutes);
  await app.register(registerExperienceRoutes);
  await app.register(registerDocumentRoutes);

  app.route({
    method: ['GET', 'POST'],
    url: '/*',
    async handler(request, reply) {
      reply.hijack();

      request.raw.body = request.body;

      const host = request.headers.host || '127.0.0.1';
      const url = new URL(request.raw.url, `http://${host}`);
      const corsHeaders = {
        'Access-Control-Allow-Origin': String(reply.getHeader('access-control-allow-origin') || '*'),
        'Access-Control-Allow-Headers': String(reply.getHeader('access-control-allow-headers') || 'Content-Type, Authorization'),
        'Access-Control-Allow-Methods': String(reply.getHeader('access-control-allow-methods') || 'GET, POST, OPTIONS'),
        'Access-Control-Max-Age': String(reply.getHeader('access-control-max-age') || '86400'),
        Vary: String(reply.getHeader('vary') || 'Origin'),
      };

      for (const handleRoute of routeHandlers) {
        if (await handleRoute({
          req: request.raw,
          res: reply.raw,
          url,
          corsHeaders,
        })) {
          return;
        }
      }

      json(reply.raw, 404, { error: 'not found' });
    },
  });

  return app;
}

module.exports = {
  buildApp,
};
