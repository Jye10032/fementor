const { ToolStreamObserver } = require('./tool-gateway');
const { AgentRuntimeError } = require('../contracts');
const { getContextPolicy, countTokens } = require('../../interview/token-budget');
const { setTimeout: delay } = require('node:timers/promises');
const { readModelResponse } = require('./model-response');
const { TRANSIENT, MESSAGES } = require('./model-errors');

class ModelRelay {
  constructor({ config, send, signal, outputSchema, toolGateway, onLifecycle = () => {}, onRetry = () => {}, fetchImpl = fetch }) {
    Object.assign(this, { config, send, signal, outputSchema, toolGateway, onLifecycle, onRetry, fetchImpl });
    this.requests = 0;
    this.active = false;
  }

  async handle(frame) {
    if (this.active || this.requests >= this.config.maxModelRequests) {
      throw new AgentRuntimeError('model_budget_exceeded', 'Model request budget exceeded');
    }
    if (frame.method !== 'POST' || frame.path !== '/v1/responses' || typeof frame.body !== 'string' || Buffer.byteLength(frame.body) > 512 * 1024) {
      throw new AgentRuntimeError('model_request_denied', 'Model relay accepts only bounded Responses requests');
    }
    let body;
    try { body = JSON.parse(frame.body); } catch { throw new AgentRuntimeError('model_request_denied', 'Invalid model request'); }
    if (!body || body.model !== this.config.model || !Array.isArray(body.input)) {
      throw new AgentRuntimeError('model_request_denied', 'Model request does not match the server profile');
    }
    // Responses Lite puts tool definitions inside input as additional_tools.
    // Remove that capability-bearing metadata too; tools: [] alone is insufficient.
    const history = this.toolGateway ? this.toolGateway.rebuildHistory(body.input) : body.input;
    const input = history.filter((item) => item?.type !== 'additional_tools').map((item) => {
      if (this.toolGateway && ['function_call', 'function_call_output', 'reasoning'].includes(item?.type)) return item;
      if (!item || (item.type && item.type !== 'message') || !['system', 'developer', 'user', 'assistant'].includes(item.role)) {
        const kind = /^[a-z_]{1,40}$/.test(item?.type) ? item.type : 'unknown';
        throw new AgentRuntimeError('model_request_denied', `Only inline text messages are allowed (received ${kind})`);
      }
      let content = item.content;
      if (Array.isArray(content)) {
        content = content.map((part) => {
          if (!part || !['input_text', 'output_text'].includes(part.type) || typeof part.text !== 'string') {
            throw new AgentRuntimeError('model_request_denied', 'Files, images and item references are not allowed');
          }
          return part.text;
        }).join('\n');
      }
      if (typeof content !== 'string') throw new AgentRuntimeError('model_request_denied', 'Message content must be inline text');
      return { role: item.role, content };
    });
    if (body.instructions !== undefined && typeof body.instructions !== 'string') {
      throw new AgentRuntimeError('model_request_denied', 'Model instructions must be text');
    }
    this.active = true;
    try {
      // Construct a bounded request. Never forward a VM-selected URL, headers,
      // remote tool, callback, previous response ID, or arbitrary request option.
      const request = {
        model: this.config.model,
        input,
        instructions: body.instructions,
        text: { format: { type: 'json_schema', name: this.toolGateway ? 'fementor_decision' : 'fementor_evaluation', strict: true, schema: this.outputSchema } },
        reasoning: { effort: 'low' },
        ...(this.toolGateway ? { include: ['reasoning.encrypted_content'] } : {}),
        tools: this.toolGateway?.modelTools() || [],
        tool_choice: this.toolGateway ? 'auto' : 'none',
        parallel_tool_calls: false,
        stream: true,
        store: false,
        max_output_tokens: this.config.maxOutputTokens,
      };
      // Check the actual forwarded envelope too: Codex may add its own text.
      const policy = getContextPolicy();
      const inputLimit = policy.windowTokens - Math.max(policy.outputReserve, this.config.maxOutputTokens) - policy.safetyReserve;
      if (countTokens(JSON.stringify(request), policy.encoding) > inputLimit) {
        throw new AgentRuntimeError('context_budget_exceeded', '评分输入超出模型预算，已保存的回答可在调整预算后重试');
      }
      const chunks = await this.requestWithRecovery({
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.config.modelApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: this.signal,
      });
      const observer = this.toolGateway ? new ToolStreamObserver(this.toolGateway) : null;
      for (const chunk of chunks) observer?.push(chunk);
      observer?.push(new Uint8Array(), true);
      const deliveryStartedAt = Date.now();
      const responseBytes = Buffer.concat(chunks);
      await this.send({ channel: 'model', id: frame.id, status: 200 });
      // Coalesce small provider deltas to reduce control-channel framing and
      // writes now that the complete bounded response is validated.
      for (let offset = 0; offset < responseBytes.length; offset += 48 * 1024) {
        await this.send({ channel: 'model', id: frame.id, data: responseBytes.subarray(offset, offset + 48 * 1024).toString('base64') });
      }
      await this.send({ channel: 'model', id: frame.id, end: true });
      this.onLifecycle({ state: 'model_response_delivered', request: this.requests, bytes: responseBytes.length, durationMs: Date.now() - deliveryStartedAt });
    } finally {
      this.active = false;
    }
  }

  async requestWithRecovery(init) {
    for (let attempt = 0; ; attempt++) {
      if (this.signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Model request cancelled');
      const number = ++this.requests;
      const startedAt = Date.now();
      let code = null;
      let durationMs;
      try {
        const response = await this.fetchImpl(`${this.config.modelBaseUrl}/responses`, init);
        return await readModelResponse(response);
      } catch (error) {
        if (this.signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Model request cancelled');
        const failure = error instanceof AgentRuntimeError ? error
          : new AgentRuntimeError('model_connection_failed', MESSAGES.model_connection_failed);
        code = failure.code;
        durationMs = Date.now() - startedAt;
        const delayMs = failure.retryAfterMs || 2000;
        if (!TRANSIENT.has(code) || attempt >= 1 || number >= this.config.maxModelRequests || delayMs > 10000) throw failure;
        this.onLifecycle({ state: 'model_retry', request: number, code, delayMs });
        await this.onRetry({ code, delayMs });
        try { await delay(delayMs, undefined, { signal: this.signal }); }
        catch { throw new AgentRuntimeError('run_cancelled', 'Model retry cancelled'); }
      } finally {
        this.onLifecycle({ state: 'model_request_finished', request: number, durationMs: durationMs ?? Date.now() - startedAt, code });
      }
    }
  }
}

module.exports = { ModelRelay };
