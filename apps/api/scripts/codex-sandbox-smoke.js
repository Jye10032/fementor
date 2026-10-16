const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { readCodexSandboxConfig, readRailwayControlConfig } = require('../src/agent-runtime/codex/config');
const { CodexSandboxRuntime } = require('../src/agent-runtime/codex/runtime');
const { RailwaySandboxManager } = require('../src/agent-runtime/codex/railway-sandbox-manager');
const { executeRuntimeTask } = require('../src/agent-runtime/execute-task');

const REPORT_DIR = process.argv.includes('--interview')
  ? require('../src/agent-runtime/codex/interview-runner').journalDirectory()
  : path.resolve(__dirname, '../data/codex-sandbox-smoke');
function saveRecord(file, record) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
}
const syntheticInput = Object.freeze({
  question: 'React 列表渲染为什么需要稳定的 key？使用数组下标会出现什么问题？',
  answer: 'key 帮助 React 在同级列表更新时识别组件身份。列表插入、删除或排序后，如果用下标，原组件状态可能对应到另一条数据，例如输入框内容错位。我会用数据的稳定唯一 ID；纯静态且顺序永远不变的列表才考虑下标。key 只需要在兄弟节点间唯一，不是全局唯一。',
  questionTypeHint: 'knowledge',
  jobDescription: '合成岗位：前端工程师，要求理解 React 状态和渲染机制。',
  resumeSummary: '', interviewContext: '合成材料，不对应真实候选人。', evidenceRefs: [],
});

async function main() {
  const cleanupIndex = process.argv.indexOf('--cleanup');
  const config = cleanupIndex >= 0 ? readRailwayControlConfig() : readCodexSandboxConfig();
  if (cleanupIndex >= 0) {
    const id = process.argv[cleanupIndex + 1];
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Invalid run ID');
    const file = path.join(REPORT_DIR, `${id}.json`);
    const record = JSON.parse(fs.readFileSync(file));
    if (record.environmentId !== config.environmentId || !record.sandboxId) throw new Error('Cleanup requires the original environment and recorded Sandbox ID');
    const manager = new RailwaySandboxManager({ config, onLifecycle: (event) => {
      record.cleanup = event.state;
      saveRecord(file, record);
    } });
    manager.sandboxId = record.sandboxId;
    await manager.destroy();
    console.log(JSON.stringify({ runId: id, cleanup: manager.cleanupState, report: file }));
    return;
  }
  const preflight = {
    profile: config.profileId, node: process.versions.node,
    codexVersion: config.codexVersion, railwaySdkVersion: config.railwaySdkVersion,
    model: config.model, modelEndpoint: new URL(config.modelBaseUrl).origin,
    environmentId: config.environmentId, syntheticOnly: true,
  };
  if (!process.argv.includes('--live')) {
    console.log(JSON.stringify({ ...preflight, status: 'config_ready', note: 'No remote resources or model calls. Use --live for the synthetic evaluation.' }, null, 2));
    return;
  }
  const runId = randomUUID();
  const file = path.join(REPORT_DIR, `${runId}.json`);
  fs.mkdirSync(REPORT_DIR, { recursive: true, mode: 0o700 });
  const report = { ...preflight, runId, startedAt: new Date().toISOString(), status: 'running', cleanup: 'not_created', lifecycle: [] };
  const save = () => saveRecord(file, report);
  save();
  const runtime = new CodexSandboxRuntime({ config, onLifecycle: (event) => {
    report.lifecycle.push({ ...event, at: new Date().toISOString() });
    if (event.state === 'creating') report.cleanup = 'create_unknown';
    if (event.sandboxId) { report.sandboxId = event.sandboxId; report.cleanup = 'pending'; }
    if (['not_created', 'destroyed', 'cleanup_pending', 'create_unknown'].includes(event.state)) report.cleanup = event.state;
    save();
    console.log(JSON.stringify({ runId, ...event }));
  } });
  const interrupt = () => runtime.cancelTurn();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const output = await executeRuntimeTask({
      runtime,
      sessionRequest: { interviewSessionId: `synthetic-${runId}`, runtimeConfigRef: config.profileId },
      runRequest: {
        runId, taskType: 'evaluate-answer', input: syntheticInput,
        skillRefs: ['frontend-answer-evaluation@1'],
        budget: { deadlineMs: config.turnDeadlineMs, maxSteps: config.maxModelRequests },
      },
      onEvent: (event) => {
        if (event.type !== 'completed') console.log(JSON.stringify({ runId, type: event.type, ...event.data }));
      },
    });
    report.status = 'passed';
    report.output = output;
  } catch (error) {
    report.status = 'failed';
    report.error = { code: error.code || 'execution_failed', message: error.code ? error.message : 'Synthetic evaluation failed' };
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    report.audit = runtime.audit;
    report.completedAt = new Date().toISOString();
    save();
    console.log(JSON.stringify({ runId, status: report.status, cleanup: report.cleanup, score: report.output?.score, error: report.error, report: file }, null, 2));
  }
}

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ status: 'failed', code: error.code || 'preflight_failed', message: error.code ? error.message : 'Preflight failed; check documented configuration' }));
  process.exitCode = 1;
});

module.exports = { syntheticInput };
