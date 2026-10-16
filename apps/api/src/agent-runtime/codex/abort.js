const { AgentRuntimeError } = require('../contracts');

// Some Railway SDK setup / WebSocket paths do not observe signals. The owner
// still needs to reach VM destruction when those operations stop responding.
async function withAbort(operation, signal) {
  if (signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Operation cancelled or deadline exceeded');
  let abort;
  const cancelled = new Promise((resolve, reject) => {
    abort = () => reject(new AgentRuntimeError('run_cancelled', 'Operation cancelled or deadline exceeded'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([operation(), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

module.exports = { withAbort };
