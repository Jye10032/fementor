const { StringDecoder } = require('node:string_decoder');
const { AgentRuntimeError } = require('../contracts');

class JsonlDecoder {
  constructor(onMessage, { maxBytes = 2 * 1024 * 1024 } = {}) {
    this.onMessage = onMessage;
    this.maxBytes = maxBytes;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
  }

  push(chunk) {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    let boundary;
    while ((boundary = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (Buffer.byteLength(line) > this.maxBytes) throw new AgentRuntimeError('output_limit', 'Protocol frame exceeds limit');
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { throw new AgentRuntimeError('protocol_error', 'Invalid protocol JSON'); }
      this.onMessage(message);
    }
    if (Buffer.byteLength(this.buffer) > this.maxBytes) throw new AgentRuntimeError('output_limit', 'Unterminated protocol frame exceeds limit');
  }
}

module.exports = { JsonlDecoder };
