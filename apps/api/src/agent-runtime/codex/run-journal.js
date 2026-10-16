const fs = require('node:fs');
const path = require('node:path');
const { RECOVERABLE_PROFILE_IDS } = require('./config');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TERMINAL_CLEANUP = new Set(['not_created', 'destroyed']);
const CLEANUP_STATES = new Set([...TERMINAL_CLEANUP, 'pending', 'cleanup_pending', 'create_unknown']);
const journalDirectory = (env = process.env) => path.resolve(env.CODEX_RUN_JOURNAL_DIR || path.join(__dirname, '../../../data/codex-interview-runs'));

function saveRunRecord(file, record) {
  const temporary = `${file}.tmp`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

// Malformed records block admission but never supply a deletion target.
function readRunRecords(directory, environmentId) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return fs.readdirSync(directory).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const file = path.join(directory, name);
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!record || !UUID.test(record.runId) || name !== `${record.runId}.json`
          || record.environmentId !== environmentId || !RECOVERABLE_PROFILE_IDS.has(record.profileId)
          || !CLEANUP_STATES.has(record.cleanup) || (record.sandboxId && !UUID.test(record.sandboxId))) {
        return { file, errorCode: 'journal_invalid' };
      }
      return { file, record };
    } catch { return { file, errorCode: 'journal_unreadable' }; }
  });
}

module.exports = { UUID, TERMINAL_CLEANUP, journalDirectory, readRunRecords, saveRunRecord };
