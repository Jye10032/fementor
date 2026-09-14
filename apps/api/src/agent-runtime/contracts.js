const AGENT_RUNTIME_IDS = Object.freeze({
  NATIVE_API: 'native-api',
  DSH: 'dsh',
});

const AGENT_TASK_TYPES = Object.freeze({
  EVALUATE_ANSWER: 'evaluate-answer',
  GENERATE_QUESTIONS: 'generate-questions',
  SUGGEST_FOLLOW_UP: 'suggest-follow-up',
  RETROSPECT: 'retrospect',
});

const AGENT_EVENT_TYPES = new Set([
  'started',
  'status',
  'tool_call',
  'tool_result',
  'output_delta',
  'completed',
  'failed',
]);

class AgentRuntimeError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'AgentRuntimeError';
    this.code = code;
  }
}

const requireText = (value, field) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new AgentRuntimeError('invalid_request', `${field} is required`);
  }
  return normalized;
};

const normalizeSessionRequest = (request = {}) => ({
  interviewSessionId: requireText(request.interviewSessionId, 'interviewSessionId'),
  runtimeConfigRef: String(request.runtimeConfigRef || '').trim(),
});

const normalizeRunRequest = (request = {}) => {
  const session = request.session || {};
  const budget = request.budget || {};
  const deadlineMs = Number(budget.deadlineMs);
  const maxSteps = Number(budget.maxSteps);

  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new AgentRuntimeError('invalid_request', 'budget.deadlineMs must be greater than 0');
  }
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new AgentRuntimeError('invalid_request', 'budget.maxSteps must be a positive integer');
  }

  return {
    runId: requireText(request.runId, 'runId'),
    session: {
      id: requireText(session.id, 'session.id'),
      runtimeId: requireText(session.runtimeId, 'session.runtimeId'),
    },
    taskType: requireText(request.taskType, 'taskType'),
    input: request.input,
    contextRefs: Array.isArray(request.contextRefs) ? [...request.contextRefs] : [],
    skillRefs: Array.isArray(request.skillRefs) ? [...request.skillRefs] : [],
    outputSchema: request.outputSchema || null,
    budget: {
      deadlineMs,
      maxSteps,
      maxTokens: Number.isFinite(Number(budget.maxTokens)) ? Number(budget.maxTokens) : null,
    },
  };
};

const createAgentEvent = ({ type, runId, sessionId, data = {}, now = Date.now }) => {
  if (!AGENT_EVENT_TYPES.has(type)) {
    throw new AgentRuntimeError('invalid_event', `unknown agent event type: ${type}`);
  }
  return {
    type,
    runId,
    sessionId,
    timestamp: new Date(now()).toISOString(),
    data,
  };
};

module.exports = {
  AGENT_EVENT_TYPES,
  AGENT_RUNTIME_IDS,
  AGENT_TASK_TYPES,
  AgentRuntimeError,
  createAgentEvent,
  normalizeRunRequest,
  normalizeSessionRequest,
};
