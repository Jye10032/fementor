const assert = require('node:assert/strict');
const test = require('node:test');
const { AgentRuntimeError } = require('../../src/agent-runtime/contracts');
const {
  buildDshChildEnv,
  getDshRuntimeConfig,
  parseArgs,
} = require('../../src/agent-runtime/dsh-config');

test('dsh config requires an explicit runtime command', () => {
  assert.throws(
    () => getDshRuntimeConfig({}),
    (error) => error instanceof AgentRuntimeError && error.code === 'runtime_unavailable',
  );
});

test('dsh args must be a JSON array of strings', () => {
  assert.deepEqual(parseArgs('["agent.js","--config","dsh.json"]'), [
    'agent.js',
    '--config',
    'dsh.json',
  ]);
  assert.throws(
    () => parseArgs('{"config":"dsh.json"}'),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_config',
  );
  assert.throws(
    () => parseArgs('["agent.js",1]'),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_config',
  );
});

test('child environment only includes allowlisted values', () => {
  const childEnv = buildDshChildEnv({
    sourceEnv: {
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      OPENAI_API_KEY: 'must-not-leak',
      UNRELATED_SECRET: 'must-not-leak',
      DSH_CHILD_ENV_ALLOWLIST: 'SAFE_SETTING',
      SAFE_SETTING: 'enabled',
    },
  });

  assert.deepEqual(childEnv, {
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    SAFE_SETTING: 'enabled',
  });
});

test('provider credential is passed only through its explicitly named env key', () => {
  const childEnv = buildDshChildEnv({
    sourceEnv: {
      DSH_PROVIDER_API_KEY_ENV: 'DEEPSEEK_API_KEY',
      DEEPSEEK_API_KEY: 'provider-secret',
      OPENAI_API_KEY: 'other-secret',
    },
  });

  assert.deepEqual(childEnv, { DEEPSEEK_API_KEY: 'provider-secret' });
});

test('dsh config rejects invalid numeric limits', () => {
  assert.throws(
    () => getDshRuntimeConfig({ DSH_RUNTIME_COMMAND: 'agent', DSH_REQUEST_TIMEOUT_MS: 'invalid' }),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_config',
  );
  assert.throws(
    () => getDshRuntimeConfig({ DSH_RUNTIME_COMMAND: 'agent', DSH_MAX_TOKENS: '2.5' }),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_config',
  );
});

test('dsh config resolves launch and workspace paths from the API package root', () => {
  const config = getDshRuntimeConfig({
    DSH_RUNTIME_COMMAND: 'node',
    DSH_RUNTIME_CWD: '.',
    DSH_WORKSPACE_CWD: '../..',
  });

  assert.equal(config.launch.cwd, require('path').resolve(__dirname, '../..'));
  assert.equal(config.cwd, require('path').resolve(__dirname, '../../../..'));
});
