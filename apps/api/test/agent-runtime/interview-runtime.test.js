const assert = require('node:assert/strict');
const test = require('node:test');
const { AGENT_RUNTIME_IDS, AgentRuntimeError } = require('../../src/agent-runtime/contracts');
const {
  buildDshEvaluationPrompt,
  disposeInterviewRuntimes,
  getAgentRuntimeHealth,
  getConfiguredRuntimeId,
  parseDshEvaluationOutput,
  prepareConfiguredInterviewRuntime,
  validateDshEvaluationResult,
} = require('../../src/agent-runtime/interview-runtime');

test('agent runtime selection is controlled by server config in local and cloud modes', () => {
  assert.equal(getConfiguredRuntimeId({}), AGENT_RUNTIME_IDS.NATIVE_API);
  assert.equal(
    getConfiguredRuntimeId({ APP_RUNTIME_MODE: 'cloud', AGENT_RUNTIME: 'dsh' }),
    AGENT_RUNTIME_IDS.DSH,
  );
  assert.equal(
    getConfiguredRuntimeId({ APP_RUNTIME_MODE: 'local', AGENT_RUNTIME: 'dsh' }),
    AGENT_RUNTIME_IDS.DSH,
  );
});

test('agent runtime selection rejects unknown runtimes in every deployment mode', () => {
  assert.throws(
    () => getConfiguredRuntimeId({ APP_RUNTIME_MODE: 'local', AGENT_RUNTIME: 'unknown' }),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_config',
  );
  assert.throws(
    () => getConfiguredRuntimeId({ APP_RUNTIME_MODE: 'cloud', AGENT_RUNTIME: 'unknown' }),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_config',
  );
});

test('agent runtime health reports server-controlled cloud dsh configuration errors', () => {
  const unavailable = getAgentRuntimeHealth({ APP_RUNTIME_MODE: 'cloud', AGENT_RUNTIME: 'dsh' });
  assert.equal(unavailable.selected_runtime, 'dsh');
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.error_code, 'runtime_unavailable');
  assert.equal(unavailable.user_configurable, false);

  const missingCredential = getAgentRuntimeHealth({
    APP_RUNTIME_MODE: 'cloud',
    AGENT_RUNTIME: 'dsh',
    DSH_RUNTIME_COMMAND: 'node',
  });
  assert.equal(missingCredential.selected_runtime, 'dsh');
  assert.equal(missingCredential.available, false);
  assert.match(missingCredential.error_message, /DSH_PROVIDER_API_KEY_ENV/);
  assert.equal(missingCredential.user_configurable, false);
});

test('cloud dsh startup validates credentials and completes a real subprocess handshake', async () => {
  const env = {
    APP_RUNTIME_MODE: 'cloud',
    AGENT_RUNTIME: 'dsh',
    DSH_RUNTIME_COMMAND: process.execPath,
    DSH_RUNTIME_ARGS_JSON: JSON.stringify([
      'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js',
      'config/dsh/fementor.cordis.yml',
    ]),
    DSH_RUNTIME_CWD: '.',
    DSH_WORKSPACE_CWD: '../..',
    DSH_PROVIDER_API_KEY_ENV: 'DEEPSEEK_API_KEY',
    DEEPSEEK_API_KEY: 'startup-handshake-placeholder',
  };

  try {
    await prepareConfiguredInterviewRuntime(env);
    const health = getAgentRuntimeHealth(env);
    assert.equal(health.selected_runtime, 'dsh');
    assert.equal(health.available, true);
    assert.equal(health.state, 'ready');
  } finally {
    await disposeInterviewRuntimes();
  }
});

test('cloud dsh startup fails closed when the subprocess command is unavailable', async () => {
  await assert.rejects(
    () => prepareConfiguredInterviewRuntime({
      APP_RUNTIME_MODE: 'cloud',
      AGENT_RUNTIME: 'dsh',
      DSH_RUNTIME_COMMAND: 'fementor-dsh-command-that-does-not-exist',
      DSH_PROVIDER_API_KEY_ENV: 'DEEPSEEK_API_KEY',
      DEEPSEEK_API_KEY: 'startup-handshake-placeholder',
    }),
    (error) => error instanceof AgentRuntimeError && error.code === 'runtime_unavailable',
  );
});

