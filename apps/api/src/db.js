const { DB_PATH } = require('./db/core');
const { init } = require('./db/init');
const {
  addChatMessageRecord,
  addUserQuestionBankItemRecord,
  addInterviewTurnRecord,
  countInterviewSessionsStartedOnUtcDate,
  countQuestionSourcesRecord,
  createChatSessionRecord,
  createInterviewSessionRecord,
  createQuestionAttemptRecord,
  createResumeParseUsage,
  deleteInterviewSessionRecord,
  findQuestionSourceByCanonicalQuestionRecord,
  finishInterviewSessionRecord,
  getAdminEmails,
  getAppUserByClerkUserId,
  getChatSessionById,
  getInterviewQuestionByIdRecord,
  getInterviewSessionById,
  getInterviewSessionKeywordQueue,
  getNextInterviewQuestionRecord,
  getPool,
  getPublicSourceSyncStateBySourceNameRecord,
  getQuestionSourceByIdRecord,
  getQuestionSourceBySourceRefRecord,
  getResumeParseCacheByHash,
  getTodayResumeOcrUsageCount,
  getUserProfileByAuthUserId,
  getUserQuestionBankItemByIdRecord,
  getUserQuestionBankItemByUserAndSourceRecord,
  getWeaknessesByUserRecord,
  insertInterviewQuestionAfterRecord,
  initPostgres,
  isPostgresEnabled,
  listAttemptsByUserRecord,
  listChatMessagesBySession,
  listInterviewQuestionsBySession,
  listInterviewSessionsByUser,
  listInterviewTurnsBySession,
  listPracticeUserQuestionBankRecord,
  listQuestionSourcesByIdsRecord,
  listUserQuestionBankRecord,
  resolveUserRoleByEmail,
  saveInterviewQuestionsRecord,
  saveResumeParseCache,
  saveScoringResultRecord,
  updateInterviewQuestionStatusRecord,
  updateInterviewSessionKeywordQueue,
  updateUserQuestionBankReviewStateRecord,
  upsertAppUserByClerk,
  upsertPublicSourceSyncStateRecord,
  upsertQuestionSourceRecord,
  upsertUserProfile,
} = require('./postgres');

let sqliteModules = null;

function getSqliteModules() {
  if (!sqliteModules) {
    sqliteModules = {
      users: require('./db/users'),
      scoring: require('./db/scoring'),
      interview: require('./db/interview'),
      questionBank: require('./db/question-bank'),
      chat: require('./db/chat'),
      experience: require('./db/experience'),
      questionSource: require('./db/question-source'),
      publicSourceSync: require('./db/public-source-sync'),
    };
  }

  return sqliteModules;
}

function usePostgresPrimary() {
  return isPostgresEnabled();
}

function getUserById(id) {
  return usePostgresPrimary() ? getUserProfileByAuthUserId(id) : getSqliteModules().users.getUserById(id);
}

function upsertUser(payload) {
  return usePostgresPrimary()
    ? upsertUserProfile({
      userId: payload.id,
      name: payload.name,
      resumeSummary: payload.resume_summary,
      resumeStructuredJson: payload.resume_structured_json,
      activeResumeFile: payload.active_resume_file,
      activeJdFile: payload.active_jd_file,
    })
    : getSqliteModules().users.upsertUser(payload);
}

function setActiveResumeFile({ userId, fileName, resumeSummary, resumeStructuredJson }) {
  return usePostgresPrimary()
    ? upsertUserProfile({
      userId,
      resumeSummary,
      resumeStructuredJson,
      activeResumeFile: fileName,
    })
    : getSqliteModules().users.setActiveResumeFile({ userId, fileName, resumeSummary, resumeStructuredJson });
}

function setActiveJdFile({ userId, fileName }) {
  return usePostgresPrimary()
    ? upsertUserProfile({
      userId,
      activeJdFile: fileName,
    })
    : getSqliteModules().users.setActiveJdFile({ userId, fileName });
}

