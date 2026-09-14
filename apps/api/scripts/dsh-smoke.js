const { randomUUID } = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { AGENT_TASK_TYPES } = require('../src/agent-runtime/contracts');
const { getDshRuntimeConfig } = require('../src/agent-runtime/dsh-config');
const { DshRuntime } = require('../src/agent-runtime/dsh-runtime');

const isLive = process.argv.includes('--live');

const createSmokeEnv = () => ({
  ...process.env,
  DSH_RUNTIME_COMMAND: process.env.DSH_RUNTIME_COMMAND || process.execPath,
  DSH_RUNTIME_ARGS_JSON: process.env.DSH_RUNTIME_ARGS_JSON || JSON.stringify([
    'node_modules/@deepseek-ai/dsh-sdk-jsonrpc-demo/lib/bin.js',
    'config/dsh/fementor.cordis.yml',
  ]),
  DSH_RUNTIME_CWD: process.env.DSH_RUNTIME_CWD || '.',
  DSH_WORKSPACE_CWD: process.env.DSH_WORKSPACE_CWD || '../..',
  DSH_PROVIDER_API_KEY_ENV: process.env.DSH_PROVIDER_API_KEY_ENV || 'DEEPSEEK_API_KEY',
});

const run = async () => {
  const env = createSmokeEnv();
  const runtime = new DshRuntime({
    harnessOptions: getDshRuntimeConfig(env),
    promptBuilders: {
      [AGENT_TASK_TYPES.EVALUATE_ANSWER]: (input) => String(input.prompt || ''),
    },
  });
  let session;
  try {
    session = await runtime.startSession({ interviewSessionId: 'dsh-smoke' });
    const result = {
      ok: true,
      mode: isLive ? 'live' : 'handshake',
      runtime: runtime.id,
    };

    if (isLive) {
      let output;
      let failure;
      for await (const event of runtime.runTurn({
        runId: randomUUID(),
        session,
        taskType: AGENT_TASK_TYPES.EVALUATE_ANSWER,
        input: { prompt: 'Return exactly this JSON object and nothing else: {"ok":true,"source":"dsh"}' },
        contextRefs: [],
        skillRefs: [],
        outputSchema: 'dsh-smoke-v1',
        budget: { deadlineMs: 120000, maxSteps: 1 },
      })) {
        if (event.type === 'completed') output = event.data.output;
        if (event.type === 'failed') failure = event.data;
      }
      if (failure) throw new Error(`${failure.code}: ${failure.message}`);
      result.output = output;
    }

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    if (session) await runtime.closeSession(session).catch(() => {});
    await runtime.dispose();
  }
};

run().catch((error) => {
  process.stderr.write(`[dsh-smoke.failed] ${error.message}\n`);
  process.exitCode = 1;
});
