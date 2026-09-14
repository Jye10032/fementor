const { getResolvedUserContext } = require('../request-context');
const { ensureLocalRequestIdentity } = require('../local-identity');

async function requestContextPlugin(app) {
  app.addHook('onRequest', async (request, reply) => {
    const identity = ensureLocalRequestIdentity(request.raw);
    if (identity?.setCookie) {
      reply.header('Set-Cookie', identity.setCookie);
    }
  });

  app.decorateRequest('getResolvedUserContext', function getResolvedUserContextForRequest(options = {}) {
    return getResolvedUserContext({
      req: this.raw,
      ...options,
    });
  });
}

module.exports = {
  requestContextPlugin,
};
