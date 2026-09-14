const {
  importOfficialQuestion,
  listImportedOfficialQuestionIds,
} = require('../db');
const { createHttpError } = require('../http');
const {
  getOfficialQuestionSourceById,
  getOfficialQuestionSourceStatus,
  listOfficialQuestionSources,
} = require('./repository');

const withOfficialSourceError = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    if (error?.code === 'official_source_not_configured') {
      throw createHttpError(503, 'official_source_not_configured');
    }
    throw createHttpError(503, 'official_source_unavailable');
  }
};

const attachImportedState = async ({ items, userId }) => {
  if (!userId || items.length === 0) {
    return items.map((item) => ({ ...item, is_imported: false }));
  }
  const importedIds = new Set(await listImportedOfficialQuestionIds({
    userId,
    remoteIds: items.map((item) => item.id),
  }));
  return items.map((item) => ({ ...item, is_imported: importedIds.has(item.id) }));
};

const listOfficialQuestionBank = async ({ filters, userId = null }) => {
  const result = await withOfficialSourceError(() => listOfficialQuestionSources(filters));
  return {
    ...result,
    items: await attachImportedState({ items: result.items, userId }),
    source: 'remote_official',
    read_only: true,
  };
};

const getOfficialQuestionBankItem = async ({ id, userId = null }) => {
  const item = await withOfficialSourceError(() => getOfficialQuestionSourceById(id));
  if (!item) throw createHttpError(404, 'official_question_not_found');
  const [withState] = await attachImportedState({ items: [item], userId });
  return withState;
};

const importOfficialQuestionBankItem = async ({ id, userId }) => {
  if (!userId) throw createHttpError(401, 'official_import_requires_identity');
  const remoteQuestion = await withOfficialSourceError(() => getOfficialQuestionSourceById(id));
  if (!remoteQuestion) throw createHttpError(404, 'official_question_not_found');
  try {
    const result = await importOfficialQuestion({ userId, remoteQuestion });
    if (!result) throw new Error('local import returned no result');
    return {
      created: result.created,
      item: result.item,
      source_snapshot_id: result.source.id,
      remote_source_id: remoteQuestion.id,
    };
  } catch {
    throw createHttpError(500, 'official_import_failed');
  }
};

module.exports = {
  getOfficialQuestionBankItem,
  getOfficialQuestionSourceStatus,
  importOfficialQuestionBankItem,
  listOfficialQuestionBank,
};
