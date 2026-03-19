const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { extractSirchmunkItemsFromOutputs } = require('./adapter');

const DATA_ROOT = path.resolve(__dirname, '../../../../../data');
const SIRCHMUNK_BIN = process.env.SIRCHMUNK_BIN || 'sirchmunk';
const SIRCHMUNK_MODE = process.env.SIRCHMUNK_MODE || 'FAST';
const SIRCHMUNK_WORK_PATH = process.env.SIRCHMUNK_WORK_PATH || path.join(DATA_ROOT, '.sirchmunk');
const SIRCHMUNK_TIMEOUT_MS = Number(process.env.SIRCHMUNK_TIMEOUT_MS || 70000);

const hasCommand = (name) => {
  if (String(name || '').includes(path.sep)) {
    try {
      fs.accessSync(name, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  return result.status === 0 && String(result.stdout || '').trim().length > 0;
};

const sirchmunkSearch = ({ query, paths, limit = 5, mode = SIRCHMUNK_MODE }) =>
  new Promise((resolve) => {
    if (!hasCommand(SIRCHMUNK_BIN)) {
      resolve({
        available: false,
        items: [],
        message: `${SIRCHMUNK_BIN} command not found`,
      });
      return;
    }

    const validPaths = (paths || []).filter((item) => fs.existsSync(item));
    if (validPaths.length === 0) {
      resolve({
        available: true,
        items: [],
        message: 'no valid search paths for sirchmunk',
      });
      return;
    }

    fs.mkdirSync(SIRCHMUNK_WORK_PATH, { recursive: true });

    const env = {
      ...process.env,
      SIRCHMUNK_WORK_PATH,
      LLM_API_KEY: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      LLM_BASE_URL: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      LLM_MODEL_NAME: process.env.LLM_MODEL_NAME || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };

    const effectiveMode = String(mode || SIRCHMUNK_MODE || 'FAST').trim().toUpperCase() || 'FAST';
    const args = ['search', query, ...validPaths, '--mode', effectiveMode, '--output', 'json'];
    const child = spawn(SIRCHMUNK_BIN, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timeoutId = null;

    const finalize = (payload) => {
      if (finished) return;
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(payload);
    };

    timeoutId = setTimeout(() => {
      const partialItems = extractSirchmunkItemsFromOutputs({ stdout, stderr, limit });
      child.kill('SIGTERM');
      finalize({
        available: true,
        items: partialItems,
        message: partialItems.length > 0 ? 'sirchmunk partial timeout' : 'sirchmunk timed out',
      });
    }, SIRCHMUNK_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '');
      stdout += text;
      console.log('[sirchmunk.stdout.chunk]', text);
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '');
      stderr += text;
      console.log('[sirchmunk.stderr.chunk]', text);
    });

    child.on('error', (error) => {
      console.log('[sirchmunk.raw]', {
        bin: SIRCHMUNK_BIN,
        args,
        mode: effectiveMode,
        status: null,
        signal: null,
        error: error?.message || 'unknown error',
        stdout,
        stderr,
      });
      finalize({
        available: true,
        items: [],
        message: String(error?.message || 'sirchmunk failed'),
      });
    });

    child.on('close', (code, signal) => {
      console.log('[sirchmunk.raw]', {
        bin: SIRCHMUNK_BIN,
        args,
        mode: effectiveMode,
        status: code,
        signal: signal || null,
        error: null,
        stdout,
        stderr,
      });

      if (code !== 0) {
        finalize({
          available: true,
          items: [],
          message: String(stderr || 'sirchmunk failed'),
        });
        return;
      }

      const items = extractSirchmunkItemsFromOutputs({ stdout, stderr, limit });
      if (items.length === 0) {
        finalize({ available: true, items: [], message: 'empty sirchmunk output' });
        return;
      }

      finalize({
        available: true,
        items,
        message: 'ok',
      });
    });
  });

const getSirchmunkStatus = () => ({
  enabled: hasCommand(SIRCHMUNK_BIN),
  bin: SIRCHMUNK_BIN,
  mode: SIRCHMUNK_MODE,
  work_path: SIRCHMUNK_WORK_PATH,
});

module.exports = {
  sirchmunkSearch,
  getSirchmunkStatus,
};
