const { getResolvedUserContext } = require('../request-context');

async function requestContextPlugin(app) {
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
