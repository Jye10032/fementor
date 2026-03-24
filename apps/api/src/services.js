const {
  DATA_ROOT,
  saveJdDoc,
  listUserDocs,
  listJdDocs,
  readUserDoc,
  readJdDoc,
  ensureUserKnowledgeDir,
} = require('./doc');
const {
  extractResumeTextFromBinary,
  saveResumeDoc,
  listResumeDocs,
  readResumeDoc,
  updateResumeDocMeta,
} = require('./resume');
const {
  appendMemoryEntry,
} = require('./memory');
const {
  localSearch,
} = require('./search');

module.exports = {
  DATA_ROOT,
  extractResumeTextFromBinary,
  saveResumeDoc,
  saveJdDoc,
  listUserDocs,
  listResumeDocs,
  listJdDocs,
  readUserDoc,
  readResumeDoc,
  readJdDoc,
  updateResumeDocMeta,
  appendMemoryEntry,
  ensureUserKnowledgeDir,
  localSearch,
};
