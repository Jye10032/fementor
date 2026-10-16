const { VERSION, buildInput, inputHash } = require('./contract');
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const ddl = `CREATE TABLE IF NOT EXISTS interview_evidence_evaluation (
 turn_id TEXT NOT NULL REFERENCES interview_turn(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES interview_session(id) ON DELETE CASCADE,
 contract_version TEXT NOT NULL, input_hash TEXT NOT NULL, result_json TEXT NOT NULL,
 provenance_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(turn_id, contract_version))`;
const decode = (row) => row ? { ...row, result: JSON.parse(row.result_json), provenance: JSON.parse(row.provenance_json), result_json: undefined, provenance_json: undefined } : null;
function createStore({ sqlite, pool }) {
  if (sqlite) sqlite.exec(ddl);
  async function transaction(work) {
    if (sqlite) {
      // SQLite callbacks below contain no async work; lock covers ownership and saved input checks.
      return sqlite.transaction(() => work((sql, args) => sqlite.prepare(sql).all(...args),
        (sql, args) => sqlite.prepare(sql).run(...args))) .immediate();
    }
    const client = await pool.connect();
    const pg = (sql) => { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); };
    try {
      await client.query('BEGIN');
      const result = await work(async (sql, args) => (await client.query(pg(sql), args)).rows,
        (sql, args) => client.query(pg(sql), args));
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  // Generator permits the same transaction logic to run synchronously on SQLite and awaited on PG.
  function runGenerator(generator, query, execute) {
    const iterator = generator();
    function step(value) {
      const next = iterator.next(value);
      if (next.done) return next.value;
      const [kind, sql, args] = next.value;
      const result = (kind === 'query' ? query : execute)(sql, args);
      return result?.then ? result.then(step) : step(result);
    }
    return step();
  }
  function operation({ sessionId, userId, turnId, save }) {
    return transaction((query, execute) => runGenerator(function* () {
      const sessions = yield ['query', 'SELECT * FROM interview_session WHERE id = ?' + (pool ? ' FOR UPDATE' : ''), [sessionId]];
      if (!sessions[0] || sessions[0].user_id !== userId) fail(403, 'session not accessible');
      const turns = yield ['query', 'SELECT * FROM interview_turn WHERE session_id = ? AND id = ?' + (pool ? ' FOR UPDATE' : ''), [sessionId, turnId]];
      const turn = turns[0]; if (!turn) fail(404, 'saved turn not found');
      const questions = turn.question_id ? yield ['query', 'SELECT * FROM interview_question WHERE session_id = ? AND id = ?' + (pool ? ' FOR UPDATE' : ''), [sessionId, turn.question_id]] : [];
      const question = questions[0];
      if (turn.question_id && !question) fail(409, 'question context missing');
      const input = buildInput(turn, question ? { expected_points: JSON.parse(question.expected_points_json || '[]') } : null);
      const fingerprint = inputHash(input);
      const rows = yield ['query', 'SELECT * FROM interview_evidence_evaluation WHERE turn_id = ? AND contract_version = ?', [turnId, VERSION]];
      if (save) {
        if (save.input_hash !== fingerprint) fail(409, 'saved input changed; evaluation discarded');
        if (!rows[0]) yield ['execute', 'INSERT INTO interview_evidence_evaluation (turn_id,session_id,contract_version,input_hash,result_json,provenance_json,created_at) VALUES (?,?,?,?,?,?,?)',
          [turnId, sessionId, VERSION, fingerprint, JSON.stringify(save.result), JSON.stringify(save.provenance), new Date().toISOString()]];
      }
      const row = rows[0] || (save ? (yield ['query', 'SELECT * FROM interview_evidence_evaluation WHERE turn_id = ? AND contract_version = ?', [turnId, VERSION]])[0] : null);
      if (row && row.input_hash !== fingerprint) fail(409, 'stored evaluation is stale');
      return { input, input_hash: fingerprint, evaluation: decode(row) };
    }, query, execute));
  }
  return { read: (args) => operation(args), save: (args) => operation(args) };
}
let defaultStore;
async function getStore() {
  if (!defaultStore) {
    const pg = require('../../postgres');
    if (pg.isPostgresEnabled()) { await pg.initPostgres(); defaultStore = createStore({ pool: pg.getPool() }); }
    else defaultStore = createStore({ sqlite: require('../../db/core').db });
  }
  return defaultStore;
}
module.exports = { createStore, getStore };
