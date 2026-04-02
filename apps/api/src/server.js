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

const PORT = process.env.PORT || 3300;

const routeHandlers = [
  handleSystemRoutes,
  handleChatRoutes,
  handleDocumentRoutes,
  handleInterviewRoutes,
  handlePracticeRoutes,
  handleExperienceRoutes,
  handlePublicQuestionSourceRoutes,
];

async function bootstrap() {
  if (isPostgresEnabled()) {
    await initPostgres();
  } else {
    init();
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const corsHeaders = getCorsHeaders(req);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

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
}

bootstrap().catch((error) => {
  console.error('[api.bootstrap.failed]', error);
  process.exit(1);
});
