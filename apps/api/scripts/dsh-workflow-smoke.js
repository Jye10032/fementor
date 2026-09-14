const { DshWorkflowRuntime } = require('../src/agent-runtime/dsh-workflow-runtime');

const run = async () => {
  const runtime = new DshWorkflowRuntime();
  try {
    const result = await runtime.run('evaluation-input-check', {
      question: 'Explain event delegation.',
      answer: 'Register one listener on a stable ancestor and inspect the event target.',
    });
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } finally {
    await runtime.dispose();
  }
};

run().catch((error) => {
  process.stderr.write(`[dsh-workflow-smoke.failed] ${error.code || 'error'}: ${error.message}\n`);
  process.exitCode = 1;
});
