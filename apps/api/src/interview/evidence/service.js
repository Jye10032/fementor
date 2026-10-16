const { randomUUID } = require('node:crypto');
const { NativeApiRuntime } = require('../../agent-runtime/native-api-runtime');
const { executeRuntimeTask } = require('../../agent-runtime/execute-task');
const { chatCompletion, extractJsonObject, getResolvedLlmConfig } = require('../../llm');
const { PROMPT_VERSION, buildMessages, validateEvidence } = require('./contract');
const { getStore } = require('./store');
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
function generationEnabled() {
  return process.env.INTERVIEW_EVIDENCE_SHADOW === '1' && (process.env.AGENT_RUNTIME || 'native-api') === 'native-api';
}
function createEvaluator({ store, complete = chatCompletion, config = getResolvedLlmConfig } = {}) {
  const pending = new Map();
  async function read(args) { return (store || await getStore()).read(args); }
  async function evaluate(args) {
    const repository = store || await getStore();
    const snapshot = await repository.read(args); // Reauthorize even when the result is cached.
    if (snapshot.evaluation) return snapshot;
    if (!generationEnabled()) fail(409, 'evidence shadow generation is disabled or unsupported by this runtime');
    if (pending.size >= 1) fail(429, 'evidence evaluation is busy; retry later');
    const key = `${args.sessionId}:${args.turnId}`;
    pending.set(key, true);
    try {
      const runtimeConfig = config(args.sessionContext);
      if (!runtimeConfig.apiKey) fail(503, 'evidence evaluation requires a configured model');
      const runtime = new NativeApiRuntime({ executors: {
        'evaluate-evidence': async ({ input, signal }) => {
          const raw = await complete({ messages: buildMessages(input), runtimeConfig, signal, temperature: 0 });
          return validateEvidence(extractJsonObject(raw), input);
        },
      } });
      const result = await executeRuntimeTask({ runtime,
        sessionRequest: { interviewSessionId: args.sessionId },
        runRequest: { runId: randomUUID(), taskType: 'evaluate-evidence', input: snapshot.input,
          budget: { deadlineMs: 45000, maxSteps: 1 } },
      });
      return await repository.save({ ...args, save: { input_hash: snapshot.input_hash, result,
        provenance: { runtime: 'native-api', model: runtimeConfig.model, prompt_version: PROMPT_VERSION,
          mode: 'shadow', assistance: snapshot.input.assistance, rubric_source: snapshot.input.rubric.source } } });
    } catch (error) {
      if (error.statusCode) throw error;
      // Provider bodies can contain request details. Do not return them to the browser.
      fail(502, 'evidence evaluation failed; no result was saved');
    } finally { pending.delete(key); }
  }
  return { read, evaluate };
}
module.exports = { createEvaluator, generationEnabled };
