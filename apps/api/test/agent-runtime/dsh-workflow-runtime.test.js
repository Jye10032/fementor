const assert = require('node:assert/strict');
const test = require('node:test');
const { AgentRuntimeError } = require('../../src/agent-runtime/contracts');
const { DshWorkflowRuntime } = require('../../src/agent-runtime/dsh-workflow-runtime');

test('fixed dsh workflow validates input in the official worker thread engine', async () => {
  const runtime = new DshWorkflowRuntime({ createId: () => 'workflow-1' });
  try {
    assert.deepEqual(
      await runtime.run('evaluation-input-check', {
        question: ' question ',
        answer: ' answer ',
      }),
      {
        valid: true,
        errors: [],
        questionLength: 8,
        answerLength: 6,
      },
    );
  } finally {
    await runtime.dispose();
  }
});

test('fixed dsh workflow returns structured validation failures', async () => {
  const runtime = new DshWorkflowRuntime();
  try {
    assert.deepEqual(await runtime.run('evaluation-input-check', { question: '', answer: '' }), {
      valid: false,
      errors: ['question is required', 'answer is required'],
      questionLength: 0,
      answerLength: 0,
    });
  } finally {
    await runtime.dispose();
  }
});

test('dsh workflow runtime refuses arbitrary workflow names before startup', async () => {
  const runtime = new DshWorkflowRuntime();
  await assert.rejects(
    runtime.run('user-provided-script', {}),
    (error) => error instanceof AgentRuntimeError && error.code === 'unsupported_task',
  );
  await runtime.dispose();
});
