const fs = require('fs');
const path = require('path');
const {
  deleteObject,
  downloadTextObject,
  getBucketName,
  getObjectPath,
  getPublicPath,
  isStorageEnabled,
  listObjects,
  uploadTextObject,
} = require('../storage');

const DATA_ROOT = path.resolve(__dirname, '../../../../data');
const USER_DOC_ROOT = path.join(DATA_ROOT, 'user_docs');

const sanitizeUserId = (input) => String(input || '').replace(/[^a-zA-Z0-9_-]/g, '_');

const getUserBaseDir = (userId) => path.join(USER_DOC_ROOT, sanitizeUserId(userId));

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const ensureUserDocDir = (userId) => ensureDir(getUserBaseDir(userId));
const ensureUserProfileDir = (userId) => ensureDir(path.join(getUserBaseDir(userId), 'profile'));
const ensureUserKnowledgeDir = (userId) => ensureDir(path.join(getUserBaseDir(userId), 'knowledge'));

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
    const candidateName = `${baseName}-${index}${extension}`;
    const candidatePath = path.join(dir, candidateName);
    if (!fs.existsSync(candidatePath)) {
      return candidatePath;
    }
    index += 1;
  }

  return path.join(dir, `${baseName}-${Date.now()}${extension}`);
};

const saveUserDoc = ({ userId, content, filename, prefix, category = 'knowledge' }) => {
  const dir = category === 'profile' ? ensureUserProfileDir(userId) : ensureUserKnowledgeDir(userId);
  const safePrefix = String(prefix || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_');
  const rawName = String(filename || '').trim() || `${safePrefix}-${Date.now()}.md`;
  const parsed = path.parse(rawName);
  const normalizedName = `${normalizeFileStem(parsed.name, `${safePrefix}-${Date.now()}`)}${parsed.ext || ''}`;
  const targetName = normalizedName.startsWith(`${safePrefix}-`) ? normalizedName : `${safePrefix}-${normalizedName}`;
  const target = createUniqueFilePath({ dir, filename: targetName, content });
  fs.writeFileSync(target, String(content || ''), 'utf8');
  return target;
};

const saveJdDoc = async ({ userId, jdText, filename }) => {
  if (!isStorageEnabled()) {
    return saveUserDoc({ userId, content: jdText, filename, prefix: 'jd', category: 'profile' });
  }

  const rawName = String(filename || '').trim() || `jd-${Date.now()}.md`;
  const parsed = path.parse(rawName);
  const normalizedName = `${normalizeFileStem(parsed.name, `jd-${Date.now()}`)}${parsed.ext || ''}`;
  const targetName = normalizedName.startsWith('jd-') ? normalizedName : `jd-${normalizedName}`;
  const bucket = getBucketName('jd');
  const objectPath = getObjectPath({ userId, fileName: targetName });
  const uploaded = await uploadTextObject({
    bucket,
    objectPath,
    content: jdText,
    contentType: 'text/markdown; charset=utf-8',
    upsert: true,
  });
  return uploaded.path;
};

const collectDocEntries = (dir, prefix = '') => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !prefix || entry.name.startsWith(`${prefix}-`))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
      };
    });
};

