// Deployed verbatim into the VM. No FEMentor package imports or credentials.
const http = require('node:http');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

let sequence = 0;
let child;
let stopping = false;
const responses = new Map();
let writes = Promise.resolve();
function send(frame) {
  writes = writes.then(async () => {
    if (!process.stdout.write(JSON.stringify(frame) + '\n')) await once(process.stdout, 'drain');
  });
  writes.catch(() => stop(1));
  return writes;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const response of responses.values()) response.destroy();
  server.close();
  child?.kill('SIGTERM');
  setTimeout(() => { child?.kill('SIGKILL'); process.exit(code); }, 1500);
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses' || responses.size) {
    response.writeHead(403).end();
    return;
  }
  const id = ++sequence;
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 512 * 1024) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    responses.set(id, response);
    response.on('close', () => responses.delete(id));
    await send({ channel: 'model', id, method: request.method, path: request.url, body: Buffer.concat(chunks).toString('utf8') });
  } catch { response.destroy(); }
});
server.requestTimeout = 150000;
server.on('error', () => stop(1));

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  try {
    const frame = JSON.parse(line);
    if (frame.channel === 'rpc' && typeof frame.data === 'string') child.stdin.write(frame.data);
    else if (frame.channel === 'model') {
      const response = responses.get(frame.id);
      if (!response) return;
      if (frame.status) response.writeHead(frame.status, { 'Content-Type': 'text/event-stream' });
      if (frame.data) response.write(Buffer.from(frame.data, 'base64'));
      if (frame.end) { response.end(); responses.delete(frame.id); }
    } else stop(1);
  } catch { stop(1); }
});
lines.on('close', () => stop());
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());

server.listen(43187, '127.0.0.1', () => {
  child = spawn(process.env.FEMENTOR_CODEX_BIN || '/opt/fementor/bin/codex', ['app-server', '--listen', 'stdio://'], {
    cwd: process.env.FEMENTOR_WORK_DIR || '/work',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME, LANG: 'C.UTF-8' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => {
    child.stdout.pause();
    send({ channel: 'rpc', data: data.toString('base64') }).then(() => child.stdout.resume());
  });
  child.stderr.on('data', (data) => {
    // Keep diagnostics separate from JSON-RPC; the host only records byte counts.
    child.stderr.pause();
    send({ channel: 'stderr', bytes: data.length }).then(() => child.stderr.resume());
  });
  child.on('error', () => { send({ channel: 'exit', code: 1 }).finally(() => stop(1)); });
  child.on('exit', (code) => { send({ channel: 'exit', code }).finally(() => stop(code || 0)); });
  child.stdin.on('error', () => stop(1));
  send({ channel: 'ready' });
});
