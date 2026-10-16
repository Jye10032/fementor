const { ToolStreamObserver } = require('./tool-gateway');
const { AgentRuntimeError } = require('../contracts');
const { getContextPolicy, countTokens } = require('../../interview/token-budget');

class ModelRelay {
  constructor({ config, send, signal, outputSchema, toolGateway, fetchImpl = fetch }) {
    Object.assign(this, { config, send, signal, outputSchema, toolGateway, fetchImpl });
    this.requests = 0;
    this.active = false;
  }

  async handle(frame) {
    if (this.active || ++this.requests > this.config.maxModelRequests) {
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
      const response = await this.fetchImpl(`${this.config.modelBaseUrl}/responses`, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${this.config.modelApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: this.signal,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new AgentRuntimeError('model_upstream_failed', `Model endpoint returned HTTP ${response.status}`);
      }
      await this.send({ channel: 'model', id: frame.id, status: 200 });
      let bytes = 0;
      const observer = this.toolGateway ? new ToolStreamObserver(this.toolGateway) : null;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) throw new AgentRuntimeError('output_limit', 'Model response exceeds limit');
        observer?.push(chunk);
        await this.send({ channel: 'model', id: frame.id, data: Buffer.from(chunk).toString('base64') });
      }
      observer?.push(new Uint8Array(), true);
      await this.send({ channel: 'model', id: frame.id, end: true });
    } finally {
      this.active = false;
    }
  }
}

module.exports = { ModelRelay };
