const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MigrationStateError,
  assertDatabaseMigrationsCurrent,
  loadMigrationManifest,
  validateMigrationState,
} = require('../../src/postgres/migration-state');

test('migration manifest is ordered and includes the agent runtime migration', () => {
  const manifest = loadMigrationManifest();

  assert.deepEqual(
    manifest.map((item) => item.version),
    [
      '001_initial_schema.sql',
      '002_enable_rls_on_schema_migrations.sql',
      '003_agent_runtime_audit.sql',
    ],
  );
  assert.ok(manifest.every((item) => /^[a-f0-9]{64}$/.test(item.checksum)));
});

test('migration state accepts an exact version and checksum match', () => {
  const expected = loadMigrationManifest();

  assert.deepEqual(validateMigrationState({ expected, applied: expected }), {
    currentVersion: '003_agent_runtime_audit.sql',
    migrationCount: 3,
  });
});

test('migration state fails closed when the application manifest is empty', () => {
  assert.throws(
    () => validateMigrationState({ expected: [], applied: [] }),
    (error) => error instanceof MigrationStateError
      && error.code === 'schema_manifest_empty',
  );
});

test('database migration check rejects an empty migration directory', async (context) => {
  const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fementor-migrations-'));
  context.after(() => fs.rmSync(migrationsDir, { recursive: true, force: true }));
  const client = {
    query: async (sql) => /to_regclass/.test(sql)
      ? { rows: [{ table_name: 'schema_migrations' }] }
      : { rows: [] },
  };

  await assert.rejects(
    () => assertDatabaseMigrationsCurrent(client, { migrationsDir }),
    (error) => error instanceof MigrationStateError
      && error.code === 'schema_manifest_empty',
  );
});

test('migration state rejects pending, changed, and unknown migrations', () => {
  const expected = loadMigrationManifest();

  assert.throws(
    () => validateMigrationState({ expected, applied: expected.slice(0, -1) }),
    (error) => error instanceof MigrationStateError
      && error.code === 'schema_migrations_pending',
  );
  assert.throws(
    () => validateMigrationState({
      expected,
      applied: expected.map((item, index) => index === 0
        ? { ...item, checksum: 'changed' }
        : item),
    }),
    (error) => error instanceof MigrationStateError
      && error.code === 'schema_migration_checksum_mismatch',
  );
  assert.throws(
    () => validateMigrationState({
      expected,
      applied: [...expected, { version: '999_future.sql', checksum: 'future' }],
    }),
    (error) => error instanceof MigrationStateError
      && error.code === 'schema_migrations_ahead',
  );
});

test('database migration check is read-only and rejects a missing ledger', async () => {
  const queries = [];
  const client = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [{ table_name: null }] };
    },
  };

  await assert.rejects(
    () => assertDatabaseMigrationsCurrent(client),
    (error) => error instanceof MigrationStateError
      && error.code === 'schema_migrations_missing',
  );
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /CREATE|ALTER|INSERT|UPDATE|DELETE/i);
});

test('database migration check reads the ledger and reports the current version', async () => {
  const expected = loadMigrationManifest();
  const queries = [];
  const client = {
    query: async (sql) => {
      queries.push(sql);
      return queries.length === 1
        ? { rows: [{ table_name: 'schema_migrations' }] }
        : { rows: expected };
    },
  };

  const state = await assertDatabaseMigrationsCurrent(client);

  assert.equal(state.currentVersion, '003_agent_runtime_audit.sql');
  assert.equal(queries.length, 2);
  assert.ok(queries.every((sql) => !/CREATE|ALTER|INSERT|UPDATE|DELETE/i.test(sql)));
});

test('PostgreSQL startup delegates schema changes exclusively to migrations', () => {
  const postgresSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/postgres.js'),
    'utf8',
  );
  const initSource = postgresSource.slice(
    postgresSource.indexOf('async function initPostgres()'),
    postgresSource.indexOf('function normalizeAppUserRow'),
  );

  assert.match(initSource, /assertDatabaseMigrationsCurrent\(client\)/);
  assert.doesNotMatch(initSource, /\b(?:CREATE|ALTER|DROP|TRUNCATE)\b/i);
  assert.doesNotMatch(postgresSource, /enableRowLevelSecurity|APP_PUBLIC_TABLES/);
});
