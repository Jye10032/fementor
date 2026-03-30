const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const http = require('http');
const { URL } = require('url');
const { initPostgres } = require('./postgres');
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

init();
void initPostgres().catch((error) => {
  console.error('[postgres.init.failed]', error);
});

const routeHandlers = [
  handleSystemRoutes,
  handleChatRoutes,
  handleDocumentRoutes,
  handleInterviewRoutes,
  handlePracticeRoutes,
  handleExperienceRoutes,
  handlePublicQuestionSourceRoutes,
];

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
  // eslint-disable-next-line no-console
  console.log(`[fementor-api] listening on :${PORT}`);
});
