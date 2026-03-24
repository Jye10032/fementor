const { extractResumeTextFromBinary } = require('./parse');
const {
  normalizeStoredTextFilename,
  encodeResumeMetaBlock,
  parseResumeMetaBlock,
  buildResumeMarkdown,
  normalizeResumeDocMeta,
  collectResumeEntries,
  saveResumeDoc,
  listResumeDocs,
  readResumeDoc,
  updateResumeDocMeta,
} = require('./meta');

module.exports = {
  extractResumeTextFromBinary,
  normalizeStoredTextFilename,
  encodeResumeMetaBlock,
  parseResumeMetaBlock,
  buildResumeMarkdown,
  normalizeResumeDocMeta,
  collectResumeEntries,
  saveResumeDoc,
  listResumeDocs,
  readResumeDoc,
  updateResumeDocMeta,
};
