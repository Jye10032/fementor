const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasRealLLM = () => Boolean(OPENAI_API_KEY);

const formatValidationError = (error) => {
  if (!error) return 'unknown validation error';
  if (typeof error === 'string') return error;
  return String(error.message || error);
};

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
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: model || OPENAI_MODEL,
      messages,
      stream,
      temperature,
    }),
  });
  return response;
}

async function chatCompletion({ messages, model, temperature }) {
  if (!hasRealLLM()) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    return `Mock应答：已收到你的问题「${String(lastUser).slice(0, 80)}」，当前环境未配置 OPENAI_API_KEY。`;
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

const runValidation = ({ value, validator }) => {
  if (typeof validator !== 'function') {
    return { ok: value !== null && value !== undefined, error: value ? null : 'empty result' };
  }

  try {
    const result = validator(value);
    if (typeof result === 'boolean') {
      return { ok: result, error: result ? null : 'schema validation failed' };
    }
    if (result && typeof result === 'object') {
      return {
        ok: Boolean(result.ok),
        error: result.ok ? null : formatValidationError(result.error),
      };
    }
    return { ok: Boolean(result), error: result ? null : 'schema validation failed' };
  } catch (error) {
    return { ok: false, error: formatValidationError(error) };
  }
};

const applyNormalizer = ({ value, normalizer }) => {
  if (typeof normalizer !== 'function') return value;
  try {
    return normalizer(value);
  } catch {
    return value;
  }
};

const buildRepairMessages = ({ baseMessages, rawContent, validationError, repairPrompt }) => [
  ...baseMessages,
  {
    role: 'assistant',
    content: String(rawContent || '').slice(0, 4000),
  },
  {
    role: 'user',
    content: [
      '你上一次返回的 JSON 不符合要求，请严格修正。',
      `问题：${validationError || '未返回可解析 JSON 或字段不合法'}`,
      repairPrompt || '只返回合法 JSON，不要输出解释、Markdown 或代码块。',
    ].join('\n'),
  },
];

async function jsonCompletion({
  messages,
  model,
  fallback,
  temperature = 0.2,
  validator,
  normalizer,
  retries = 1,
  repairPrompt,
}) {
  if (!hasRealLLM()) return fallback;

  let activeMessages = messages;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const content = await chatCompletion({ messages: activeMessages, model, temperature });
      console.log('[llm.jsonCompletion.raw]', {
        attempt: attempt + 1,
        content,
      });
      const parsed = extractJsonObject(content);
      const normalized = applyNormalizer({ value: parsed, normalizer });
      const validation = runValidation({ value: normalized, validator });

      if (validation.ok) {
        return normalized;
      }

      if (attempt === retries) {
        break;
      }

      activeMessages = buildRepairMessages({
        baseMessages: messages,
        rawContent: content,
        validationError: parsed ? validation.error : '未返回可解析 JSON',
        repairPrompt,
      });
    } catch {
      if (attempt === retries) {
        break;
      }
    }
  }

  return fallback;
}

async function* streamCompletion({ messages, model }) {
  if (!hasRealLLM()) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const mock = `Mock流式应答：已接收「${String(lastUser).slice(0, 80)}」。请配置 OPENAI_API_KEY 以启用真实 LLM。`;
    const parts = mock.match(/.{1,10}/g) || [];
    for (const part of parts) {
      yield part;
      await sleep(40);
    }
    return;
  }

  const response = await requestChatCompletion({
    messages,
    model,
    stream: true,
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
  OPENAI_BASE_URL,
  OPENAI_MODEL,
  hasRealLLM,
  chatCompletion,
  jsonCompletion,
  streamCompletion,
};
