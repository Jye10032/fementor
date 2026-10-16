const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AgentRuntimeError } = require('../contracts');
const { executeRuntimeTask } = require('../execute-task');
const { readCodexSandboxConfig, readRailwayControlConfig, DIRECTOR_PROFILE_ID, QUESTION_PROFILE_ID } = require('./config');
const { CodexSandboxRuntime } = require('./runtime');
const { createCodexRecovery } = require('./recovery');
const { TERMINAL_CLEANUP, journalDirectory, readRunRecords, saveRunRecord } = require('./run-journal');

const activeRuns = new Map();
let recovery;
function assertInterviewConfig(env = process.env) {
  if (env.CODEX_SANDBOX_ENABLED !== '1' || env.INTERVIEW_PIPELINE_VERSION === 'legacy') {
    throw new AgentRuntimeError('invalid_config', 'Codex requires CODEX_SANDBOX_ENABLED=1 and the unified interview pipeline');
  }
  return readCodexSandboxConfig(env);
}
function assertNoPendingCleanup(env = process.env) {
  let unresolved = recovery?.status().state === 'journal_unavailable';
  try {
    unresolved ||= readRunRecords(journalDirectory(env), env.RAILWAY_ENVIRONMENT_ID?.trim()).some(({ record, errorCode }) =>
      errorCode || (!activeRuns.has(record.runId) && !TERMINAL_CLEANUP.has(record.cleanup)));
  } catch { unresolved = true; }
  if (unresolved) {
    throw Object.assign(new AgentRuntimeError('recovery_required', '评分环境正在恢复，资源清理确认后可重试'), { statusCode: 503 });
  }
}

async function startCodexRecovery(env = process.env) {
  if (!recovery) recovery = createCodexRecovery({ directory: journalDirectory(env),
    config: readRailwayControlConfig(env), isActive: (runId) => activeRuns.has(runId) });
  await recovery.start();
}
const getCodexRecoveryStatus = () => recovery?.status() || { state: 'not_started' };