const listUserDocs = (userId, options = {}) => {
  const dir = ensureUserKnowledgeDir(userId);
  const legacyDir = ensureUserDocDir(userId);
  const prefix = String(options.prefix || '').trim();
  return [
    ...collectDocEntries(dir, prefix),
    ...collectDocEntries(legacyDir, prefix).filter((item) => !/^(resume|jd)-/i.test(item.name)),
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

const listProfileDocsLocal = (userId, prefix = '') => {
  const profileDir = ensureUserProfileDir(userId);
  const legacyDir = ensureUserDocDir(userId);
  return [
    ...collectDocEntries(profileDir, prefix),
    ...collectDocEntries(legacyDir, prefix),
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

const listProfileDocs = async (userId, prefix = '') => {
  if (!isStorageEnabled()) {
    return listProfileDocsLocal(userId, prefix);
  }

  const bucket = getBucketName(prefix === 'jd' ? 'jd' : 'resume');
  const objectPrefix = `${sanitizeUserId(userId)}/`;
  const items = await listObjects({ bucket, prefix: objectPrefix });
  return items
    .filter((item) => item?.name)
    .filter((item) => !prefix || item.name.startsWith(`${prefix}-`))
    .map((item) => ({
      name: item.name,
      path: getPublicPath({ bucket, objectPath: `${objectPrefix}${item.name}` }),
      size: Number(item.metadata?.size || item.size || 0),
      updated_at: String(item.updated_at || item.created_at || ''),
    }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

const listJdDocs = async (userId) => listProfileDocs(userId, 'jd');

const resolveUserDocPaths = ({ userId, fileName, prefix, category = 'knowledge' }) => {
  const primaryDir = category === 'profile' ? ensureUserProfileDir(userId) : ensureUserKnowledgeDir(userId);
  const legacyDir = ensureUserDocDir(userId);
  const inputName = String(fileName || '').trim();
  const parsed = path.parse(inputName);
  const safeName = inputName
    ? `${normalizeFileStem(parsed.name, 'doc')}${parsed.ext || ''}`
    : '';
  const candidates = [];

  if (safeName) {
    candidates.push(safeName);
    if (prefix && !safeName.startsWith(`${prefix}-`)) {
      candidates.push(`${prefix}-${safeName}`);
    }
  }

  return candidates
    .map((name) => [path.join(primaryDir, name), path.join(legacyDir, name)])
    .flat()
    .filter((candidate, index, allCandidates) => allCandidates.indexOf(candidate) === index)
    .filter((candidate) => fs.existsSync(candidate));
};

const readUserDoc = ({ userId, fileName, prefix, category = 'knowledge' }) => {
  const [fullPath] = resolveUserDocPaths({ userId, fileName, prefix, category });
  if (!fullPath) return null;

  return {
    name: path.basename(fullPath),
    path: fullPath,
    content: fs.readFileSync(fullPath, 'utf8'),
  };
};

const readJdDoc = async ({ userId, fileName }) => {
  if (!isStorageEnabled()) {
    return readUserDoc({ userId, fileName, prefix: 'jd', category: 'profile' });
  }

  const bucket = getBucketName('jd');
  const objectPath = getObjectPath({
    userId,
    fileName: String(fileName || '').startsWith('jd-') ? fileName : `jd-${fileName}`,
  });
  return downloadTextObject({ bucket, objectPath });
};

const deleteUserDoc = ({ userId, fileName, prefix, category = 'profile' }) => {
  const matchedPaths = resolveUserDocPaths({ userId, fileName, prefix, category });
  if (!matchedPaths.length) return false;

  for (const matchedPath of matchedPaths) {
    fs.unlinkSync(matchedPath);
  }

  return true;
};

const deleteJdDoc = async ({ userId, fileName }) => {
  if (!isStorageEnabled()) {
    return deleteUserDoc({ userId, fileName, prefix: 'jd', category: 'profile' });
  }

  const bucket = getBucketName('jd');
  const objectPath = getObjectPath({
    userId,
    fileName: String(fileName || '').startsWith('jd-') ? fileName : `jd-${fileName}`,
  });
  return deleteObject({ bucket, objectPath });
};

module.exports = {
  DATA_ROOT,
  USER_DOC_ROOT,
  sanitizeUserId,
  getUserBaseDir,
  ensureDir,
  ensureUserDocDir,
  ensureUserProfileDir,
  ensureUserKnowledgeDir,
  stripKnownDocumentExtensions,
  normalizeFileStem,
  createUniqueFilePath,
  saveUserDoc,
  saveJdDoc,
  collectDocEntries,
  listUserDocs,
  listProfileDocs,
  listJdDocs,
  resolveUserDocPaths,
  readUserDoc,
  readJdDoc,
  deleteUserDoc,
  deleteJdDoc,
};
