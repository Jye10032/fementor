const path = require('path');
const { AgentRuntimeError } = require('./contracts');

const API_ROOT = path.resolve(__dirname, '../..');

const DEFAULT_CHILD_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'NODE_ENV',
  'DSH_HOME',
  'DSH_CORDIS_CONFIG',
  'DSH_SESSION_ROOT',
];

const parseArgs = (value) => {
  if (!String(value || '').trim()) return [];
  try {
    const args = JSON.parse(value);
    if (!Array.isArray(args) || args.some((item) => typeof item !== 'string')) {
      throw new Error('expected a JSON string array');
    }
    return args;
  } catch (error) {
    throw new AgentRuntimeError('invalid_config', `DSH_RUNTIME_ARGS_JSON is invalid: ${error.message}`);
  }
};

const parsePositiveNumber = (value, fallback, field) => {
  const number = Number(value === undefined || value === '' ? fallback : value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new AgentRuntimeError('invalid_config', `${field} must be greater than 0`);
  }
  return number;
};

const buildDshChildEnv = ({ sourceEnv = process.env, extraKeys = [] } = {}) => {
  const providerKey = String(sourceEnv.DSH_PROVIDER_API_KEY_ENV || '').trim();
  const configuredKeys = String(sourceEnv.DSH_CHILD_ENV_ALLOWLIST || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const keys = new Set([...DEFAULT_CHILD_ENV_KEYS, ...configuredKeys, ...extraKeys]);
  if (providerKey) keys.add(providerKey);

  const childEnv = {};
  for (const key of keys) {
    if (sourceEnv[key] !== undefined) childEnv[key] = sourceEnv[key];
  }
  return childEnv;
};

const getDshRuntimeConfig = (env = process.env) => {
  const command = String(env.DSH_RUNTIME_COMMAND || '').trim();
  if (!command) {
    throw new AgentRuntimeError(
      'runtime_unavailable',
      'DSH_RUNTIME_COMMAND is required when AGENT_RUNTIME=dsh',
    );
  }

  const launchCwd = path.resolve(API_ROOT, String(env.DSH_RUNTIME_CWD || '.'));
  const workspaceCwd = path.resolve(API_ROOT, String(env.DSH_WORKSPACE_CWD || '../..'));
  const maxTokens = Number(env.DSH_MAX_TOKENS || 0);
  if (env.DSH_MAX_TOKENS && (!Number.isInteger(maxTokens) || maxTokens <= 0)) {
    throw new AgentRuntimeError('invalid_config', 'DSH_MAX_TOKENS must be a positive integer');
  }
  return {
    launch: {
      command,
      args: parseArgs(env.DSH_RUNTIME_ARGS_JSON),
      cwd: launchCwd,
      env: buildDshChildEnv({ sourceEnv: env }),
      requestTimeoutMs: parsePositiveNumber(env.DSH_REQUEST_TIMEOUT_MS, 120000, 'DSH_REQUEST_TIMEOUT_MS'),
      shutdownTimeoutMs: parsePositiveNumber(env.DSH_SHUTDOWN_TIMEOUT_MS, 1000, 'DSH_SHUTDOWN_TIMEOUT_MS'),
      disposeEofGraceMs: parsePositiveNumber(env.DSH_DISPOSE_EOF_GRACE_MS, 6000, 'DSH_DISPOSE_EOF_GRACE_MS'),
      disposeGraceMs: parsePositiveNumber(env.DSH_DISPOSE_GRACE_MS, 3000, 'DSH_DISPOSE_GRACE_MS'),
    },
    cwd: workspaceCwd,
    provider: String(env.DSH_PROVIDER || 'deepseek-official').trim(),
    model: String(env.DSH_MODEL || 'deepseek-v4-flash').trim(),
    ...(Number.isFinite(maxTokens) && maxTokens > 0 ? { maxTokens } : {}),
  };
};

module.exports = {
  DEFAULT_CHILD_ENV_KEYS,
  buildDshChildEnv,
  getDshRuntimeConfig,
  parseArgs,
  parsePositiveNumber,
};