function createInterviewSession({ id, userId }) {
  return usePostgresPrimary()
    ? createInterviewSessionRecord({ id, userId })
    : getSqliteModules().interview.createInterviewSession({ id, userId });
}

function countSessionsStartedOnUtcDate({ userId, date }) {
  return usePostgresPrimary()
    ? countInterviewSessionsStartedOnUtcDate({ userId, date })
    : getSqliteModules().interview.countSessionsStartedOnUtcDate({ userId, date });
}

function getInterviewSession(sessionId) {
  return usePostgresPrimary()
    ? getInterviewSessionById(sessionId)
    : getSqliteModules().interview.getInterviewSession(sessionId);
}

function listInterviewSessions({ userId, limit = 20 }) {
  return usePostgresPrimary()
    ? listInterviewSessionsByUser({ userId, limit })
    : getSqliteModules().interview.listInterviewSessions({ userId, limit });
}

function addInterviewTurn(payload) {
  return usePostgresPrimary()
    ? addInterviewTurnRecord(payload)
    : getSqliteModules().interview.addInterviewTurn(payload);
}

function listInterviewTurns(sessionId) {
  return usePostgresPrimary()
    ? listInterviewTurnsBySession(sessionId)
    : getSqliteModules().interview.listInterviewTurns(sessionId);
}

function finishInterviewSession({ sessionId, summary }) {
  return usePostgresPrimary()
    ? finishInterviewSessionRecord({ sessionId, summary })
    : getSqliteModules().interview.finishInterviewSession({ sessionId, summary });
}

function saveInterviewQuestions({ sessionId, items }) {
  return usePostgresPrimary()
    ? saveInterviewQuestionsRecord({ sessionId, items })
    : getSqliteModules().interview.saveInterviewQuestions({ sessionId, items });
}

function insertInterviewQuestionAfter({ sessionId, afterOrderNo, item }) {
  return usePostgresPrimary()
    ? insertInterviewQuestionAfterRecord({ sessionId, afterOrderNo, item })
    : getSqliteModules().interview.insertInterviewQuestionAfter({ sessionId, afterOrderNo, item });
}

function listInterviewQuestions(sessionId) {
  return usePostgresPrimary()
    ? listInterviewQuestionsBySession(sessionId)
    : getSqliteModules().interview.listInterviewQuestions(sessionId);
}

function getInterviewQuestionById(questionId) {
  return usePostgresPrimary()
    ? getInterviewQuestionByIdRecord(questionId)
    : getSqliteModules().interview.getInterviewQuestionById(questionId);
}

function updateInterviewQuestionStatus({ questionId, status }) {
  return usePostgresPrimary()
    ? updateInterviewQuestionStatusRecord({ questionId, status })
    : getSqliteModules().interview.updateInterviewQuestionStatus({ questionId, status });
}

function deleteInterviewSession(sessionId) {
  return usePostgresPrimary()
    ? deleteInterviewSessionRecord(sessionId)
    : getSqliteModules().interview.deleteInterviewSession(sessionId);
}

function getNextInterviewQuestion(sessionId) {
  return usePostgresPrimary()
    ? getNextInterviewQuestionRecord(sessionId)
    : getSqliteModules().interview.getNextInterviewQuestion(sessionId);
}

function updateSessionKeywordQueue({ sessionId, keywordQueueJson }) {
  return usePostgresPrimary()
    ? updateInterviewSessionKeywordQueue({ sessionId, keywordQueueJson })
    : getSqliteModules().interview.updateSessionKeywordQueue({ sessionId, keywordQueueJson });
}

function getSessionKeywordQueue(sessionId) {
  return usePostgresPrimary()
    ? getInterviewSessionKeywordQueue(sessionId)
    : getSqliteModules().interview.getSessionKeywordQueue(sessionId);
}

