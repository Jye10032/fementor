const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { isPostgresEnabled } = require('../postgres');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../../../../data/fementor.db');

let sqliteDb = null;

const getDb = () => {
  if (!sqliteDb) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    sqliteDb = new Database(DB_PATH);
    sqliteDb.pragma('journal_mode = WAL');
  }
  return sqliteDb;
};

const db = new Proxy(
  {},
  {
    get(_target, property) {
      const value = getDb()[property];
      return typeof value === 'function' ? value.bind(getDb()) : value;
    },
  },
);

const parseJsonArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseJsonObject = (value) => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((item) => item.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

module.exports = {
  DB_PATH,
  db,
  ensureColumn,
  getDb,
  isPostgresEnabled,
  parseJsonArray,
  parseJsonObject,
};
