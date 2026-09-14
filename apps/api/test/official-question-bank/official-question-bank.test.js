const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-official-bank-test-'));
process.env.DB_PATH = path.join(testDirectory, 'fementor.db');
delete process.env.DATABASE_URL;
delete process.env.SUPABASE;

const { init } = require('../../src/db');
const {
  getQuestionSourceBySourceRef,
  getUserQuestionBankItemById,
  importOfficialQuestion,
  listImportedOfficialQuestionIds,
  listUserQuestionBank,
  updateUserQuestionBankReviewState,
} = require('../../src/db');
const { getDb } = require('../../src/db/core');
const {
  buildOfficialQuestionFilter,
  getRemoteDatabaseSslConfig,
} = require('../../src/official-question-bank/repository');

init();

after(() => {
  getDb().close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

const remoteQuestion = {
  id: 'remote-question-1',
  canonical_question: 'React 状态更新为什么可能是异步的？',
  question_text: 'React 状态更新为什么可能是异步的？',
  normalized_question: 'react 状态更新',
  category: 'framework',
  difficulty: 'medium',
  track: 'frontend',
  chapter: 'React',
  knowledge_points: ['state', 'batching'],
  expected_points: ['批处理', '快照语义'],
  metadata: { source: 'official' },
  updated_at: '2026-09-14T00:00:00.000Z',
};

test('official filters use parameterized SQL for search and facets', () => {
  const result = buildOfficialQuestionFilter({
    query: 'React',
    track: 'frontend',
    chapter: '状态管理',
    difficulty: 'medium',
    category: 'framework',
  });

  assert.deepEqual(result.params, ['%React%', 'frontend', '状态管理', 'medium', 'framework']);
  assert.match(result.whereClause, /canonical_question ILIKE \$1/);
  assert.match(result.whereClause, /question_text ILIKE \$1/);
  assert.match(result.whereClause, /track = \$2/);
  assert.match(result.whereClause, /chapter = \$3/);
  assert.match(result.whereClause, /difficulty = \$4/);
  assert.match(result.whereClause, /category = \$5/);
});

test('remote database SSL verification requires an explicit no-verify opt-in', () => {
  assert.deepEqual(getRemoteDatabaseSslConfig('verify-full'), { rejectUnauthorized: true });
  assert.deepEqual(getRemoteDatabaseSslConfig('true'), { rejectUnauthorized: true });
  assert.deepEqual(getRemoteDatabaseSslConfig('no-verify'), { rejectUnauthorized: false });
  assert.equal(getRemoteDatabaseSslConfig('disable'), false);
});

test('official imports are idempotent per user and preserve user isolation', () => {
  const first = importOfficialQuestion({ userId: 'user-a', remoteQuestion });
  const repeated = importOfficialQuestion({ userId: 'user-a', remoteQuestion });
  const secondUser = importOfficialQuestion({ userId: 'user-b', remoteQuestion });

  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.item.id, first.item.id);
  assert.equal(secondUser.created, true);
  assert.notEqual(secondUser.item.id, first.item.id);

  const source = getQuestionSourceBySourceRef({
    sourceType: 'official_remote',
    sourceRefId: 'remote:remote-question-1',
  });
  assert.equal(source.id, first.source.id);
  assert.equal(source.metadata.origin, 'remote_official');
  assert.deepEqual(listImportedOfficialQuestionIds({
    userId: 'user-a',
    remoteIds: ['remote-question-1', 'missing'],
  }), ['remote-question-1']);
  assert.equal(listUserQuestionBank({ userId: 'user-a' }).items.length, 1);
  assert.equal(listUserQuestionBank({ userId: 'user-b' }).items.length, 1);

  const userBItem = getUserQuestionBankItemById(secondUser.item.id);
  updateUserQuestionBankReviewState({ id: userBItem.id, reviewStatus: 'done' });
  assert.equal(getUserQuestionBankItemById(first.item.id).review_status, 'pending');
  assert.equal(getUserQuestionBankItemById(secondUser.item.id).review_status, 'done');
});
