const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

class MigrationStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MigrationStateError';
    this.code = code;
  }
}

function loadMigrationManifest(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  if (!fs.existsSync(migrationsDir)) return [];

  return fs.readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => {
      const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
      return {
        version: fileName,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    });
}

function validateMigrationState({ expected, applied }) {
  if (expected.length === 0) {
    throw new MigrationStateError(
      'schema_manifest_empty',
      'no application migrations were found',
    );
  }

  const expectedByVersion = new Map(expected.map((item) => [item.version, item]));
  const appliedByVersion = new Map(applied.map((item) => [item.version, item]));

  for (const migration of expected) {
    const current = appliedByVersion.get(migration.version);
    if (!current) {
      throw new MigrationStateError(
        'schema_migrations_pending',
        `database migration is pending: ${migration.version}`,
      );
    }
    if (current.checksum !== migration.checksum) {
      throw new MigrationStateError(
        'schema_migration_checksum_mismatch',
        `database migration checksum mismatch: ${migration.version}`,
      );
    }
  }

  const unknown = applied.find((migration) => !expectedByVersion.has(migration.version));
  if (unknown) {
    throw new MigrationStateError(
      'schema_migrations_ahead',
      `database has a migration unknown to this application: ${unknown.version}`,
    );
  }

  return {
    currentVersion: expected.at(-1)?.version || null,
    migrationCount: expected.length,
  };
}

async function assertDatabaseMigrationsCurrent(client, options = {}) {
  const tableResult = await client.query(
    "SELECT to_regclass('public.schema_migrations') AS table_name",
  );
  if (!tableResult.rows[0]?.table_name) {
    throw new MigrationStateError(
      'schema_migrations_missing',
      'schema_migrations is missing; run npm run db:migrate before starting the API',
    );
  }

  const appliedResult = await client.query(`
    SELECT version, checksum
    FROM public.schema_migrations
    ORDER BY version ASC
  `);
  const expected = loadMigrationManifest(options.migrationsDir);
  return validateMigrationState({ expected, applied: appliedResult.rows });
}

module.exports = {
  DEFAULT_MIGRATIONS_DIR,
  MigrationStateError,
  assertDatabaseMigrationsCurrent,
  loadMigrationManifest,
  validateMigrationState,
};
