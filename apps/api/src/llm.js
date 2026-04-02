const { getSessionLlmConfig } = require('./lib/session-llm-config-store');

const DEFAULT_OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const DEFAULT_OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const NETWORK_RETRY_ATTEMPTS = Math.max(0, Number(process.env.LLM_NETWORK_RETRY_ATTEMPTS || 2));
const NETWORK_RETRY_BASE_DELAY_MS = Math.max(0, Number(process.env.LLM_NETWORK_RETRY_BASE_DELAY_MS || 400));

let runtimeOpenAiBaseUrl = DEFAULT_OPENAI_BASE_URL;
let runtimeOpenAiApiKey = DEFAULT_OPENAI_API_KEY;
let runtimeOpenAiModel = DEFAULT_OPENAI_MODEL;

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/$/, '');
const hasProvidedValue = (value) => value !== undefined && String(value).trim() !== '';

const normalizeRuntimeConfig = ({ baseUrl = '', apiKey = '', model = '' }) => ({
  baseUrl: normalizeBaseUrl(baseUrl) || DEFAULT_OPENAI_BASE_URL,
  apiKey: String(apiKey || '').trim(),
  model: String(model || '').trim() || DEFAULT_OPENAI_MODEL,
});

const buildLlmRuntimeConfig = ({ runtimeConfig = null, sessionContext = null } = {}) => {
  const baseConfig = getLlmConfig();
  if (runtimeConfig) {
    const override = normalizeRuntimeConfig(runtimeConfig);
    return {
      baseUrl: override.baseUrl || baseConfig.baseUrl,
      apiKey: hasProvidedValue(override.apiKey) ? override.apiKey : baseConfig.apiKey,
      model: override.model || baseConfig.model,
    };
  }

  if (!sessionContext || !sessionContext.userId) {
    return baseConfig;
  }

  const storedConfig = getSessionLlmConfig({
    userId: sessionContext.userId,
    token: sessionContext.token,
  });

  if (!storedConfig) {
    return baseConfig;
  }

  return {
    baseUrl: storedConfig.baseUrl || baseConfig.baseUrl,
    apiKey: storedConfig.apiKey || baseConfig.apiKey,
    model: storedConfig.model || baseConfig.model,
  };
};

const getLlmConfig = () => ({
  baseUrl: normalizeBaseUrl(runtimeOpenAiBaseUrl || DEFAULT_OPENAI_BASE_URL),
  apiKey: String(runtimeOpenAiApiKey || '').trim(),
  model: String(runtimeOpenAiModel || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
});

const setRuntimeLlmConfig = ({ baseUrl, apiKey, model } = {}) => {
  if (hasProvidedValue(baseUrl)) {
    runtimeOpenAiBaseUrl = normalizeBaseUrl(baseUrl) || DEFAULT_OPENAI_BASE_URL;
  }
  if (hasProvidedValue(apiKey)) {
    runtimeOpenAiApiKey = String(apiKey || '').trim();
  }
  if (hasProvidedValue(model)) {
    runtimeOpenAiModel = String(model || '').trim() || DEFAULT_OPENAI_MODEL;
  }
  return getLlmConfig();
};

const hasRealLLM = ({ sessionContext, runtimeConfig } = {}) => Boolean(buildLlmRuntimeConfig({ runtimeConfig, sessionContext }).apiKey);
const hasRealSessionLLM = ({ sessionContext, runtimeConfig } = {}) => hasRealLLM({ sessionContext, runtimeConfig });
const getResolvedLlmConfig = (sessionContext) => buildLlmRuntimeConfig({ sessionContext });

const extractJsonObject = (input) => {
  const text = String(input || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {}
  }
  return null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetriableNetworkError = (error) => {
  if (!error) return false;
  const message = String(error?.message || '').toLowerCase();
  const causeCode = String(error?.cause?.code || '').toUpperCase();
  return (
    message.includes('fetch failed')
    || causeCode === 'ECONNRESET'
    || causeCode === 'ECONNREFUSED'
    || causeCode === 'ETIMEDOUT'
    || causeCode === 'UND_ERR_CONNECT_TIMEOUT'
    || causeCode === 'UND_ERR_HEADERS_TIMEOUT'
    || causeCode === 'UND_ERR_SOCKET'
  );
};

async function requestChatCompletion({
  messages,
  model,
  stream = false,
  temperature = 0.2,
  sessionContext,
  runtimeConfig,
}) {
  const llmConfig = buildLlmRuntimeConfig({ runtimeConfig, sessionContext });
  const requestUrl = `${llmConfig.baseUrl}/chat/completions`;
  const requestBody = JSON.stringify({
    model: model || llmConfig.model,
    messages,
    stream,
    temperature,
  });

  for (let attempt = 0; attempt <= NETWORK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmConfig.apiKey}`,
        },
        body: requestBody,
      });
    } catch (error) {
      const willRetry = attempt < NETWORK_RETRY_ATTEMPTS && isRetriableNetworkError(error);
      console.warn('[llm.request.retry]', {
        base_url: llmConfig.baseUrl,
        model: model || llmConfig.model,
        stream,
        attempt: attempt + 1,
        max_attempts: NETWORK_RETRY_ATTEMPTS + 1,
        will_retry: willRetry,
        error: error?.message || String(error),
        cause_code: error?.cause?.code || null,
      });

      if (!willRetry) {
        throw error;
      }

      await sleep(NETWORK_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }

  throw new Error('LLM request failed unexpectedly');
}

async function chatCompletion({
  messages,
  model,
  temperature,
  sessionContext,
  runtimeConfig,
}) {
  if (!hasRealLLM({ sessionContext, runtimeConfig })) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const response = await requestChatCompletion({
    messages,
    model,
    stream: false,
    temperature,
    sessionContext,
    runtimeConfig,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function jsonCompletion({
  messages,
  model,
  temperature = 0.2,
  sessionContext,
  runtimeConfig,
}) {
  const content = await chatCompletion({
    messages,
    model,
    temperature,
    sessionContext,
    runtimeConfig,
  });
  console.log('[llm.jsonCompletion.raw]', { content });
  const parsed = extractJsonObject(content);
  if (parsed === null) {
    throw new Error('LLM JSON completion failed');
  }
  return parsed;
}

async function streamJsonCompletion({
  messages,
  model,
  temperature = 0.2,
  onToken,
  sessionContext,
  runtimeConfig,
}) {
  let content = '';
  for await (const delta of streamCompletion({
    messages,
    model,
    temperature,
    sessionContext,
    runtimeConfig,
  })) {
    content += delta;
    if (typeof onToken === 'function') {
      await onToken(delta);
    }
  }
  console.log('[llm.streamJsonCompletion.raw]', { content });
  const parsed = extractJsonObject(content);
  if (parsed === null) {
    throw new Error('LLM stream JSON completion failed');
  }
  return parsed;
}

async function* streamCompletion({
  messages,
  model,
  temperature = 0.2,
  sessionContext,
  runtimeConfig,
}) {
  if (!hasRealLLM({ sessionContext, runtimeConfig })) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const response = await requestChatCompletion({
    messages,
    model,
    stream: true,
    temperature,
    sessionContext,
    runtimeConfig,
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`LLM stream failed: ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore malformed chunk
      }
    }
  }
}

