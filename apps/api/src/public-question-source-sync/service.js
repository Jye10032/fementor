const {
  countQuestionSources,
  getPublicSourceSyncStateBySourceName,
  upsertPublicSourceSyncState,
  upsertQuestionSource,
} = require('../db');

const LOCAL_PUBLIC_SOURCE_NAME = 'remote_public_question_source';

const getRemoteSyncConfig = () => {
  const remoteBaseUrl = String(process.env.PUBLIC_SOURCE_REMOTE_BASE_URL || '').trim();
  const remoteApiKey = String(process.env.PUBLIC_SOURCE_REMOTE_API_KEY || '').trim();
  const timeoutMs = Number(process.env.PUBLIC_SOURCE_REMOTE_TIMEOUT_MS || 15000);

  return {
    remoteBaseUrl,
    remoteApiKey,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    remoteConfigured: Boolean(remoteBaseUrl),
  };
};

const buildRemoteUrl = (baseUrl, pathname, searchParams = null) => {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
};

const fetchRemoteJson = async ({ baseUrl, apiKey, timeoutMs, pathname, searchParams }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildRemoteUrl(baseUrl, pathname, searchParams), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`remote request failed: HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const buildLocalPublicSourceStatus = () => {
  const state = getPublicSourceSyncStateBySourceName(LOCAL_PUBLIC_SOURCE_NAME);
  const localItemCount = countQuestionSources();
  const remote = getRemoteSyncConfig();

  return {
    source_name: LOCAL_PUBLIC_SOURCE_NAME,
    has_local_data: localItemCount > 0,
    local_item_count: localItemCount,
    last_synced_at: state?.last_synced_at || null,
    last_server_time: state?.last_server_time || null,
    sync_status: state?.last_sync_status || 'idle',
    last_error_message: state?.last_error_message || '',
    remote_configured: remote.remoteConfigured,
    mode: 'local_only',
  };
};

const refreshLocalPublicSourceState = ({
  status = 'success',
  errorMessage = '',
  lastServerTime,
  lastSyncedAt,
} = {}) => {
  const current = getPublicSourceSyncStateBySourceName(LOCAL_PUBLIC_SOURCE_NAME);
  const localItemCount = countQuestionSources();
  const now = new Date().toISOString();

  return upsertPublicSourceSyncState({
    id: current?.id,
    sourceName: LOCAL_PUBLIC_SOURCE_NAME,
    lastSyncedAt: lastSyncedAt !== undefined
      ? lastSyncedAt
      : (status === 'success' ? now : current?.last_synced_at || null),
    lastServerTime: lastServerTime !== undefined ? lastServerTime : current?.last_server_time || null,
    lastSyncStatus: status,
    lastErrorMessage: errorMessage,
    localItemCount,
  });
};

const normalizeRemoteSyncItem = (item) => ({
  id: String(item.id || '').trim() || undefined,
  sourceType: String(item.source_type || '').trim(),
  sourceRefId: String(item.source_ref_id || '').trim(),
  canonicalQuestion: String(item.canonical_question || '').trim(),
  questionText: String(item.question_text || '').trim(),
  normalizedQuestion: String(item.normalized_question || '').trim(),
  category: String(item.category || '').trim(),
  difficulty: String(item.difficulty || 'medium').trim(),
  track: String(item.track || '').trim(),
  chapter: String(item.chapter || '').trim(),
  knowledgePoints: Array.isArray(item.knowledge_points) ? item.knowledge_points : [],
  expectedPoints: Array.isArray(item.expected_points) ? item.expected_points : [],
  metadata: item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata
    : {},
  status: String(item.status || 'active').trim() || 'active',
  createdAt: String(item.created_at || '').trim() || undefined,
  updatedAt: String(item.updated_at || '').trim() || undefined,
});

const isValidRemoteSyncItem = (item) =>
  Boolean(
    item.sourceType
    && item.sourceRefId
    && item.canonicalQuestion
    && item.questionText,
  );

const upsertRemoteQuestionSources = (items = []) => {
  let syncedCount = 0;
  for (const rawItem of items) {
    const item = normalizeRemoteSyncItem(rawItem);
    if (!isValidRemoteSyncItem(item)) {
      continue;
    }
    upsertQuestionSource(item);
    syncedCount += 1;
  }
  return syncedCount;
};

const checkLocalPublicSourceUpdate = async () => {
  const current = refreshLocalPublicSourceState({ status: 'checking', errorMessage: '' });
  const remote = getRemoteSyncConfig();

  if (!remote.remoteConfigured) {
    const result = refreshLocalPublicSourceState({ status: 'idle', errorMessage: '' });
    return {
      source_name: LOCAL_PUBLIC_SOURCE_NAME,
      has_local_data: Number(result?.local_item_count || 0) > 0,
      local_item_count: Number(result?.local_item_count || 0),
      last_synced_at: result?.last_synced_at || null,
      last_server_time: result?.last_server_time || null,
      sync_status: result?.last_sync_status || 'idle',
      has_remote_update: false,
      latest_remote_updated_at: null,
      remote_configured: false,
      mode: 'local_first',
      message: 'remote_sync_not_configured',
    };
  }

  try {
    const remoteVersion = await fetchRemoteJson({
      baseUrl: remote.remoteBaseUrl,
      apiKey: remote.remoteApiKey,
      timeoutMs: remote.timeoutMs,
      pathname: '/v1/public-question-sources/version',
    });
    const latestRemoteUpdatedAt = String(remoteVersion.latest_updated_at || '').trim() || null;
    const serverTime = String(remoteVersion.server_time || '').trim() || null;
    const lastServerTime = current?.last_server_time || null;
    const hasRemoteUpdate = Boolean(
      latestRemoteUpdatedAt
      && (!lastServerTime || new Date(latestRemoteUpdatedAt).getTime() > new Date(lastServerTime).getTime()),
    );
    const result = refreshLocalPublicSourceState({
      status: 'idle',
      errorMessage: '',
      lastServerTime: serverTime || lastServerTime,
      lastSyncedAt: current?.last_synced_at || null,
    });

    return {
      source_name: LOCAL_PUBLIC_SOURCE_NAME,
      has_local_data: Number(result?.local_item_count || 0) > 0,
      local_item_count: Number(result?.local_item_count || 0),
      last_synced_at: result?.last_synced_at || null,
      last_server_time: result?.last_server_time || null,
      sync_status: result?.last_sync_status || 'idle',
      has_remote_update: hasRemoteUpdate,
      latest_remote_updated_at: latestRemoteUpdatedAt,
      remote_configured: true,
      mode: 'local_first',
      message: hasRemoteUpdate ? 'remote_update_available' : 'already_up_to_date',
    };
  } catch (error) {
    const result = refreshLocalPublicSourceState({
      status: 'failed',
      errorMessage: error.message,
    });

    return {
      source_name: LOCAL_PUBLIC_SOURCE_NAME,
      has_local_data: Number(result?.local_item_count || 0) > 0,
      local_item_count: Number(result?.local_item_count || 0),
      last_synced_at: result?.last_synced_at || null,
      last_server_time: result?.last_server_time || null,
      sync_status: result?.last_sync_status || 'failed',
      has_remote_update: false,
      latest_remote_updated_at: null,
      remote_configured: true,
      mode: 'local_first',
      message: 'remote_check_failed',
      last_error_message: result?.last_error_message || error.message,
    };
  }
};

const syncLocalPublicQuestionSources = async () => {
  const remote = getRemoteSyncConfig();
  const current = refreshLocalPublicSourceState({ status: 'syncing', errorMessage: '' });
  const localItemCount = Number(current?.local_item_count || 0);

  if (!remote.remoteConfigured) {
    const result = refreshLocalPublicSourceState({
      status: 'success',
      errorMessage: '',
    });

    return {
      source_name: LOCAL_PUBLIC_SOURCE_NAME,
      sync_status: result?.last_sync_status || 'success',
      local_item_count: Number(result?.local_item_count || localItemCount),
      last_synced_at: result?.last_synced_at || null,
      remote_configured: false,
      mode: 'local_first',
      message: 'remote_sync_not_configured_local_state_refreshed',
    };
  }

  try {
    let syncedCount = 0;
    let hasMore = false;
    let nextSince = current?.last_server_time || current?.last_synced_at || null;
    let lastServerTime = current?.last_server_time || null;

    do {
      const remotePayload = await fetchRemoteJson({
        baseUrl: remote.remoteBaseUrl,
        apiKey: remote.remoteApiKey,
        timeoutMs: remote.timeoutMs,
        pathname: '/v1/public-question-sources/sync',
        searchParams: {
          since: nextSince,
          limit: 500,
        },
      });

      const items = Array.isArray(remotePayload.items) ? remotePayload.items : [];
      syncedCount += upsertRemoteQuestionSources(items);
      hasMore = remotePayload.has_more === true;
      nextSince = String(remotePayload.next_since || '').trim() || nextSince;
      lastServerTime = String(remotePayload.server_time || '').trim() || lastServerTime;
    } while (hasMore);

    const result = refreshLocalPublicSourceState({
      status: 'success',
      errorMessage: '',
      lastServerTime,
    });

    return {
      source_name: LOCAL_PUBLIC_SOURCE_NAME,
      sync_status: result?.last_sync_status || 'success',
      synced_count: syncedCount,
      local_item_count: Number(result?.local_item_count || localItemCount),
      last_synced_at: result?.last_synced_at || null,
      last_server_time: result?.last_server_time || null,
      remote_configured: true,
      mode: 'local_first',
      message: 'remote_sync_completed',
    };
  } catch (error) {
    const result = refreshLocalPublicSourceState({
      status: 'failed',
      errorMessage: error.message,
    });

    return {
      source_name: LOCAL_PUBLIC_SOURCE_NAME,
      sync_status: result?.last_sync_status || 'failed',
      synced_count: 0,
      local_item_count: Number(result?.local_item_count || localItemCount),
      last_synced_at: result?.last_synced_at || null,
      last_server_time: result?.last_server_time || null,
      remote_configured: true,
      mode: 'local_first',
      message: 'remote_sync_failed',
      last_error_message: result?.last_error_message || error.message,
    };
  }
};

module.exports = {
  LOCAL_PUBLIC_SOURCE_NAME,
  buildLocalPublicSourceStatus,
  checkLocalPublicSourceUpdate,
  syncLocalPublicQuestionSources,
  upsertRemoteQuestionSources,
};
