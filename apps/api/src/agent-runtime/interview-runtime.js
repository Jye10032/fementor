const { randomUUID } = require('crypto');
const { extractJsonObject } = require('../llm');
const {
  buildUnifiedTurnMessages,
  normalizeUnifiedTurnResult,
  processInterviewTurnWithLLM,
} = require('../interview/llm-service');
const { createContentStreamSplitter } = require('../interview/content-stream-splitter');
const { AGENT_RUNTIME_IDS, AGENT_TASK_TYPES, AgentRuntimeError } = require('./contracts');
const { getDshRuntimeConfig } = require('./dsh-config');
const { DshRuntime } = require('./dsh-runtime');
const { executeRuntimeTask } = require('./execute-task');
const { NativeApiRuntime } = require('./native-api-runtime');
const { CodexSandboxRuntime } = require('./codex/runtime');
const { assertInterviewConfig, assertNoPendingCleanup, evaluateCodexInterviewAnswer, cancelActiveCodexRuns,
  startCodexRecovery, getCodexRecoveryStatus } = require('./codex/interview-runner');

let sharedDshRuntime = null;

const getPackageVersion = (packageName) => require(`${packageName}/package.json`).version;

const getConfiguredRuntimeId = (env = process.env) => {
  const runtimeId = String(env.AGENT_RUNTIME || AGENT_RUNTIME_IDS.NATIVE_API).trim().toLowerCase();
  if (!Object.values(AGENT_RUNTIME_IDS).includes(runtimeId)) {
    throw new AgentRuntimeError('invalid_config', `unsupported AGENT_RUNTIME: ${runtimeId}`);
  }
  return runtimeId;
};

const assertDshProviderCredential = (env = process.env) => {
  const credentialEnvKey = String(env.DSH_PROVIDER_API_KEY_ENV || '').trim();
  if (!credentialEnvKey) {
    throw new AgentRuntimeError(
      'runtime_unavailable',
      'DSH_PROVIDER_API_KEY_ENV is required when AGENT_RUNTIME=dsh',
    );
  }
  if (!String(env[credentialEnvKey] || '').trim()) {
    throw new AgentRuntimeError(
      'runtime_unavailable',
      `DSH provider credential is missing: ${credentialEnvKey}`,
    );
  }
};

const buildDshEvaluationPrompt = (input, request = {}) => {
  const messages = buildUnifiedTurnMessages(input);
  const skillNames = (request.skillRefs || []).map((ref) => String(ref).split('@')[0]).filter(Boolean);
  return [
    'Execute this bounded FEMentor evaluation task. Do not modify files, call shell commands, or persist business state.',
    'Treat the following system instructions as authoritative. Return only the requested JSON object.',
    skillNames.length > 0 ? `Load and follow these approved skills before evaluating: ${skillNames.join(', ')}.` : '',
    '',
    '<system_instructions>',
    messages[0].content,
    '</system_instructions>',
    '',
    '<task_input>',
    messages[1].content,
    '</task_input>',
  ].filter(Boolean).join('\n');
};

const INTERVIEW_INTENTS = new Set(['answer', 'clarify', 'question_back', 'skip', 'meta', 'invalid']);
const SCORE_DIMENSIONS = ['technical_depth', 'structure_clarity', 'evidence_grounding', 'role_fit'];

const validateDshEvaluationResult = (result) => {
  if (!INTERVIEW_INTENTS.has(result.intent)) {
    throw new AgentRuntimeError('invalid_output', 'dsh evaluation returned an invalid intent');
  }
  if (typeof result.content !== 'string') {
    throw new AgentRuntimeError('invalid_output', 'dsh evaluation content must be a string');
  }
  if (result.intent !== 'answer') return;

  if (!Number.isFinite(result.total_score) || result.total_score < 0 || result.total_score > 100) {
    throw new AgentRuntimeError('invalid_output', 'dsh evaluation total_score must be between 0 and 100');
  }
  if (!result.dimension_scores || typeof result.dimension_scores !== 'object') {
    throw new AgentRuntimeError('invalid_output', 'dsh evaluation dimension_scores are required');
  }
  for (const dimension of SCORE_DIMENSIONS) {
    const score = result.dimension_scores[dimension];
    if (!Number.isFinite(score) || score < 0 || score > 25) {
      throw new AgentRuntimeError(
        'invalid_output',
        `dsh evaluation dimension_scores.${dimension} must be between 0 and 25`,
      );
    }
  }
};