// Factory supports deterministic lifecycle checks without a Railway account.
// Production uses only the default factory and the process-wide ownership map.
function createCodexInterviewRunner({ runtimeFactory = (options) => new CodexSandboxRuntime(options),
  env = process.env, runs = activeRuns, checkCleanup = () => assertNoPendingCleanup(env) } = {}) {
  async function runOwned({ interviewSessionId, input, taskSpec, config, signal, onPhase, parentRunId, toolGateway, onCancel, beforeRelease, runId = randomUUID() }) {
    const file = path.join(journalDirectory(env), `${runId}.json`);
    const record = { runId, interviewSessionId, parentRunId: parentRunId || null,
      profileId: config.profileId, environmentId: config.environmentId,
      taskType: taskSpec?.taskType || 'evaluate-answer', rootRunId: parentRunId || runId,
      startedAt: new Date().toISOString(), status: 'running', cleanup: 'not_created', lifecycle: [], contextBudget: input.contextBudget };
    const save = () => saveRunRecord(file, record);
    let finish, runtime;
    const done = new Promise((resolve) => { finish = resolve; });
    const controller = new AbortController();
    const cancel = () => { controller.abort(); onCancel?.(); void runtime?.cancelTurn(); };
    // Register before writing the journal or invoking any dispatch-capable code.
    runs.set(runId, { runtime: { cancelTurn: cancel }, done });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      save();
      if (controller.signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Interview task was cancelled');
      runtime = runtimeFactory({ config, taskSpec, toolGateway, onLifecycle: (event) => {
        record.lifecycle.push({ ...event, at: new Date().toISOString() });
        if (event.state === 'creating') record.cleanup = 'create_unknown';
        if (event.sandboxId) { record.sandboxId = event.sandboxId; record.cleanup = 'pending'; }
        if (['not_created', 'destroyed', 'cleanup_pending', 'create_unknown'].includes(event.state)) record.cleanup = event.state;
        save();
      } });
      if (controller.signal.aborted) { await runtime.cancelTurn(); throw new AgentRuntimeError('run_cancelled', 'Interview task was cancelled'); }
      const output = await executeRuntimeTask({ runtime,
        sessionRequest: { interviewSessionId, runtimeConfigRef: config.profileId },
        runRequest: { runId, taskType: taskSpec?.taskType || 'evaluate-answer', input,
          skillRefs: taskSpec ? [] : ['frontend-answer-evaluation@1'],
          budget: { deadlineMs: config.turnDeadlineMs, maxSteps: config.maxModelRequests } },
        onEvent: async (event) => {
          if (event.type === 'started') await onPhase?.('evaluation', parentRunId ? '正在准备专家分析环境' : '正在准备隔离面试环境');
          if (event.type === 'status') await onPhase?.('evaluation', parentRunId ? '专家正在分析' : '正在分析回答');
        },
      });
      if (controller.signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Interview task was cancelled');
      record.status = 'validated';
      return { ...output, agent_runtime: { id: 'codex', profile_id: config.profileId, run_id: runId } };
    } catch (error) {
      record.status = 'failed'; record.errorCode = error.code || 'execution_failed'; throw error;
    } finally {
      await beforeRelease?.();
      signal?.removeEventListener('abort', cancel);
      record.audit = runtime?.audit;
      record.completedAt = new Date().toISOString();
      try { save(); } finally { runs.delete(runId); finish(); }
    }
  }

  function admit(signal) {
    if (runs.size) throw Object.assign(new AgentRuntimeError('runtime_busy', '面试服务忙，请稍后重试'), { statusCode: 429 });
    const config = assertInterviewConfig(env);
    checkCleanup();
    if (signal?.aborted) throw new AgentRuntimeError('run_cancelled', 'Interview task was cancelled');
    return config;
  }

  async function evaluateCodexInterviewAnswer({ interviewSessionId, input, signal, onPhase }) {
    const config = admit(signal);
    return runOwned({ interviewSessionId, input, signal, onPhase, config });
  }

  async function runCodexInterviewDirector({ interviewSessionId, input, taskSpec, onTool, signal, onPhase }) {
    const base = admit(signal);
    if (taskSpec?.taskType !== 'direct-interview' || typeof onTool !== 'function') {
      throw new AgentRuntimeError('invalid_request', 'Director requires a host task and tool handler');
    }
    const runId = randomUUID();
    const controller = new AbortController();
    const cancel = () => { if (!controller.signal.aborted) controller.abort(); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    // This covers setup, all serial specialists, parsing and cleanup admission.
    const deadline = setTimeout(cancel, 900000);
    let live = true, children = 0, childPromise = null;
    const runChild = ({ taskSpec: childSpec, input: childInput }) => {
      if (!live || controller.signal.aborted || !runs.has(runId)) throw new AgentRuntimeError('run_cancelled', 'Root task is no longer live');
      if (childPromise) throw new AgentRuntimeError('tool_request_denied', 'Parallel experts are not permitted');
      if (children >= 2) throw new AgentRuntimeError('tool_budget_exceeded', 'Expert budget exceeded');
      if (childSpec && !['evaluate-answer', 'design-question'].includes(childSpec.taskType)) throw new AgentRuntimeError('unsupported_task', 'Unknown specialist profile');
      children++;
      const config = { ...base, profileId: childSpec?.taskType === 'design-question' ? QUESTION_PROFILE_ID : base.profileId };
      childPromise = runOwned({ interviewSessionId, input: childInput, taskSpec: childSpec, config,
        parentRunId: runId, signal: controller.signal, onPhase });
      const pending = childPromise;
      // Cleanup is part of runOwned; child output is released only afterwards.
      return pending.catch((error) => {
        // A failed execution or unconfirmed deletion ends the entire root.
        // Poison admission before releasing the serial slot, even if the host
        // callback catches this rejection and tries to continue.
        cancel();
        throw error;
      }).finally(() => { if (childPromise === pending) childPromise = null; });
    };
    try {
      return await runOwned({ interviewSessionId, input, taskSpec, runId, signal: controller.signal, onPhase, onCancel: cancel,
        beforeRelease: async () => { live = false; controller.abort(); await Promise.allSettled(childPromise ? [childPromise] : []); },
        config: { ...base, profileId: DIRECTOR_PROFILE_ID, turnDeadlineMs: 900000, maxModelRequests: 4 },
        toolGateway: { onTool: async (call) => {
          if (!live || controller.signal.aborted) throw new AgentRuntimeError('run_cancelled', 'Root task is no longer live');
          call.signal.addEventListener('abort', cancel, { once: true });
          try { return await onTool({ ...call, runChild }); }
          finally { call.signal.removeEventListener('abort', cancel); }
        } },
      });
    } finally {
      live = false; controller.abort();
      await Promise.allSettled(childPromise ? [childPromise] : []);
      clearTimeout(deadline);
      signal?.removeEventListener('abort', cancel);
    }
  }
  return { evaluateCodexInterviewAnswer, runCodexInterviewDirector };
}

const { evaluateCodexInterviewAnswer, runCodexInterviewDirector } = createCodexInterviewRunner();

async function cancelActiveCodexRuns() {
  const previousRecovery = recovery;
  recovery = null;
  await previousRecovery?.stop();
  const runs = [...activeRuns.values()];
  await Promise.allSettled(runs.map(async ({ runtime, done }) => { await runtime.cancelTurn(); await done; }));
}
module.exports = { createCodexInterviewRunner, runCodexInterviewDirector, assertInterviewConfig, assertNoPendingCleanup, evaluateCodexInterviewAnswer, cancelActiveCodexRuns,
  journalDirectory, startCodexRecovery, getCodexRecoveryStatus };
