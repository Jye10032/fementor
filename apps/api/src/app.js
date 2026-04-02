const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const { initPostgres, isPostgresEnabled } = require('./postgres');
const { init } = require('./db');
const { getExperienceStore } = require('./experience/store');
const { loadEmbeddingsFromStore } = require('./experience/embedding-cache');
const { buildKnowledgeGraph } = require('./experience/knowledge-graph');
const { registerSystemRoutes } = require('./routes/system-routes');
const { registerChatRoutes } = require('./routes/chat-routes');
const { registerDocumentRoutes } = require('./routes/document-routes');
const { registerInterviewRoutes } = require('./routes/interview-routes');
const { registerPracticeRoutes } = require('./routes/practice-routes');
const { registerExperienceRoutes } = require('./routes/experience-routes');
const { registerPublicQuestionSourceRoutes } = require('./routes/public-question-source-routes');
const { errorHandlerPlugin } = require('./plugins/error-handler');
const { requestContextPlugin } = require('./plugins/request-context');

const MULTIPART_LIMIT_BYTES = 8 * 1024 * 1024;

async function buildApp() {
  if (isPostgresEnabled()) {
    await initPostgres();
  } else {
    init();
  }

  try {
    const store = getExperienceStore();
    await loadEmbeddingsFromStore(store);
    await buildKnowledgeGraph(store);
  } catch (error) {
    console.warn('[experience.init.failed]', error.message);
  }

  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
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
  await app.register(registerInterviewRoutes);
  await app.register(registerPracticeRoutes);
  await app.register(registerExperienceRoutes);
  await app.register(registerPublicQuestionSourceRoutes);
  await app.register(registerDocumentRoutes);

  return app;
}

module.exports = {
  buildApp,
};