const parseDshEvaluationOutput = (finalResponse, _result, request) => {
  const parsed = extractJsonObject(finalResponse);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentRuntimeError('invalid_output', 'dsh evaluation did not return a JSON object');
  }
  validateDshEvaluationResult(parsed);
  return normalizeUnifiedTurnResult(parsed, request.input?.questionTypeHint);
};

const createNativeInterviewRuntime = (sessionContext) => new NativeApiRuntime({
  executors: {
    [AGENT_TASK_TYPES.EVALUATE_ANSWER]: async ({ input, emitOutputDelta, signal }) =>
      processInterviewTurnWithLLM({
        ...input,
        sessionContext,
        onToken: emitOutputDelta,
        signal,
      }),
  },
});

const getDshInterviewRuntime = (env = process.env) => {
  if (!sharedDshRuntime) {
    const harnessOptions = getDshRuntimeConfig(env);
    sharedDshRuntime = new DshRuntime({
      harnessOptions,
      promptBuilders: {
        [AGENT_TASK_TYPES.EVALUATE_ANSWER]: buildDshEvaluationPrompt,
      },
      outputParsers: {
        [AGENT_TASK_TYPES.EVALUATE_ANSWER]: parseDshEvaluationOutput,
      },
      maxConcurrentRuns: Number(env.DSH_MAX_CONCURRENT_RUNS || 1),
    });
    console.log('[agent-runtime.dsh.configured]', {
      sdk_version: getPackageVersion('@deepseek-ai/dsh-sdk-client'),
      runtime_version: getPackageVersion('@deepseek-ai/dsh-sdk-jsonrpc-demo'),
      provider: harnessOptions.provider,
      model: harnessOptions.model,
      max_concurrent_runs: 1,
    });
  }
  return sharedDshRuntime;
};

const getAgentRuntimeHealth = (env = process.env) => {
  const configuredRuntime = String(env.AGENT_RUNTIME || AGENT_RUNTIME_IDS.NATIVE_API).trim().toLowerCase();
  try {
    const selectedRuntime = getConfiguredRuntimeId(env);
    const orchestrator = require('../interview/director/config').getInterviewOrchestrator(env);
    if (selectedRuntime === AGENT_RUNTIME_IDS.CODEX) {
      const config = assertInterviewConfig(env);
      assertNoPendingCleanup(env);
      return { configured_runtime: configuredRuntime, selected_runtime: selectedRuntime, available: true,
        state: 'configured', orchestrator,
        profile_id: orchestrator === 'director' ? require('./codex/config').DIRECTOR_PROFILE_ID : config.profileId,
        network: 'loopback-only', verification: 'before-each-run',
        max_concurrent_runs: orchestrator === 'director' ? 2 : 1, max_concurrent_interviews: 1,
        max_concurrent_sandboxes: orchestrator === 'director' ? 2 : 1,
        ...(orchestrator === 'director' ? { max_experts_per_turn: 2 } : {}),
        user_configurable: false, recovery: getCodexRecoveryStatus() };
    }
    if (selectedRuntime === AGENT_RUNTIME_IDS.NATIVE_API) {
      return {
        configured_runtime: configuredRuntime,
        selected_runtime: selectedRuntime,
        available: true,
        state: 'ready',
        user_configurable: false,
      };
    }

    assertDshProviderCredential(env);
    const config = getDshRuntimeConfig(env);
    const runtimeStatus = sharedDshRuntime?.status();
    const available = runtimeStatus?.state === 'ready';
    return {
      configured_runtime: configuredRuntime,
      selected_runtime: selectedRuntime,
      available,
      state: runtimeStatus?.state || 'not_started',
      sdk_version: getPackageVersion('@deepseek-ai/dsh-sdk-client'),
      runtime_version: getPackageVersion('@deepseek-ai/dsh-sdk-jsonrpc-demo'),
      provider: config.provider,
      model: config.model,
      max_concurrent_runs: 1,
      user_configurable: false,
    };
  } catch (error) {
    return {
      configured_runtime: configuredRuntime,
      selected_runtime: configuredRuntime,
      available: false,
      state: 'unavailable',
      error_code: error.code || 'runtime_unavailable',
      error_message: error.message,
      ...(configuredRuntime === AGENT_RUNTIME_IDS.CODEX ? { recovery: getCodexRecoveryStatus() } : {}),
      user_configurable: false,
    };
  }
};

