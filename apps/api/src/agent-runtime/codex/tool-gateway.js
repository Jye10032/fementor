const Ajv = require('ajv');
const { AgentRuntimeError } = require('../contracts');
const { withAbort } = require('./abort');

const denied = () => new AgentRuntimeError('tool_request_denied', 'Tool request does not match the live host capability');
const canonical = (value) => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map((item) => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(canonical(value[key]))])) : value);

// This object stays in the API process. VM tool definitions/results are never
// authoritative. Calls must first be witnessed in the upstream model stream.
class ToolGateway {
  constructor({ specs = [], onTool, signal, maxCalls = 2 }) {
    this.specs = JSON.parse(JSON.stringify(specs));
    this.onTool = onTool;
    this.signal = signal;
    this.maxCalls = Math.min(maxCalls, 2);
    this.records = new Map();
    this.reasoning = new Map();
    this.closed = false;
    this.validators = new Map();
    const ajv = new Ajv({ strict: true, allErrors: false });
    for (const spec of this.specs) {
      if (spec.type !== 'function' || spec.name !== 'run_expert' || this.validators.has(spec.name)
          || typeof spec.description !== 'string' || !spec.inputSchema || spec.deferLoading) throw denied();
      this.validators.set(spec.name, ajv.compile(spec.inputSchema));
    }
  }

  bind(threadId, turnId) {
    if (this.closed || this.threadId || !threadId || !turnId) throw denied();
    Object.assign(this, { threadId, turnId });
  }

  dynamicTools() { return JSON.parse(JSON.stringify(this.specs)); }
  modelTools() {
    return this.specs.map(({ name, description, inputSchema }) => ({ type: 'function', name, description, parameters: inputSchema, strict: false }));
  }

  observeCall(item) {
    if (this.closed || this.signal.aborted || !this.validators.has(item.name) || item.namespace != null
        || typeof item.call_id !== 'string' || !item.call_id || item.call_id.length > 200
        || typeof item.arguments !== 'string' || Buffer.byteLength(item.arguments) > 16384) throw denied();
    let args;
    try { args = JSON.parse(item.arguments); } catch { throw denied(); }
    if (!this.validators.get(item.name)(args)) throw denied();
    const existing = this.records.get(item.call_id);
    if (existing) {
      if (existing.name !== item.name || canonical(existing.args) !== canonical(args)) throw denied();
      return;
    }
    if (this.records.size >= this.maxCalls || [...this.records.values()].some((record) => !record.response)) {
      throw new AgentRuntimeError('tool_budget_exceeded', 'Only bounded serial expert calls are permitted');
    }
    this.records.set(item.call_id, { name: item.name, args, callId: item.call_id, replays: 0 });
  }

  observeReasoning(item) {
    if (this.closed || this.signal.aborted || typeof item.id !== 'string' || item.id.length > 200
        || (item.encrypted_content != null && typeof item.encrypted_content !== 'string')) throw denied();
    // Opaque provider state is kept only in this live gateway, never journals.
    const safe = { type: 'reasoning', id: item.id, summary: [] };
    if (item.encrypted_content != null) safe.encrypted_content = item.encrypted_content;
    if (Buffer.byteLength(JSON.stringify(safe)) > 128 * 1024 || (!this.reasoning.has(item.id) && this.reasoning.size >= 16)) {
      throw new AgentRuntimeError('output_limit', 'Reasoning state exceeds limit');
    }
    const existing = this.reasoning.get(item.id);
    if (existing && canonical(existing) !== canonical(safe)) throw denied();
    this.reasoning.set(item.id, safe);
  }

  async handle(params) {
    if (this.closed || this.signal.aborted || params.threadId !== this.threadId || params.turnId !== this.turnId
        || params.namespace != null) throw denied();
    const record = this.records.get(params.callId);
    if (!record || params.tool !== record.name || canonical(params.arguments) !== canonical(record.args)) throw denied();
    if (record.promise) {
      if (++record.replays > 2) throw denied();
      return record.promise;
    }
    record.promise = (async () => {
      const result = await this.onTool({ name: record.name, args: structuredClone(record.args), callId: record.callId, signal: this.signal });
      if (this.closed || this.signal.aborted) throw denied();
      const text = JSON.stringify(result);
      if (typeof text !== 'string' || Buffer.byteLength(text) > 256 * 1024) throw new AgentRuntimeError('output_limit', 'Tool result exceeds limit');
      record.output = text;
      record.response = { success: true, contentItems: [{ type: 'inputText', text }] };
      return record.response;
    })();
    return withAbort(() => record.promise, this.signal);
  }

  rebuildHistory(input) {
    const seenCalls = new Set(), seenResults = new Set();
    const rebuilt = input.map((item) => {
      if (item?.type === 'reasoning') {
        const observed = this.reasoning.get(item.id);
        if (!observed || (item.encrypted_content ?? null) !== (observed.encrypted_content ?? null)) throw denied();
        return structuredClone(observed);
      }
      if (!['function_call', 'function_call_output'].includes(item?.type)) return item;
      const record = this.records.get(item.call_id);
      if (!record?.response) throw denied();
      if (item.type === 'function_call') {
        if (seenCalls.has(item.call_id) || item.name !== record.name || item.namespace != null) throw denied();
        let args;
        try { args = JSON.parse(item.arguments); } catch { throw denied(); }
        if (canonical(args) !== canonical(record.args)) throw denied();
        seenCalls.add(item.call_id);
        return { type: 'function_call', name: record.name, call_id: record.callId, arguments: JSON.stringify(record.args) };
      }
      if (!seenCalls.has(item.call_id) || seenResults.has(item.call_id)) throw denied();
      seenResults.add(item.call_id);
      return { type: 'function_call_output', call_id: record.callId, output: record.output };
    });
    if (seenResults.size !== this.records.size) throw denied();
    return rebuilt;
  }

  close() { this.closed = true; }
  async drain() { await Promise.allSettled([...this.records.values()].map((record) => record.promise)); }
}

// Only the bounded relay response is observed; parsing never reads provider
// headers or logs reasoning. Both standard item.done and completed-only streams
// are accepted. Added/delta events cannot authorize a partially formed call.
class ToolStreamObserver {
  constructor(gateway) { this.gateway = gateway; this.decoder = new TextDecoder(); this.buffer = ''; }
  push(chunk, final = false) {
    this.buffer += this.decoder.decode(chunk, { stream: !final });
    if (this.buffer.length > 2 * 1024 * 1024) throw new AgentRuntimeError('output_limit', 'Model event exceeds limit');
    let match;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      let event;
      try { event = JSON.parse(data); } catch { throw new AgentRuntimeError('protocol_error', 'Invalid model event'); }
      const items = event.type === 'response.output_item.done' ? [event.item]
        : event.type === 'response.completed' ? event.response?.output || [] : [];
      for (const item of items) {
        if (item?.type === 'function_call') this.gateway.observeCall(item);
        if (item?.type === 'reasoning') this.gateway.observeReasoning(item);
      }
    }
    if (final && this.buffer.trim()) throw new AgentRuntimeError('protocol_error', 'Incomplete model event');
  }
}

module.exports = { ToolGateway, ToolStreamObserver };
