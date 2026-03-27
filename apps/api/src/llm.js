const DEFAULT_OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const DEFAULT_OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

let runtimeOpenAiBaseUrl = DEFAULT_OPENAI_BASE_URL;
let runtimeOpenAiApiKey = DEFAULT_OPENAI_API_KEY;
let runtimeOpenAiModel = DEFAULT_OPENAI_MODEL;

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/$/, '');

const getLlmConfig = () => ({
  baseUrl: normalizeBaseUrl(runtimeOpenAiBaseUrl || DEFAULT_OPENAI_BASE_URL),
  apiKey: String(runtimeOpenAiApiKey || '').trim(),
  model: String(runtimeOpenAiModel || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
});

const hasProvidedValue = (value) => value !== undefined && String(value).trim() !== '';

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

const hasRealLLM = () => Boolean(getLlmConfig().apiKey);

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

async function requestChatCompletion({ messages, model, stream = false, temperature = 0.2 }) {
  const llmConfig = getLlmConfig();
  const response = await fetch(`${llmConfig.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: model || llmConfig.model,
      messages,
      stream,
      temperature,
    }),
  });
  return response;
}

async function chatCompletion({ messages, model, temperature }) {
  if (!hasRealLLM()) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const response = await requestChatCompletion({
    messages,
    model,
    stream: false,
    temperature,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function jsonCompletion({ messages, model, temperature = 0.2 }) {
  if (!hasRealLLM()) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const content = await chatCompletion({ messages, model, temperature });
  console.log('[llm.jsonCompletion.raw]', { content });
  const parsed = extractJsonObject(content);
  if (parsed === null) {
    throw new Error('LLM JSON completion failed');
  }
  return parsed;
}

async function streamJsonCompletion({ messages, model, temperature = 0.2, onToken }) {
  if (!hasRealLLM()) {
    throw new Error('OPENAI_API_KEY is required');
  }

  let content = '';
  for await (const delta of streamCompletion({ messages, model, temperature })) {
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

async function* streamCompletion({ messages, model, temperature = 0.2 }) {
  if (!hasRealLLM()) {
    throw new Error('OPENAI_API_KEY is required');
  }

  const response = await requestChatCompletion({
    messages,
    model,
    stream: true,
    temperature,
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

module.exports = {
  OPENAI_BASE_URL: DEFAULT_OPENAI_BASE_URL,
  OPENAI_MODEL: DEFAULT_OPENAI_MODEL,
  getLlmConfig,
  setRuntimeLlmConfig,
  hasRealLLM,
  chatCompletion,
  jsonCompletion,
  streamJsonCompletion,
  streamCompletion,
};
