const { AgentRuntimeError } = require('../contracts');

const CODEX_VERSION = '0.162.1';
const RAILWAY_SDK_VERSION = '3.13.1';
const PROFILE_ID = 'codex-railway-interview-v1';
const DIRECTOR_PROFILE_ID = 'codex-railway-interview-director-v1';
const QUESTION_PROFILE_ID = 'codex-railway-interview-question-v1';
const RECOVERABLE_PROFILE_IDS = new Set([PROFILE_ID, DIRECTOR_PROFILE_ID, QUESTION_PROFILE_ID]);

function readRailwayControlConfig(env = process.env) {
  if (Number(process.versions.node.split('.')[0]) < 22) {
    throw new AgentRuntimeError('unsupported_node', 'Railway Sandbox requires Node.js 22 or later');
  }
  const required = ['RAILWAY_API_TOKEN', 'RAILWAY_ENVIRONMENT_ID'];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new AgentRuntimeError('missing_config', `Missing configuration: ${missing.join(', ')}`);
  if (env.RAILWAY_TOKEN) throw new AgentRuntimeError('ambiguous_auth', 'Unset RAILWAY_TOKEN; this profile requires account/workspace API token authentication');
  return { railwayToken: env.RAILWAY_API_TOKEN.trim(), environmentId: env.RAILWAY_ENVIRONMENT_ID.trim() };
}

function readCodexSandboxConfig(env = process.env) {
  const control = readRailwayControlConfig(env);
  if (!(env.CODEX_MODEL_API_KEY || env.OPENAI_API_KEY) || !(env.CODEX_MODEL || env.OPENAI_MODEL)) {
    throw new AgentRuntimeError('missing_config', 'Configure CODEX_MODEL/API_KEY or OPENAI_MODEL/API_KEY');
  }
  const baseUrl = new URL(env.CODEX_MODEL_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new AgentRuntimeError('invalid_config', 'Model base URL must be HTTPS without credentials, query or fragment');
  }
  return {
    profileId: PROFILE_ID,
    ...control,
    model: (env.CODEX_MODEL || env.OPENAI_MODEL).trim(),
    modelApiKey: env.CODEX_MODEL_API_KEY || env.OPENAI_API_KEY,
    modelBaseUrl: baseUrl.href.replace(/\/$/, ''),
    codexVersion: CODEX_VERSION,
    railwaySdkVersion: RAILWAY_SDK_VERSION,
    setupDeadlineMs: 240000,
    turnDeadlineMs: 120000,
    maxModelRequests: 2,
    maxOutputTokens: 6000,
  };
}

// Only public configuration enters the VM. Model requests return over the
// existing authenticated SDK channel; both provider and Railway keys stay here.
function buildCodexConfig(model) {
  return [
    `model = ${JSON.stringify(model)}`,
    'model_provider = "fementor"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    'web_search = "disabled"',
    '[features]',
    'shell_tool = false',
    'unified_exec = false',
    'shell_snapshot = false',
    'apps = false',
    'remote_plugin = false',
    'multi_agent = false',
    'enable_request_compression = false',
    '[model_providers.fementor]',
    'name = "FEMentor bounded relay"',
    'base_url = "http://127.0.0.1:43187/v1"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    'supports_websockets = false',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n');
}

module.exports = { DIRECTOR_PROFILE_ID, QUESTION_PROFILE_ID, RECOVERABLE_PROFILE_IDS, CODEX_VERSION, RAILWAY_SDK_VERSION, PROFILE_ID, readRailwayControlConfig, readCodexSandboxConfig, buildCodexConfig };
