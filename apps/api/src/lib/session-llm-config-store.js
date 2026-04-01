const { createHash } = require('crypto');

const SESSION_KEY_TTL_MS = Number(process.env.SESSION_LLM_CONFIG_TTL_MS || 2 * 60 * 60 * 1000);
const sessionLlmConfigs = new Map();

const hasText = (value) => typeof value === 'string' && value.trim() !== '';
const normalizeText = (value) => String(value || '').trim();

const buildSessionFingerprint = (value) => createHash('sha256').update(normalizeText(value)).digest('hex');

const getSessionIdentifier = ({ userId, token }) => `${normalizeText(userId)}:${normalizeText(token) ? buildSessionFingerprint(token) : 'no-token'}`;

const buildConfigEntry = (value) => {
  const baseUrl = normalizeText(value.baseUrl);
  const model = normalizeText(value.model);
  const apiKey = normalizeText(value.apiKey);

  return {
    baseUrl: hasText(baseUrl) ? baseUrl.replace(/\/$/, '') : undefined,
    model: hasText(model) ? model : undefined,
    apiKey: hasText(apiKey) ? apiKey : undefined,
  };
};

const getNow = () => Date.now();
const getTTLMs = () => (Number.isFinite(SESSION_KEY_TTL_MS) && SESSION_KEY_TTL_MS > 0 ? SESSION_KEY_TTL_MS : 2 * 60 * 60 * 1000);

const getMaskedValue = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.length <= 4) {
    return '*'.repeat(text.length);
  }
  return `${text.slice(0, 2)}${'*'.repeat(Math.max(4, text.length - 6))}${text.slice(-4)}`;
};

const purgeExpired = () => {
  const now = getNow();
  for (const [key, entry] of sessionLlmConfigs.entries()) {
    if (!entry || entry.expiresAt <= now) {
      sessionLlmConfigs.delete(key);
    }
  }
};

const upsertSessionLlmConfig = ({ userId, token, baseUrl, model, apiKey }) => {
  const targetUserId = normalizeText(userId);
  if (!targetUserId) {
    return null;
  }

  const now = getNow();
  const key = getSessionIdentifier({ userId: targetUserId, token });
  const previous = sessionLlmConfigs.get(key) || {};
  const nextPayload = buildConfigEntry({ ...previous, baseUrl, model, apiKey });
  const ttlMs = getTTLMs();

  if (!hasText(nextPayload.apiKey) && !hasText(nextPayload.baseUrl) && !hasText(nextPayload.model) && !hasText(previous.apiKey) && !hasText(previous.baseUrl) && !hasText(previous.model)) {
    return null;
  }

  const nextEntry = {
    ...previous,
    ...nextPayload,
    updatedAt: now,
    expiresAt: now + ttlMs,
  };
  sessionLlmConfigs.set(key, nextEntry);

  return {
    baseUrl: nextEntry.baseUrl || previous.baseUrl,
    model: nextEntry.model || previous.model,
    hasApiKey: Boolean(nextEntry.apiKey),
    expiresAt: nextEntry.expiresAt,
  };
};

const getSessionLlmConfig = ({ userId, token }) => {
  purgeExpired();
  const key = getSessionIdentifier({ userId, token });
  const entry = sessionLlmConfigs.get(key);

  if (!entry) {
    return null;
  }

  entry.expiresAt = getNow() + getTTLMs();
  entry.updatedAt = getNow();
  return {
    baseUrl: normalizeText(entry.baseUrl),
    model: normalizeText(entry.model),
    apiKey: normalizeText(entry.apiKey),
    expiresAt: entry.expiresAt,
    hasApiKey: Boolean(entry.apiKey),
    sessionKey: key,
  };
};

const deleteSessionLlmConfig = ({ userId, token }) => {
  const key = getSessionIdentifier({ userId, token });
  return sessionLlmConfigs.delete(key);
};

const toPublicSessionConfig = ({ sessionConfig }) => {
  if (!sessionConfig) {
    return {
      base_url: undefined,
      model: undefined,
      has_api_key: false,
      masked_api_key: null,
      expires_at: null,
    };
  }

  return {
    base_url: sessionConfig.baseUrl || undefined,
    model: sessionConfig.model || undefined,
    has_api_key: Boolean(sessionConfig.apiKey),
    masked_api_key: sessionConfig.apiKey ? getMaskedValue(sessionConfig.apiKey) : null,
    expires_at: sessionConfig.expiresAt ? new Date(sessionConfig.expiresAt).toISOString() : null,
  };
};

module.exports = {
  SESSION_KEY_TTL_MS,
  deleteSessionLlmConfig,
  getMaskedValue,
  getSessionLlmConfig,
  getSessionIdentifier,
  toPublicSessionConfig,
  upsertSessionLlmConfig,
};