test('local dsh startup also requires a deployment-owned provider credential', async () => {
  await assert.rejects(
    () => prepareConfiguredInterviewRuntime({
      APP_RUNTIME_MODE: 'local',
      AGENT_RUNTIME: 'dsh',
      DSH_RUNTIME_COMMAND: process.execPath,
    }),
    (error) => error instanceof AgentRuntimeError
      && error.code === 'runtime_unavailable'
      && /DSH_PROVIDER_API_KEY_ENV/.test(error.message),
  );
});

test('dsh evaluation prompt embeds the bounded shared interview contract', () => {
  const prompt = buildDshEvaluationPrompt(
    {
      question: 'What is event delegation?',
      answer: 'Attach one handler to the parent.',
      questionTypeHint: 'knowledge',
    },
    { skillRefs: ['frontend-answer-evaluation@1'] },
  );

  assert.match(prompt, /Do not modify files, call shell commands, or persist business state/);
  assert.match(prompt, /<system_instructions>/);
  assert.match(prompt, /<task_input>/);
  assert.match(prompt, /What is event delegation\?/);
  assert.match(prompt, /content 必须是最后一个字段/);
  assert.match(prompt, /Load and follow these approved skills before evaluating: frontend-answer-evaluation/);
});

test('dsh evaluation parser accepts fenced JSON and uses the shared normalized output', () => {
  const output = parseDshEvaluationOutput(
    '```json\n{"intent":"answer","total_score":88,"dimension_scores":{"technical_depth":23,"structure_clarity":22,"evidence_grounding":21,"role_fit":22},"content":"Good answer"}\n```',
    {},
    { input: { questionTypeHint: 'knowledge' } },
  );

  assert.equal(output.intent, 'answer');
  assert.equal(output.score, 88);
  assert.equal(output.question_type, 'knowledge');
  assert.equal(output.content, 'Good answer');
  assert.deepEqual(output.strengths, []);
});

test('dsh evaluation parser rejects non-object output', () => {
  assert.throws(
    () => parseDshEvaluationOutput('not json', {}, { input: {} }),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_output',
  );
});

test('dsh evaluation result validation rejects incomplete answer scores', () => {
  assert.throws(
    () => validateDshEvaluationResult({
      intent: 'answer',
      total_score: 80,
      dimension_scores: { technical_depth: 20 },
      content: 'Incomplete dimensions',
    }),
    (error) => error instanceof AgentRuntimeError && error.code === 'invalid_output',
  );
});

test('Codex is opt-in, server-owned and incompatible with the legacy interview pipeline', async () => {
  assert.equal(getConfiguredRuntimeId({ AGENT_RUNTIME: 'codex' }), AGENT_RUNTIME_IDS.CODEX);
  assert.equal(getAgentRuntimeHealth({ AGENT_RUNTIME: 'codex', CODEX_SANDBOX_ENABLED: '1', INTERVIEW_PIPELINE_VERSION: 'legacy' }).available, false);
  const health = getAgentRuntimeHealth({ AGENT_RUNTIME: 'codex' });
  assert.equal(health.available, false);
  assert.equal(health.selected_runtime, 'codex');
  assert.equal(health.user_configurable, false);
});

test('Codex resource recovery starts with control credentials when scoring is misconfigured', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-startup-recovery-'));
  const env = { AGENT_RUNTIME: 'codex', CODEX_SANDBOX_ENABLED: '1', RAILWAY_API_TOKEN: 'fixture',
    RAILWAY_ENVIRONMENT_ID: 'staging', CODEX_RUN_JOURNAL_DIR: directory };
  try {
    await prepareConfiguredInterviewRuntime(env);
    const health = getAgentRuntimeHealth(env);
    assert.equal(health.available, false);
    assert.equal(health.error_code, 'missing_config');
    assert.equal(health.recovery.state, 'ready');
  } finally {
    await disposeInterviewRuntimes();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