function createChatSession({ id, userId, title }) {
  return usePostgresPrimary()
    ? createChatSessionRecord({ id, userId, title })
    : getSqliteModules().chat.createChatSession({ id, userId, title });
}

function getChatSession(sessionId) {
  return usePostgresPrimary()
    ? getChatSessionById(sessionId)
    : getSqliteModules().chat.getChatSession(sessionId);
}

function addChatMessage({ id, sessionId, role, content }) {
  return usePostgresPrimary()
    ? addChatMessageRecord({ id, sessionId, role, content })
    : getSqliteModules().chat.addChatMessage({ id, sessionId, role, content });
}

function listChatMessages(sessionId, limit = 100) {
  return usePostgresPrimary()
    ? listChatMessagesBySession(sessionId, limit)
    : getSqliteModules().chat.listChatMessages(sessionId, limit);
}

function saveScoringResult(payload) {
  return usePostgresPrimary()
    ? saveScoringResultRecord(payload)
    : getSqliteModules().scoring.saveScoringResult(payload);
}

function getWeaknessesByUser(userId, limit = 20) {
  return usePostgresPrimary()
    ? getWeaknessesByUserRecord(userId, limit)
    : getSqliteModules().scoring.getWeaknessesByUser(userId, limit);
}

function listAttemptsByUser(userId, limit = 20) {
  return usePostgresPrimary()
    ? listAttemptsByUserRecord(userId, limit)
    : getSqliteModules().scoring.listAttemptsByUser(userId, limit);
}

function getQuestionSourceById(id) {
  return usePostgresPrimary()
    ? getQuestionSourceByIdRecord(id)
    : getSqliteModules().questionSource.getQuestionSourceById(id);
}

function getQuestionSourceBySourceRef({ sourceType, sourceRefId }) {
  return usePostgresPrimary()
    ? getQuestionSourceBySourceRefRecord({ sourceType, sourceRefId })
    : getSqliteModules().questionSource.getQuestionSourceBySourceRef({ sourceType, sourceRefId });
}

function findQuestionSourceByCanonicalQuestion({ canonicalQuestion, track = '', chapter = '' }) {
  return usePostgresPrimary()
    ? findQuestionSourceByCanonicalQuestionRecord({ canonicalQuestion, track, chapter })
    : getSqliteModules().questionSource.findQuestionSourceByCanonicalQuestion({ canonicalQuestion, track, chapter });
}

function listQuestionSourcesByIds(ids = []) {
  return usePostgresPrimary()
    ? listQuestionSourcesByIdsRecord(ids)
    : getSqliteModules().questionSource.listQuestionSourcesByIds(ids);
}

function countQuestionSources({ track, chapter, status = 'active' } = {}) {
  return usePostgresPrimary()
    ? countQuestionSourcesRecord({ track, chapter, status })
    : getSqliteModules().questionSource.countQuestionSources({ track, chapter, status });
}

function upsertQuestionSource(payload) {
  return usePostgresPrimary()
    ? upsertQuestionSourceRecord(payload)
    : getSqliteModules().questionSource.upsertQuestionSource(payload);
}

function getUserQuestionBankItemById(id) {
  return usePostgresPrimary()
    ? getUserQuestionBankItemByIdRecord(id)
    : getSqliteModules().questionSource.getUserQuestionBankItemById(id);
}

function getUserQuestionBankItemByUserAndSource({ userId, questionSourceId }) {
  return usePostgresPrimary()
    ? getUserQuestionBankItemByUserAndSourceRecord({ userId, questionSourceId })
    : getSqliteModules().questionSource.getUserQuestionBankItemByUserAndSource({ userId, questionSourceId });
}

function addUserQuestionBankItem(payload) {
  return usePostgresPrimary()
    ? addUserQuestionBankItemRecord(payload)
    : getSqliteModules().questionSource.addUserQuestionBankItem(payload);
}

