const { isPostgresEnabled } = require('../postgres');

let sqliteStore = null;
let postgresStore = null;

function getSqliteStore() {
  if (!sqliteStore) {
    sqliteStore = require('../db/experience');
  }
  return sqliteStore;
}

function getPostgresStore() {
  if (!postgresStore) {
    postgresStore = require('../postgres/experience-store');
  }
  return postgresStore;
}

function getExperienceStorageDriver() {
  const configuredDriver = String(process.env.EXPERIENCE_STORAGE_DRIVER || 'auto').trim().toLowerCase();

  if (configuredDriver === 'sqlite' || configuredDriver === 'postgres') {
    return configuredDriver;
  }

  return isPostgresEnabled() ? 'postgres' : 'sqlite';
}

function getExperienceStorageTarget() {
  return getExperienceStorageDriver() === 'postgres' ? 'remote_postgres' : 'local_sqlite';
}

function getExperienceStore() {
  return getExperienceStorageDriver() === 'postgres' ? getPostgresStore() : getSqliteStore();
}

module.exports = {
  getExperienceStorageDriver,
  getExperienceStorageTarget,
  getExperienceStore,
};
