const { AgentRuntimeError } = require('../../agent-runtime/contracts');
function getInterviewOrchestrator(env = process.env) {
  const value = String(env.INTERVIEW_ORCHESTRATOR || 'workflow').trim();
  if (!['workflow', 'director'].includes(value)
    || (value === 'director' && (String(env.AGENT_RUNTIME || '').trim().toLowerCase() !== 'codex'
      || env.INTERVIEW_PIPELINE_VERSION === 'legacy'))) {
    throw new AgentRuntimeError('invalid_config', 'Director requires Codex and the unified interview pipeline');
  }
  return value;
}
module.exports = { getInterviewOrchestrator };
