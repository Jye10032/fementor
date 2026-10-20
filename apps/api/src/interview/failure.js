const { MESSAGES } = require('../agent-runtime/codex/model-errors');

const COPY = {
  ...MESSAGES,
  run_cancelled: '本轮处理已中断，可以重新处理',
  owner_process_exited: '面试服务已重启，可以恢复本轮处理',
  recovery_required: '评分环境正在恢复，请稍后重试',
  cleanup_pending: '评分环境正在清理，请稍后重试',
  create_unknown: '评分环境正在核对，请稍后重试',
  runtime_busy: '评分服务繁忙，请稍后重试',
  context_budget_exceeded: '本轮材料超过处理上限，请联系管理员调整',
};
const COOLDOWN = { model_overloaded: 15, model_rate_limited: 30, model_unavailable: 15, model_connection_failed: 5 };

function interviewFailure(error, updatedAt, retryNotBefore = error?.retryNotBefore) {
  const code = typeof error === 'string' ? error : error?.code;
  const safeCode = Object.hasOwn(COPY, code) ? code : 'evaluation_interrupted';
  const cooldown = COOLDOWN[safeCode] || 0;
  const elapsed = updatedAt ? Math.max(0, (Date.now() - new Date(updatedAt).getTime()) / 1000) : 0;
  const remaining = retryNotBefore ? (new Date(retryNotBefore).getTime() - Date.now()) / 1000 : 0;
  const upstream = Number(error?.retryAfterMs) / 1000;
  return {
    code: safeCode,
    message: COPY[safeCode] || '本轮分析未完成，可以重试；如持续失败请联系管理员',
    retry_after_seconds: Math.ceil(Math.max(0, cooldown - (Number.isFinite(elapsed) ? elapsed : 0),
      Number.isFinite(remaining) ? remaining : 0, !retryNotBefore && Number.isFinite(upstream) ? upstream : 0)),
  };
}

module.exports = { interviewFailure };
