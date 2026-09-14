const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.resolve(
  __dirname,
  '../../migrations/003_agent_runtime_audit.sql',
);
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

test('agent runtime migration creates only the approved audit tables', () => {
  const createdTables = [...migrationSql.matchAll(/CREATE TABLE\s+(\w+)/g)]
    .map((match) => match[1]);

  assert.deepEqual(createdTables, ['agent_runtime_session', 'agent_run']);
  assert.doesNotMatch(migrationSql, /context_resource|openviking|context_sync_outbox/i);
});

test('runtime sessions keep FEMentor interview sessions as the domain key', () => {
  assert.match(
    migrationSql,
    /FOREIGN KEY \(interview_session_id\) REFERENCES interview_session\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    migrationSql,
    /UNIQUE INDEX idx_agent_runtime_session_active_interview_runtime[\s\S]+WHERE status = 'active'/,
  );
  assert.match(
    migrationSql,
    /UNIQUE INDEX idx_agent_runtime_session_external[\s\S]+WHERE external_session_id IS NOT NULL/,
  );
});

test('runtime sessions can retain closed history while preventing duplicate active mappings', () => {
  assert.match(
    migrationSql,
    /ON agent_runtime_session\(interview_session_id, runtime_id\)\s+WHERE status = 'active'/,
  );
  assert.doesNotMatch(
    migrationSql,
    /UNIQUE\s*\([^)]*interview_session_id[^)]*runtime_id[^)]*\)/,
  );
});

test('agent runs cannot attach a turn from another interview session', () => {
  assert.match(
    migrationSql,
    /FOREIGN KEY \(runtime_session_id, interview_session_id\)[\s\S]+REFERENCES agent_runtime_session\(id, interview_session_id\)/,
  );
  assert.match(
    migrationSql,
    /FOREIGN KEY \(interview_session_id, interview_turn_id\)[\s\S]+REFERENCES interview_turn\(session_id, id\)/,
  );
});

test('agent runs capture bounded execution metadata without owning score state', () => {
  for (const column of [
    'task_type',
    'provider',
    'model',
    'skill_name',
    'skill_version',
    'deadline_ms',
    'max_steps',
    'max_tokens',
    'duration_ms',
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'cost_usd',
    'error_category',
  ]) {
    assert.match(migrationSql, new RegExp(`\\b${column}\\b`));
  }

  assert.doesNotMatch(migrationSql, /\bscore\b|strengths|weaknesses|feedback/);
});

test('agent runtime audit tables enable RLS and constrain lifecycle values', () => {
  assert.match(migrationSql, /chk_agent_runtime_session_status/);
  assert.match(migrationSql, /chk_agent_run_status/);
  assert.match(migrationSql, /chk_agent_run_budget/);
  assert.match(migrationSql, /chk_agent_run_metrics/);
  assert.match(
    migrationSql,
    /ALTER TABLE public\.agent_runtime_session ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(migrationSql, /ALTER TABLE public\.agent_run ENABLE ROW LEVEL SECURITY/);
});
