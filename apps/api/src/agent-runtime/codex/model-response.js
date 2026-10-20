const { AgentRuntimeError } = require('../contracts');
const { modelFailure } = require('./model-errors');

const LIMIT = 2 * 1024 * 1024;

// A response is held until its terminal event is validated. Failed attempts
// cannot authorize tools or partially reach Codex, so a bounded relay retry
// never replays a business operation. Raw buffered data is live memory only.
async function readModelResponse(response) {
  if (!response.ok) {
    let body = '';
    try {
      for await (const chunk of response.body || []) {
        body += Buffer.from(chunk).toString('utf8');
        if (Buffer.byteLength(body) > 16384) { body = ''; break; }
      }
    } catch { /* The HTTP status remains useful when the error body is absent. */ }
    let error;
    try { error = JSON.parse(body).error; } catch { /* Never expose raw text. */ }
    throw modelFailure({ status: response.status, error, retryAfter: response.headers.get('retry-after') });
  }
  if (!response.body) throw new AgentRuntimeError('model_response_incomplete', '模型未返回完整结果，请重试');
  const chunks = [];
  const decoder = new TextDecoder();
  let bytes = 0, buffer = '', completed = false;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > LIMIT) throw new AgentRuntimeError('output_limit', 'Model response exceeds limit');
    chunks.push(Buffer.from(chunk));
    buffer += decoder.decode(chunk, { stream: true });
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      let event;
      try { event = JSON.parse(data); } catch { throw new AgentRuntimeError('protocol_error', 'Invalid model event'); }
      if (event.type === 'response.failed' || event.type === 'error') {
        throw modelFailure({ error: event.response?.error || event.error || event });
      }
      if (event.type === 'response.incomplete') throw new AgentRuntimeError('model_response_incomplete', '模型未完成本轮分析，请重试');
      if (event.type === 'response.completed') completed = true;
    }
  }
  buffer += decoder.decode();
  if (!completed || buffer.trim()) throw new AgentRuntimeError('model_connection_failed', '模型连接结束前未确认结果，请重试');
  return chunks;
}

module.exports = { readModelResponse };
