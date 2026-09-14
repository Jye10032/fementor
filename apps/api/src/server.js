const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const http = require('http');
const { URL } = require('url');
const { initPostgres, isPostgresEnabled } = require('./postgres');
const { init } = require('./db');
const { getCorsHeaders, json } = require('./http');
const { handleSystemRoutes } = require('./routes/system-routes');
const { handleChatRoutes } = require('./routes/chat-routes');
const { handleDocumentRoutes } = require('./routes/document-routes');
const { handleInterviewRoutes } = require('./routes/interview-routes');
const { handlePracticeRoutes } = require('./routes/practice-routes');
const { handleExperienceRoutes } = require('./routes/experience-routes');
const { handlePublicQuestionSourceRoutes } = require('./routes/public-question-source-routes');
const { handleOfficialQuestionBankRoutes } = require('./routes/official-question-bank-routes');
const { closeOfficialQuestionSourcePool } = require('./official-question-bank/repository');
const { getExperienceStore } = require('./experience/store');
const { loadEmbeddingsFromStore } = require('./experience/embedding-cache');
const { buildKnowledgeGraph } = require('./experience/knowledge-graph');
const { ensureLocalRequestIdentity } = require('./local-identity');

const PORT = process.env.PORT || 3300;

const routeHandlers = [
  handleSystemRoutes,
  handleChatRoutes,
  handleDocumentRoutes,
  handleInterviewRoutes,
  handlePracticeRoutes,
  handleExperienceRoutes,
  handlePublicQuestionSourceRoutes,
  handleOfficialQuestionBankRoutes,
];

async function bootstrap() {
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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const corsHeaders = getCorsHeaders(req);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    const localIdentity = ensureLocalRequestIdentity(req);
    if (localIdentity?.setCookie) {
      res.setHeader('Set-Cookie', localIdentity.setCookie);
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    for (const handleRoute of routeHandlers) {
      if (await handleRoute({ req, res, url, corsHeaders })) {
        return;
      }
    }

    json(res, 404, { error: 'not found' });
  });

  server.listen(PORT, () => {
    console.log(`[fementor-api] listening on :${PORT}`);
  });

  let closing = false;
  const close = async (signal) => {
    if (closing) return;
    closing = true;
    server.close(async (error) => {
      try {
        await closeOfficialQuestionSourcePool();
      } catch (closeError) {
        console.error('[fementor-api.shutdown.failed]', signal, closeError);
        process.exit(1);
        return;
      }
      if (error) {
        console.error('[fementor-api.shutdown.failed]', signal, error);
        process.exit(1);
        return;
      }
      process.exit(0);
    });
  };
  process.once('SIGINT', () => void close('SIGINT'));
  process.once('SIGTERM', () => void close('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('[api.bootstrap.failed]', error);
  process.exit(1);
});
