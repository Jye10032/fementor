const fs = require('fs');
const path = require('path');
const {
  ensureUserDocDir,
  ensureUserProfileDir,
  stripKnownDocumentExtensions,
  normalizeFileStem,
  createUniqueFilePath,
  saveUserDoc,
  readUserDoc,
  deleteUserDoc,
} = require('../doc');

const normalizeStoredTextFilename = ({ filename, prefix }) => {
  const rawName = String(filename || '').trim() || `${prefix || 'doc'}.md`;
  const parsed = path.parse(rawName);
  const sourceStem = stripKnownDocumentExtensions(parsed.name || prefix || 'doc');
  const safeBase = normalizeFileStem(sourceStem, prefix || 'doc');
  return `${safeBase}.md`;
};

const RESUME_META_OPEN = '<!-- FEMENTOR_RESUME_META';
const RESUME_META_CLOSE = '-->';

const encodeResumeMetaBlock = (meta = {}) => {
  const normalizedMeta = {
    summary: String(meta.summary || '').trim(),
    original_filename: String(meta.original_filename || '').trim(),
    updated_at: String(meta.updated_at || new Date().toISOString()).trim(),
  };
  return `${RESUME_META_OPEN}\n${JSON.stringify(normalizedMeta, null, 2)}\n${RESUME_META_CLOSE}\n\n`;
};

const parseResumeMetaBlock = (content) => {
  const source = String(content || '');
  if (!source.startsWith(RESUME_META_OPEN)) {
    return { meta: null, content: source, hasMeta: false };
  }

  const closeIndex = source.indexOf(RESUME_META_CLOSE);
  if (closeIndex < 0) {
    return { meta: null, content: source, hasMeta: false };
  }

  const rawMeta = source.slice(RESUME_META_OPEN.length, closeIndex).trim();
  const body = source.slice(closeIndex + RESUME_META_CLOSE.length).replace(/^\s+/, '');

  try {
    const parsed = JSON.parse(rawMeta);
    return {
      meta: parsed && typeof parsed === 'object' ? parsed : null,
      content: body,
      hasMeta: true,
    };
  } catch {
    return {
      meta: null,
      content: body,
      hasMeta: true,
    };
  }
};

const buildResumeMarkdown = ({ resumeText, summary = '', originalFilename = '', updatedAt = '' }) =>
  `${encodeResumeMetaBlock({
    summary,
    original_filename: originalFilename,
    updated_at: updatedAt || new Date().toISOString(),
  })}${String(resumeText || '').trim()}\n`;

const normalizeResumeDocMeta = (meta = {}) => {
  const safeMeta = meta && typeof meta === 'object' ? meta : {};
  return {
    summary: String(safeMeta.summary || '').trim(),
    original_filename: String(safeMeta.original_filename || '').trim(),
    updated_at: String(safeMeta.updated_at || '').trim(),
  };
};

const collectResumeEntries = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => entry.name.startsWith('resume-'))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      const rawContent = fs.readFileSync(fullPath, 'utf8');
      const parsed = parseResumeMetaBlock(rawContent);
      return {
        name: entry.name,
        path: fullPath,
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
        summary: normalizeResumeDocMeta(parsed.meta).summary,
        original_filename: normalizeResumeDocMeta(parsed.meta).original_filename,
      };
    });
};

const saveResumeDoc = ({ userId, resumeText, filename, summary = '', originalFilename = '' }) =>
  saveUserDoc({
    userId,
    content: buildResumeMarkdown({
      resumeText,
      summary,
      originalFilename: originalFilename || filename,
    }),
    filename: normalizeStoredTextFilename({ filename, prefix: 'resume' }),
    prefix: 'resume',
    category: 'profile',
  });

const listResumeDocs = (userId) => {
  const profileDir = ensureUserProfileDir(userId);
  const legacyDir = ensureUserDocDir(userId);
  return [
    ...collectResumeEntries(profileDir),
    ...collectResumeEntries(legacyDir),
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

const readResumeDoc = ({ userId, fileName }) => {
  const doc = readUserDoc({ userId, fileName, prefix: 'resume', category: 'profile' });
  if (!doc) return null;
  const parsed = parseResumeMetaBlock(doc.content);
  return {
    ...doc,
    content: parsed.content,
    meta: normalizeResumeDocMeta(parsed.meta),
    has_meta: parsed.hasMeta,
    raw_content: doc.content,
  };
};

const updateResumeDocMeta = ({ userId, fileName, summary = '', originalFilename = '' }) => {
  const doc = readResumeDoc({ userId, fileName });
  if (!doc) return null;

  const nextMeta = {
    ...doc.meta,
    summary: String(summary || doc.meta?.summary || '').trim(),
    original_filename: String(originalFilename || doc.meta?.original_filename || '').trim(),
    updated_at: new Date().toISOString(),
  };

  fs.writeFileSync(doc.path, buildResumeMarkdown({
    resumeText: doc.content,
    summary: nextMeta.summary,
    originalFilename: nextMeta.original_filename,
    updatedAt: nextMeta.updated_at,
  }), 'utf8');

  return readResumeDoc({ userId, fileName: doc.name });
};

const deleteResumeDoc = ({ userId, fileName }) =>
  deleteUserDoc({ userId, fileName, prefix: 'resume', category: 'profile' });

module.exports = {
  normalizeStoredTextFilename,
  RESUME_META_OPEN,
  RESUME_META_CLOSE,
  encodeResumeMetaBlock,
  parseResumeMetaBlock,
  buildResumeMarkdown,
  normalizeResumeDocMeta,
  collectResumeEntries,
  saveResumeDoc,
  listResumeDocs,
  readResumeDoc,
  updateResumeDocMeta,
  createUniqueFilePath,
  deleteResumeDoc,
};