const prepareConfiguredInterviewRuntime = async (env = process.env) => {
  const runtimeId = getConfiguredRuntimeId(env);
  // Recovery only needs control credentials; invalid scoring configuration is
  // exposed by health/admission without taking read endpoints or cleanup down.
  if (runtimeId === AGENT_RUNTIME_IDS.CODEX) { await startCodexRecovery(env); return; }
  if (runtimeId !== AGENT_RUNTIME_IDS.DSH) return;

  assertDshProviderCredential(env);
  const runtime = getDshInterviewRuntime(env);
  let session;
  try {
    session = await runtime.startSession({ interviewSessionId: 'startup-readiness' });
  } catch (error) {
    await disposeInterviewRuntimes().catch(() => {});
    throw error;
  } finally {
    if (session) await runtime.closeSession(session).catch(() => {});
  }
};

const getInterviewRuntime = ({ env = process.env, sessionContext } = {}) => {
  const runtimeId = getConfiguredRuntimeId(env);
  if (runtimeId === AGENT_RUNTIME_IDS.CODEX) return new CodexSandboxRuntime({ config: assertInterviewConfig(env) });
  return runtimeId === AGENT_RUNTIME_IDS.DSH
    ? getDshInterviewRuntime(env)
    : createNativeInterviewRuntime(sessionContext);
};

const evaluateInterviewAnswerWithRuntime = async ({
  interviewSessionId,
  sessionContext,
  onToken,
  signal,
  onPhase,
  ...input
}) => {
  if (getConfiguredRuntimeId() === AGENT_RUNTIME_IDS.CODEX) {
    return evaluateCodexInterviewAnswer({ interviewSessionId, input, signal, onPhase });
  }
  const runtime = getInterviewRuntime({ sessionContext });
  const contentSplitter = runtime.id === AGENT_RUNTIME_IDS.DSH
    ? createContentStreamSplitter({ onContentToken: onToken })
    : null;

  const output = await executeRuntimeTask({
    runtime,
    sessionRequest: {
      interviewSessionId,
      runtimeConfigRef: runtime.id === AGENT_RUNTIME_IDS.DSH ? 'server-dsh-profile' : 'request-session-context',
    },
    runRequest: {
      runId: randomUUID(),
      taskType: AGENT_TASK_TYPES.EVALUATE_ANSWER,
      input,
      contextRefs: [],
      skillRefs: ['frontend-answer-evaluation@1'],
      outputSchema: 'interview-turn-result-v1',
      budget: {
        deadlineMs: Math.max(1, Number(process.env.AGENT_RUN_DEADLINE_MS || 120000)),
        maxSteps: Math.max(
          1,
          Number(process.env.AGENT_RUN_MAX_STEPS || (runtime.id === AGENT_RUNTIME_IDS.DSH ? 3 : 1)),
        ),
      },
    },
    onEvent: async (event) => {
      if (event.type !== 'output_delta' || typeof onToken !== 'function') return;
      if (contentSplitter) {
        await contentSplitter.feed(event.data.delta);
      } else {
        await onToken(event.data.delta);
      }
    },
  });

  if (contentSplitter) {
    const streamed = contentSplitter.end();
    if (!streamed._contentWasStreamed && output.content && typeof onToken === 'function') {
      await onToken(output.content);
    }
  }
  return output;
};

const disposeInterviewRuntimes = async () => {
  await cancelActiveCodexRuns();
  const runtime = sharedDshRuntime;
  sharedDshRuntime = null;
  if (runtime) await runtime.dispose();
};

module.exports = {
  assertDshProviderCredential,
  buildDshEvaluationPrompt,
  disposeInterviewRuntimes,
  evaluateInterviewAnswerWithRuntime,
  getAgentRuntimeHealth,
  getConfiguredRuntimeId,
  getInterviewRuntime,
  parseDshEvaluationOutput,
  prepareConfiguredInterviewRuntime,
  validateDshEvaluationResult,
};
