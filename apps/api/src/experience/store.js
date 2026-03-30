const sqliteStore = require('../db/experience');
const postgresStore = require('../postgres/experience-store');
const { isPostgresEnabled } = require('../postgres');

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
  return getExperienceStorageDriver() === 'postgres' ? postgresStore : sqliteStore;
}

module.exports = {
  getExperienceStorageDriver,
  getExperienceStorageTarget,
  getExperienceStore,
};
