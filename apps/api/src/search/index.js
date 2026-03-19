const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureUserDocDir } = require('../doc');

const parseRgLine = (line) => {
  const matched = line.match(/^(.+?):(\d+):(.*)$/);
  if (!matched) return null;
  return {
    file: matched[1],
    line: Number(matched[2]),
    text: matched[3],
  };
};

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

const localSearch = ({ userId, keywords, limit = 20, paths = [] }) => {
  const dir = ensureUserDocDir(userId);
  const targets = (Array.isArray(paths) && paths.length > 0 ? paths : [dir])
    .map((item) => String(item || '').trim())
    .filter((item) => item && fs.existsSync(item));
  const terms = (Array.isArray(keywords) ? keywords : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  if (terms.length === 0 || targets.length === 0) return [];

  const hits = new Map();

  for (const term of terms) {
    const proc = spawnSync(
      'rg',
      ['-n', '--no-heading', '--max-count', '3', '-F', term, ...targets],
      { encoding: 'utf8' },
    );

    if (proc.error) {
      continue;
    }
    const out = String(proc.stdout || '').trim();
    if (!out) continue;

    for (const raw of out.split('\n')) {
      const row = parseRgLine(raw);
      if (!row) continue;
      const key = `${row.file}:${row.line}`;
      if (!hits.has(key)) {
        hits.set(key, { ...row, keywords: [term] });
      } else {
        const existing = hits.get(key);
        if (!existing.keywords.includes(term)) existing.keywords.push(term);
      }
    }
  }

  return Array.from(hits.values())
    .sort((a, b) => b.keywords.length - a.keywords.length)
    .slice(0, limit);
};

module.exports = {
  parseRgLine,
  hasCommand,
  localSearch,
};
