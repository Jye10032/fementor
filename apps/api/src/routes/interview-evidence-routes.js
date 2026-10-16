const { ensureSessionOwner } = require('../request-context');
const { createEvaluator, generationEnabled } = require('../interview/evidence/service');
async function registerInterviewEvidenceRoutes(app, options = {}) {
  const evaluator = options.evaluator || createEvaluator();
  async function handle(request, generate) {
    if (generate && request.body && (typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length)) {
      throw Object.assign(new Error('evaluation input must come from the saved turn'), { statusCode: 400 });
    }
    const { sessionId, context } = await ensureSessionOwner({ req: request.raw,
      sessionId: request.params.sessionId, requireSessionId: false });
    const args = { sessionId, userId: context.userId, turnId: request.params.turnId,
      sessionContext: { userId: context.userId, token: context.token } };
    const snapshot = await evaluator[generate ? 'evaluate' : 'read'](args);
    return { evaluation: snapshot.evaluation, generation_enabled: generationEnabled(),
      legacy_score_unchanged: true };
  }
  const path = '/v1/interview/sessions/:sessionId/turns/:turnId/evidence';
  app.get(path, (request) => handle(request, false));
  app.post(path, (request) => handle(request, true));
}
module.exports = { registerInterviewEvidenceRoutes };
