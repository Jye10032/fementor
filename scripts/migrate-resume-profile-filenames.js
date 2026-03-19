const fs = require('fs');
const path = require('path');
const Database = require('../apps/api/node_modules/better-sqlite3');

const REPO_ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(REPO_ROOT, 'data');
const USER_DOC_ROOT = path.join(DATA_ROOT, 'user_docs');
const DB_PATH = path.join(DATA_ROOT, 'fementor.db');

const db = new Database(DB_PATH);

const stripKnownDocumentExtensions = (input) => {
  let stem = String(input || '').trim();
  while (/\.(pdf|docx|md|txt)$/i.test(stem)) {
    stem = stem.replace(/\.(pdf|docx|md|txt)$/i, '');
  }
  return stem;
};

const hasMeaningfulStemContent = (input) => /[\p{L}\p{N}]/u.test(String(input || ''));

const normalizeFileStem = (input, fallback = 'doc') => {
  const cleaned = String(input || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/[\s._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned && hasMeaningfulStemContent(cleaned) ? cleaned : fallback;
};

const normalizeStoredTextFilename = ({ filename, prefix }) => {
  const rawName = String(filename || '').trim() || `${prefix || 'doc'}.md`;
  const parsed = path.parse(rawName);
  const sourceStem = stripKnownDocumentExtensions(parsed.name || prefix || 'doc');
  const safeBase = normalizeFileStem(sourceStem, prefix || 'doc');
  return `${safeBase}.md`;
};

const createUniqueFilePath = ({ dir, filename, content }) => {
  const parsed = path.parse(filename);
  const baseName = parsed.name || 'doc';
  const extension = parsed.ext || '';
  const initialPath = path.join(dir, filename);

  if (!fs.existsSync(initialPath)) {
    return initialPath;
  }

  const existingContent = fs.readFileSync(initialPath, 'utf8');
  if (existingContent === String(content || '')) {
    return initialPath;
  }

  let index = 2;
  while (index < 1000) {
    const candidatePath = path.join(dir, `${baseName}-${index}${extension}`);
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    if (fs.readFileSync(candidatePath, 'utf8') === String(content || '')) {
      return candidatePath;
    }
    index += 1;
  }

  return path.join(dir, `${baseName}-${Date.now()}${extension}`);
};

const shouldMigrateResumeFilename = (fileName) => {
  if (!/^resume-/i.test(fileName)) {
    return false;
  }
  const parsed = path.parse(fileName);
  if (parsed.ext.toLowerCase() !== '.md') {
    return true;
  }
  const stemWithoutPrefix = parsed.name.replace(/^resume-/i, '');
  if (!hasMeaningfulStemContent(stripKnownDocumentExtensions(stemWithoutPrefix))) {
    return true;
  }
  return /\.(pdf|docx|txt)$/i.test(parsed.name);
};

const migrateUserProfile = (userId) => {
  const profileDir = path.join(USER_DOC_ROOT, userId, 'profile');
  if (!fs.existsSync(profileDir)) {
    return [];
  }

  const user = db.prepare('SELECT active_resume_file FROM user_profile WHERE id = ?').get(userId) || {};
  const operations = [];
  const fileNames = fs.readdirSync(profileDir).sort();

  for (const fileName of fileNames) {
    if (!shouldMigrateResumeFilename(fileName)) {
      continue;
    }

    const sourcePath = path.join(profileDir, fileName);
    if (!fs.statSync(sourcePath).isFile()) {
      continue;
    }

    const content = fs.readFileSync(sourcePath, 'utf8');
    const nextName = normalizeStoredTextFilename({ filename: fileName, prefix: 'resume' });
    const targetPath = createUniqueFilePath({ dir: profileDir, filename: nextName, content });
    const targetName = path.basename(targetPath);

    if (targetPath !== sourcePath) {
      if (fs.existsSync(targetPath)) {
        const targetContent = fs.readFileSync(targetPath, 'utf8');
        if (targetContent !== content) {
          throw new Error(`refusing to overwrite different content: ${targetName}`);
        }
        fs.unlinkSync(sourcePath);
      } else {
        fs.renameSync(sourcePath, targetPath);
      }
    }

    if (user.active_resume_file === fileName) {
      db.prepare('UPDATE user_profile SET active_resume_file = ?, updated_at = ? WHERE id = ?')
        .run(targetName, new Date().toISOString(), userId);
      user.active_resume_file = targetName;
    }

    operations.push({
      user_id: userId,
      from: fileName,
      to: targetName,
      active_updated: user.active_resume_file === targetName,
    });
  }

  return operations;
};

const run = () => {
  const userIds = fs.existsSync(USER_DOC_ROOT)
    ? fs.readdirSync(USER_DOC_ROOT).filter((name) => fs.existsSync(path.join(USER_DOC_ROOT, name, 'profile')))
    : [];

  const results = userIds.flatMap((userId) => migrateUserProfile(userId));
  console.log(JSON.stringify({ migrated: results.length, items: results }, null, 2));
};

try {
  run();
} finally {
  db.close();
}
