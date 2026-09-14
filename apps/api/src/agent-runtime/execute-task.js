const { AgentRuntimeError } = require('./contracts');

const executeRuntimeTask = async ({ runtime, sessionRequest, runRequest, onEvent }) => {
  const session = await runtime.startSession(sessionRequest);
  let output;
  let failure;

  try {
    for await (const event of runtime.runTurn({ ...runRequest, session })) {
      if (typeof onEvent === 'function') {
        await onEvent(event);
      }
      if (event.type === 'completed') output = event.data.output;
      if (event.type === 'failed') failure = event.data;
    }
  } finally {
    await runtime.closeSession(session);
  }

  if (failure) {
    throw new AgentRuntimeError(failure.code || 'execution_failed', failure.message || 'agent runtime failed');
  }
  if (output === undefined) {
    throw new AgentRuntimeError('missing_output', 'agent runtime completed without output');
  }
  return output;
};

module.exports = { executeRuntimeTask };
