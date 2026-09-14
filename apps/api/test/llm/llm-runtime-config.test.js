const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getLlmConfig,
  getResolvedLlmConfig,
} = require('../../src/llm');
const {
  deleteSessionLlmConfig,
  upsertSessionLlmConfig,
} = require('../../src/lib/session-llm-config-store');

test('cloud mode ignores user session LLM base URL and credentials', () => {
  const originalMode = process.env.APP_RUNTIME_MODE;
  const sessionContext = { userId: 'cloud-user', token: 'cloud-token' };
  upsertSessionLlmConfig({
    ...sessionContext,
    baseUrl: 'https://user-controlled.example/v1',
    apiKey: 'user-controlled-key',
    model: 'user-controlled-model',
  });

  try {
    process.env.APP_RUNTIME_MODE = 'local';
    assert.equal(getResolvedLlmConfig(sessionContext).baseUrl, 'https://user-controlled.example/v1');

    process.env.APP_RUNTIME_MODE = 'cloud';
    assert.deepEqual(getResolvedLlmConfig(sessionContext), getLlmConfig());
  } finally {
    deleteSessionLlmConfig(sessionContext);
    if (originalMode === undefined) delete process.env.APP_RUNTIME_MODE;
    else process.env.APP_RUNTIME_MODE = originalMode;
  }
});
