const { summarizeResume, extractResumeTextFromBinary } = require('./parse');
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
  summarizeResume,
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
