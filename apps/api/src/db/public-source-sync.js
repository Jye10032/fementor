const { db } = require('./core');

const getPublicSourceSyncStateBySourceName = (sourceName) =>
  db
    .prepare(
      `
      SELECT id, source_name, last_synced_at, last_server_time, last_sync_status,
             last_error_message, local_item_count, updated_at
      FROM public_source_sync_state
      WHERE source_name = ?
    `,
    )
    .get(sourceName);

const upsertPublicSourceSyncState = ({
  id,
  sourceName,
  lastSyncedAt = null,
  lastServerTime = null,
  lastSyncStatus = 'idle',
  lastErrorMessage = '',
  localItemCount = 0,
}) => {
  const now = new Date().toISOString();
  const existing = getPublicSourceSyncStateBySourceName(sourceName);

  if (existing) {
    db.prepare(
      `
      UPDATE public_source_sync_state
      SET last_synced_at = ?, last_server_time = ?, last_sync_status = ?,
          last_error_message = ?, local_item_count = ?, updated_at = ?
      WHERE source_name = ?
    `,
    ).run(
      lastSyncedAt,
      lastServerTime,
      lastSyncStatus,
      lastErrorMessage,
      Number(localItemCount || 0),
      now,
      sourceName,
    );

    return getPublicSourceSyncStateBySourceName(sourceName);
  }

  const nextId = id || `pss_${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `
    INSERT INTO public_source_sync_state (
      id, source_name, last_synced_at, last_server_time, last_sync_status,
      last_error_message, local_item_count, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    nextId,
    sourceName,
    lastSyncedAt,
    lastServerTime,
    lastSyncStatus,
    lastErrorMessage,
    Number(localItemCount || 0),
    now,
  );

  return getPublicSourceSyncStateBySourceName(sourceName);
};

module.exports = {
  getPublicSourceSyncStateBySourceName,
  upsertPublicSourceSyncState,
};
