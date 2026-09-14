const assert = require('node:assert/strict');
const test = require('node:test');
const { getInterviewStartLimitFailure } = require('../../src/routes/interview-routes');

test('cloud interview quota never asks users for an LLM key', () => {
  const failure = getInterviewStartLimitFailure({
    todayUsedCount: 1,
    hasUserSessionKey: true,
    runtimeMode: 'cloud',
  });

  assert.equal(failure.error, 'DAILY_LIMIT_REACHED');
  assert.doesNotMatch(failure.message, /Key/i);
});

test('local interview quota keeps the explicit session-key escape hatch', () => {
  assert.equal(
    getInterviewStartLimitFailure({
      todayUsedCount: 1,
      hasUserSessionKey: true,
      runtimeMode: 'local',
      agentRuntimeId: 'native-api',
    }),
    null,
  );

  const failure = getInterviewStartLimitFailure({
    todayUsedCount: 1,
    hasUserSessionKey: false,
    runtimeMode: 'local',
    agentRuntimeId: 'native-api',
  });
  assert.equal(failure.error, 'NEED_USER_LLM_KEY');
});

test('local dsh quota does not offer a session key that the runtime cannot consume', () => {
  const failure = getInterviewStartLimitFailure({
    todayUsedCount: 1,
    hasUserSessionKey: true,
    runtimeMode: 'local',
    agentRuntimeId: 'dsh',
  });

  assert.equal(failure.error, 'DAILY_LIMIT_REACHED');
  assert.doesNotMatch(failure.message, /Key/i);
});

test('first interview remains available in every runtime mode', () => {
  assert.equal(
    getInterviewStartLimitFailure({
      todayUsedCount: 0,
      hasUserSessionKey: false,
      runtimeMode: 'cloud',
    }),
    null,
  );
});
