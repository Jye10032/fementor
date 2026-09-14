const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyPostgresTarget } = require('../../src/postgres');

test('PostgreSQL target classification distinguishes local and remote hosts', () => {
  for (const databaseUrl of [
    'postgresql://user:password@localhost:5432/fementor',
    'postgresql://user:password@127.0.0.1:5432/fementor',
    'postgresql://user:password@[::1]:5432/fementor',
    'postgresql://user:password@postgres:5432/fementor',
  ]) {
    assert.equal(classifyPostgresTarget(databaseUrl), 'local_postgres');
  }

  assert.equal(
    classifyPostgresTarget('postgresql://user:password@example.supabase.com:6543/postgres'),
    'remote_postgres',
  );
  assert.equal(classifyPostgresTarget('invalid-database-url'), 'remote_postgres');
});
