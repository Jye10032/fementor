const { getErrorMessage, getErrorStatusCode } = require('../http');

async function errorHandlerPlugin(app) {
  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      request.log.error(error);
      return;
    }

    reply
      .code(getErrorStatusCode(error, 500))
      .type('application/json; charset=utf-8')
      .send({ error: getErrorMessage(error, 'internal server error') });
  });
}

module.exports = {
  errorHandlerPlugin,
};
