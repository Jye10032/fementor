const { buildApp } = require('./app');

const PORT = Number(process.env.PORT || 3300);
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  console.log(`[fementor-api-fastify] listening on ${HOST}:${PORT}`);
}

start().catch((error) => {
  console.error('[fementor-api-fastify.start.failed]', error);
  process.exit(1);
});
