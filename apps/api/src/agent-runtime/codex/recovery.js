const { RailwaySandboxManager } = require('./railway-sandbox-manager');
const { TERMINAL_CLEANUP, readRunRecords, saveRunRecord } = require('./run-journal');

// Single API owner / one persistent volume. This is resource recovery, not a
// distributed lease or replay of an interrupted business transaction.
function createCodexRecovery({ directory, config, isActive, intervalMs = 30000, maxPerSweep = 2,
  managerFactory = (options) => new RailwaySandboxManager(options), now = Date.now,
  onResult = (result) => console.log('[codex.recovery]', result) }) {
  let timer, inFlight, stopped = false;
  const pendingWrites = new Map();
  let status = { state: 'not_started', pending: 0, manual: 0, lastScanAt: null };
  const records = () => readRunRecords(directory, config.environmentId);
  const pending = (entry) => entry.errorCode || (!isActive(entry.record.runId) && !TERMINAL_CLEANUP.has(entry.record.cleanup));
  const needsManual = (entry) => Boolean(entry.errorCode || !entry.record.sandboxId || entry.record.recovery?.requiresManual);
  const refreshStatus = () => {
    const unresolved = records().filter(pending);
    status = { state: unresolved.length ? 'recovery_required' : 'ready', pending: unresolved.length,
      manual: unresolved.filter(needsManual).length, lastScanAt: new Date(now()).toISOString() };
  };
  async function runSweep() {
    let attempted = 0;
    const persist = (file, record) => {
      try { saveRunRecord(file, record); pendingWrites.delete(file); }
      catch { pendingWrites.set(file, record); }
    };
    try {
      // rename can succeed before directory fsync fails. Retry those writes
      // even when the readable record already says destroyed.
      for (const [file, record] of pendingWrites) persist(file, record);
      for (const entry of records()) {
        if (stopped || attempted >= maxPerSweep) break;
        if (!pending(entry) || needsManual(entry)) continue;
        const { file, record } = entry;
        if (Date.parse(record.recovery?.nextAttemptAt || '') > now()) continue;
        attempted++;
        record.recovery = { ...record.recovery, attempts: (record.recovery?.attempts || 0) + 1,
          lastAttemptAt: new Date(now()).toISOString(), nextAttemptAt: null };
        // An audit-write failure must not veto deletion of a validated owner ID.
        persist(file, record);
        const manager = managerFactory({ config });
        manager.sandboxId = record.sandboxId;
        manager.cleanupState = 'cleanup_pending';
        try {
          await manager.destroy();
          if (manager.cleanupState !== 'destroyed') throw Object.assign(new Error(), { code: 'cleanup_pending' });
          record.cleanup = 'destroyed';
          record.recovery.completedAt = new Date(now()).toISOString();
          record.recovery.lastErrorCode = null;
          if (record.status === 'running') {
            record.status = 'interrupted';
            record.errorCode = 'owner_process_exited';
            record.completedAt = record.recovery.completedAt;
          }
          record.lifecycle = [...(record.lifecycle || []), { state: 'destroyed', sandboxId: record.sandboxId,
            source: 'recovery', at: record.recovery.completedAt }];
        } catch (error) {
          record.cleanup = 'cleanup_pending';
          record.recovery.lastErrorCode = error.code === 'sandbox_ownership_mismatch' ? error.code : 'cleanup_pending';
          record.recovery.requiresManual = error.code === 'sandbox_ownership_mismatch';
          const backoff = Math.min(300000, intervalMs * 2 ** Math.min(record.recovery.attempts - 1, 4));
          record.recovery.nextAttemptAt = new Date(now() + backoff).toISOString();
        }
        persist(file, record);
        onResult({ runId: record.runId, sandboxId: record.sandboxId, cleanup: record.cleanup,
          attempt: record.recovery.attempts, errorCode: record.recovery.lastErrorCode });
      }
      refreshStatus();
      if (pendingWrites.size) throw new Error('journal_unavailable');
    } catch {
      // Keep HTTP/read endpoints up. The admission check still fails closed.
      status = { state: 'journal_unavailable', pending: null, manual: null, lastScanAt: new Date(now()).toISOString() };
    }
  }
  function sweep() {
    if (stopped) return Promise.resolve();
    if (!inFlight) inFlight = runSweep().finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    async start() {
      await sweep();
      if (!stopped && !timer) { timer = setInterval(() => { void sweep(); }, intervalMs); timer.unref(); }
    },
    sweep,
    status: () => ({ ...status }),
    async stop() { stopped = true; clearInterval(timer); await inFlight; },
  };
}

module.exports = { createCodexRecovery };
