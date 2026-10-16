// Submit synthetic fixtures to the actual HTTPS API. The signing key stays local.
// Usage: node scripts/codex-cloud-smoke.js <https-api> <fixture.json> <private.pem> <report.json> [--resume]
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { sign, createPrivateKey } = require('node:crypto');

async function main() {
  const [endpoint, fixturePath, privateKeyPath, reportPath] = process.argv.slice(2);
  const origin = new URL(endpoint);
  assert.equal(origin.protocol, 'https:');
  assert.match(origin.hostname, /^codex-staging-api-[a-z0-9-]+\.up\.railway\.app$/);
  const { fixture } = JSON.parse(fs.readFileSync(fixturePath));
  assert.match(fixture.userId, /^user_staging_[a-f0-9-]{36}$/);
  const key = createPrivateKey(fs.readFileSync(privateKeyPath));
  function token(sub, valid = true) {
    const now = Math.floor(Date.now() / 1000);
    const data = [{ alg: 'RS256', typ: 'JWT', kid: 'fementor-staging' },
      { sub, iss: 'https://fementor-staging.invalid', email: `${sub}@example.invalid`,
        name: 'Synthetic cloud fixture', iat: now, nbf: now - 5, exp: now + 900 }]
      .map((item) => Buffer.from(JSON.stringify(item)).toString('base64url')).join('.');
    const signature = sign('RSA-SHA256', Buffer.from(data), key);
    if (!valid) signature[0] ^= 1;
    return `${data}.${signature.toString('base64url')}`;
  }
  const report = { testId: fixture.testId, startedAt: new Date().toISOString(), endpoint: origin.origin,
    syntheticOnly: true, auth: 'staging RSA-signed JWT; not a hosted Clerk session', checks: {}, status: 'running' };
  const request = (route, { sub = fixture.userId, signed = true, body, anonymous = false } = {}) => fetch(new URL(route, origin), {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(420000),
    headers: { ...(anonymous ? {} : { Authorization: `Bearer ${token(sub, signed)}` }), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error',
  });
  try {
    const health = await (await request('/health', { anonymous: true })).json();
    assert.equal(health.database.driver, 'postgres');
    assert.equal(health.runtime.mode, 'cloud');
    report.health = health;
    const turnsPath = `/v1/interview/sessions/${fixture.sessionId}/turns`;
    const body = process.argv.includes('--resume') ? { submission_id: fixture.submissionId, runtime: 'native-api', model: 'client-override' }
      : { question_id: fixture.questionId, answer: fixture.answer, ...(fixture.submissionId ? { submission_id: fixture.submissionId } : {}), runtime: 'native-api', model: 'client-override' };
    assert.equal((await request(turnsPath, { anonymous: true, body })).status, 401);
    assert.equal((await request(turnsPath, { signed: false, body })).status, 401);
    assert.equal((await request(turnsPath, { sub: fixture.strangerId, body })).status, 403);
    assert.equal((await request('/v1/users/upsert', { anonymous: true, body: { id: fixture.userId } })).status, 401);
    assert.equal((await request('/v1/users/upsert', { sub: fixture.strangerId, body: { id: fixture.userId } })).status, 403);
    report.checks.signedIdentityAndOwnerEnforced = true;
    console.log(JSON.stringify({ testId: fixture.testId, phase: 'cloud_interview_sse' }));
    const response = await request(`${turnsPath}/stream`, { body });
    assert.equal(response.status, 200);
    const raw = await response.text();
    const frames = raw.split('\n\n').map((frame) => {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return event && data ? { event, data: JSON.parse(data) } : null;
    }).filter(Boolean);
    report.phases = frames.filter((f) => !['token', 'result'].includes(f.event));
    const result = frames.find((frame) => frame.event === 'result')?.data;
    if (!result) throw Object.assign(new Error('Cloud interview route did not return a result'), { details: frames.find((frame) => frame.event === 'error')?.data });
    assert.equal(result.agent_runtime.id, 'codex');
    assert.equal(result.handled_as, 'answer');
    assert.equal(result.standard_answer, '');
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
    const content = frames.filter((frame) => frame.event === 'token');
    assert.equal(content.length, 1);
    assert.equal(content[0].data.textChunk, result.evaluation_text);
    const turns = await (await request(turnsPath)).json();
    assert.equal(turns.items.length, 1);
    assert.equal(turns.items[0].score, result.score);
    const questions = await (await request(`/v1/interview/sessions/${fixture.sessionId}/questions`)).json();
    assert.equal(questions.items.find((q) => q.id === fixture.questionId).status, 'answered');
    assert.equal(questions.items.find((q) => q.id === fixture.nextId).status, 'asked');
    if (fixture.submissionId) {
      const saved = turns.submissions.find((item) => item.id === fixture.submissionId);
      assert.equal(saved.answer, fixture.answer);
      assert.equal(saved.result.evaluation_text, result.evaluation_text);
      const replay = await (await request(turnsPath, { body: { submission_id: fixture.submissionId } })).json();
      assert.equal(replay.replayed, true);
      assert.equal(replay.turn_id, result.turn_id);
      report.checks.savedSubmissionReplay = true;
      report.checks.fullAnswerAndResultRestored = true;
      report.checks.resumeWithoutAnswer = process.argv.includes('--resume');
    }
    const duplicate = await request(turnsPath, { body: { question_id: fixture.questionId, answer: fixture.answer } });
    assert.ok([400, 409].includes(duplicate.status));
    assert.equal((await (await request(turnsPath)).json()).items.length, 1);
    report.result = result;
    Object.assign(report.checks, { publicHttpsSse: true, postgresScoreReadable: true, questionAdvanced: true,
      duplicateRejected: true, clientCannotSelectRuntime: true, validatedContentOnly: true, referenceAnswerWithheld: true });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = { code: error.code || 'cloud_smoke_failed', message: error.message, details: error.details };
    process.exitCode = 1;
  } finally {
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ testId: report.testId, status: report.status, score: report.result?.score, checks: report.checks, error: report.error, report: reportPath }));
  }
}
main().catch(() => { console.error('Cloud smoke preflight failed; check staging URL, fixture and local signing key paths.'); process.exitCode = 1; });
