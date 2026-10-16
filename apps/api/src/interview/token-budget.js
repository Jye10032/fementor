const { get_encoding } = require('tiktoken');
const { createHttpError } = require('../http');
const encodings = new Map();

function getContextPolicy(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const windowTokens = integer('INTERVIEW_CONTEXT_WINDOW_TOKENS', 65536, 8192, 262144);
  const outputReserve = integer('INTERVIEW_OUTPUT_RESERVE_TOKENS', 8192, 6000, 32768);
  const safetyReserve = 2048;
  const encoding = env.INTERVIEW_TOKEN_ENCODING || 'o200k_base';
  if (!['o200k_base', 'cl100k_base'].includes(encoding) || windowTokens <= outputReserve + safetyReserve + 1024) {
    throw new Error('Invalid interview context budget');
  }
  return { encoding, windowTokens, outputReserve, safetyReserve,
    inputTokens: windowTokens - outputReserve - safetyReserve, maxBytes: 384 * 1024 };
}

function tokenizer(encoding) {
  if (!encodings.has(encoding)) encodings.set(encoding, get_encoding(encoding));
  return encodings.get(encoding);
}
const countTokens = (text, encoding = 'o200k_base') => tokenizer(encoding).encode(String(text), [], []).length;
const excerpt = (text, limit, encoding) => {
  const encoder = tokenizer(encoding), tokens = encoder.encode(String(text || ''), [], []);
  return tokens.length <= limit ? String(text || '') : `${Buffer.from(encoder.decode(tokens.slice(0, limit))).toString('utf8').replace(/\uFFFD$/u, '')}…[摘录]`;
};
const contextTooLarge = () => Object.assign(createHttpError(413,
  '完整回答和必要材料超出当前模型输入预算，回答已保留；请精简材料或调整服务端预算后重试'), { code: 'context_budget_exceeded' });

module.exports = { getContextPolicy, countTokens, excerpt, contextTooLarge };
