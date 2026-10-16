const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-director-startup-'));
const entrypoint = path.resolve(__dirname, '../../src/server.js');
const environment = (mode) => ({ ...process.env, DATABASE_URL: '', SUPABASE: '', PORT: '0',
  APP_RUNTIME_MODE: 'local', PUBLIC_SOURCE_DRIVER: 'sqlite', DB_PATH: path.join(directory, `${mode}.db`),
  INTERVIEW_ORCHESTRATOR: mode, INTERVIEW_PIPELINE_VERSION: 'unified', AGENT_RUNTIME: mode === 'director' ? 'codex' : 'native-api' });
test('raw server rejects director after dotenv and before DB initialization/listening', () => {
  const source = fs.readFileSync(entrypoint, 'utf8');
  assert.ok(source.indexOf("require('dotenv').config") < source.indexOf('getInterviewOrchestrator()'));
  const child = spawnSync(process.execPath, [entrypoint], { env: environment('director'), timeout: 5000, encoding: 'utf8' });
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /invalid_config/);
  assert.match(child.stderr, /requires the Fastify server entrypoint/);
  assert.doesNotMatch(child.stdout, /listening on/);
  assert.equal(fs.existsSync(environment('director').DB_PATH), false);
});
test('raw server workflow starts and shuts down normally', async () => {
  const child = spawn(process.execPath, [entrypoint], { env: environment('workflow'), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  const closed = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`workflow startup timed out: ${errors}`)), 5000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`workflow exited before listening: ${code}: ${errors}`)); });
      child.stderr.on('data', (chunk) => { errors += chunk; });
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('[fementor-api] listening on')) { clearTimeout(timer); resolve(); }
      });
    });
    child.kill('SIGTERM');
    assert.deepEqual(await closed, { code: 0, signal: null });
    assert.ok(fs.existsSync(environment('workflow').DB_PATH));
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
});
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
