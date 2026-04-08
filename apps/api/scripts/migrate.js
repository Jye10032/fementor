const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const DATABASE_URL = String(process.env.DATABASE_URL || process.env.SUPABASE || '').trim();
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

function getSslConfig() {
  return process.env.PGSSL_DISABLE === '1' ? false : { rejectUnauthorized: false };
}

function getPool() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({
    connectionString: DATABASE_URL,
    ssl: getSslConfig(),
  });
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
}

function readMigrationFile(fileName) {
  const filePath = path.join(MIGRATIONS_DIR, fileName);
  const sql = fs.readFileSync(filePath, 'utf8');
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');

  return {
    fileName,
    filePath,
    sql,
    checksum,
  };
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(`
    SELECT version, checksum, applied_at
    FROM schema_migrations
    ORDER BY version ASC
  `);

  return new Map(result.rows.map((row) => [row.version, row]));
}

async function run() {
  const mode = process.argv.includes('--status') ? 'status' : 'apply';
  const pool = getPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const migrations = listMigrationFiles().map(readMigrationFile);

    if (migrations.length === 0) {
      console.log('[migrate] no migration files found');
      return;
    }

    if (mode === 'status') {
      for (const migration of migrations) {
        const row = applied.get(migration.fileName);
        console.log([
          row ? 'applied ' : 'pending ',
          migration.fileName,
          row ? ` ${row.applied_at.toISOString()}` : '',
        ].join(''));
      }
      return;
    }

    for (const migration of migrations) {
      const current = applied.get(migration.fileName);

      if (current) {
        if (current.checksum !== migration.checksum) {
          throw new Error(`checksum mismatch for ${migration.fileName}`);
        }
        console.log(`[migrate] skip ${migration.fileName}`);
        continue;
      }

      console.log(`[migrate] apply ${migration.fileName}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `
          INSERT INTO schema_migrations (version, checksum)
          VALUES ($1, $2)
          `,
          [migration.fileName, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[migrate.failed]', error.message);
  process.exit(1);
});
