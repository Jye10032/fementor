const { AgentRuntimeError } = require('../contracts');

const TRANSIENT = new Set(['model_overloaded', 'model_rate_limited', 'model_unavailable', 'model_connection_failed']);
const MESSAGES = {
  model_overloaded: '模型服务繁忙，请稍后重试',
  model_rate_limited: '模型请求暂时受限，请稍后重试',
  model_unavailable: '模型服务暂时不可用，请稍后重试',
  model_connection_failed: '模型连接中断，请稍后重试',
  model_auth_failed: '模型服务配置异常，请联系管理员处理',
  model_quota_exceeded: '模型服务额度不足，请联系管理员处理',
  model_response_incomplete: '模型未完成本轮分析，请重试',
  model_upstream_failed: '模型请求未成功，请稍后重试',
};

// Provider bodies, request IDs and free-form messages never enter public errors
// or journals. Message text is inspected only to classify a known overload.
function modelFailure({ status, error = {}, retryAfter } = {}) {
  const code = error?.code;
  const type = error?.type;
  let kind = 'model_upstream_failed';
  if (status === 401 || status === 403 || code === 'invalid_api_key') kind = 'model_auth_failed';
  else if (code === 'insufficient_quota' || type === 'insufficient_quota') kind = 'model_quota_exceeded';
  else if (code === 'overloaded_error' || type === 'overloaded_error'
    || (['service_unavailable_error', 'server_error'].includes(type)
      && /overload|capacity/i.test(String(error?.message || '')))) kind = 'model_overloaded';
  else if (status === 429 || code === 'rate_limit_exceeded' || type === 'rate_limit_error') kind = 'model_rate_limited';
  else if ([500, 502, 503, 504].includes(status)
    || ['service_unavailable_error', 'server_error'].includes(type) || code === 'server_error') kind = 'model_unavailable';
  const failure = new AgentRuntimeError(kind, MESSAGES[kind]);
  const seconds = Number(retryAfter);
  const dateDelay = Date.parse(retryAfter) - Date.now();
  failure.retryAfterMs = retryAfter == null ? 2000
    : Math.max(2000, Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(dateDelay) ? dateDelay : 2000);
  return failure;
}

module.exports = { modelFailure, TRANSIENT, MESSAGES };