function listUserQuestionBank(payload) {
  return usePostgresPrimary()
    ? listUserQuestionBankRecord(payload)
    : getSqliteModules().questionSource.listUserQuestionBank(payload);
}

function listPracticeUserQuestionBank(payload) {
  return usePostgresPrimary()
    ? listPracticeUserQuestionBankRecord(payload)
    : getSqliteModules().questionSource.listPracticeUserQuestionBank(payload);
}

function updateUserQuestionBankReviewState(payload) {
  return usePostgresPrimary()
    ? updateUserQuestionBankReviewStateRecord(payload)
    : getSqliteModules().questionSource.updateUserQuestionBankReviewState(payload);
}

function createQuestionAttempt(payload) {
  return usePostgresPrimary()
    ? createQuestionAttemptRecord(payload)
    : getSqliteModules().questionSource.createQuestionAttempt(payload);
}

function getPublicSourceSyncStateBySourceName(sourceName) {
  return usePostgresPrimary()
    ? getPublicSourceSyncStateBySourceNameRecord(sourceName)
    : getSqliteModules().publicSourceSync.getPublicSourceSyncStateBySourceName(sourceName);
}

function upsertPublicSourceSyncState(payload) {
  return usePostgresPrimary()
    ? upsertPublicSourceSyncStateRecord(payload)
    : getSqliteModules().publicSourceSync.upsertPublicSourceSyncState(payload);
}

function getQuestionBankItemById(questionId) {
  return getSqliteModules().questionBank.getQuestionBankItemById(questionId);
}

function listPracticeQuestions(payload) {
  return getSqliteModules().questionBank.listPracticeQuestions(payload);
}

function listQuestionBank(payload) {
  return getSqliteModules().questionBank.listQuestionBank(payload);
}

function markQuestionReviewed(payload) {
  return getSqliteModules().questionBank.markQuestionReviewed(payload);
}

function saveQuestionBankItems(payload) {
  return getSqliteModules().questionBank.saveQuestionBankItems(payload);
}

module.exports = {
  DB_PATH,
  init,
  initPostgres,
  isPostgresEnabled,
  getPool,
  getAdminEmails,
  resolveUserRoleByEmail,
  getAppUserByClerkUserId,
  upsertAppUserByClerk,
  getTodayResumeOcrUsageCount,
  getResumeParseCacheByHash,
  saveResumeParseCache,
  createResumeParseUsage,
  getUserById,
  upsertUser,
  setActiveResumeFile,
  setActiveJdFile,
  createInterviewSession,
  countSessionsStartedOnUtcDate,
  getInterviewSession,
  listInterviewSessions,
  addInterviewTurn,
  listInterviewTurns,
  finishInterviewSession,
  saveInterviewQuestions,
  insertInterviewQuestionAfter,
  listInterviewQuestions,
  getInterviewQuestionById,
  updateInterviewQuestionStatus,
  deleteInterviewSession,
  getNextInterviewQuestion,
  updateSessionKeywordQueue,
  getSessionKeywordQueue,
  createChatSession,
  getChatSession,
  addChatMessage,
  listChatMessages,
  saveScoringResult,
  getWeaknessesByUser,
  listAttemptsByUser,
  getQuestionBankItemById,
  listPracticeQuestions,
  listQuestionBank,
  markQuestionReviewed,
  saveQuestionBankItems,
  getQuestionSourceById,
  getQuestionSourceBySourceRef,
  findQuestionSourceByCanonicalQuestion,
  listQuestionSourcesByIds,
  countQuestionSources,
  upsertQuestionSource,
  getUserQuestionBankItemById,
  getUserQuestionBankItemByUserAndSource,
  addUserQuestionBankItem,
  listUserQuestionBank,
  listPracticeUserQuestionBank,
  updateUserQuestionBankReviewState,
  createQuestionAttempt,
  getPublicSourceSyncStateBySourceName,
  upsertPublicSourceSyncState,
};