async function embeddingCompletion({
  input,
  model,
  sessionContext,
  runtimeConfig,
}) {
  const llmConfig = buildLlmRuntimeConfig({ runtimeConfig, sessionContext });
  if (!llmConfig.apiKey) {
    throw new Error('OPENAI_API_KEY is required for embedding');
  }

  const embeddingModel = model || process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const requestUrl = `${llmConfig.baseUrl}/embeddings`;
  const requestBody = JSON.stringify({
    model: embeddingModel,
    input,
  });

  for (let attempt = 0; attempt <= NETWORK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmConfig.apiKey}`,
        },
        body: requestBody,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Embedding request failed: ${response.status} ${text}`);
      }

      const data = await response.json();
      const embeddings = (data?.data || []).map((d) => d.embedding);
      return Array.isArray(input) ? embeddings : embeddings[0] || [];
    } catch (error) {
      const willRetry = attempt < NETWORK_RETRY_ATTEMPTS && isRetriableNetworkError(error);
      if (!willRetry) throw error;
      await sleep(NETWORK_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }

  throw new Error('Embedding request failed unexpectedly');
}

const validateLlmRuntimeConfig = async ({ baseUrl, apiKey, model } = {}) => {
  const runtimeConfig = buildLlmRuntimeConfig({
    runtimeConfig: {
      baseUrl,
      apiKey,
      model,
    },
  });
  if (!runtimeConfig.apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }
  const response = await requestChatCompletion({
    messages: [
      {
        role: 'system',
        content: 'reply with "ok".',
      },
      {
        role: 'user',
        content: 'ping',
      },
    ],
    model: runtimeConfig.model,
    stream: false,
    runtimeConfig,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM validation failed: ${response.status} ${text}`);
  }
  return true;
};

module.exports = {
  OPENAI_BASE_URL: DEFAULT_OPENAI_BASE_URL,
  OPENAI_MODEL: DEFAULT_OPENAI_MODEL,
  extractJsonObject,
  getLlmConfig,
  getResolvedLlmConfig,
  hasRealLLM,
  hasRealSessionLLM,
  setRuntimeLlmConfig,
  validateLlmRuntimeConfig,
  chatCompletion,
  jsonCompletion,
  streamJsonCompletion,
  streamCompletion,
  embeddingCompletion,
};
