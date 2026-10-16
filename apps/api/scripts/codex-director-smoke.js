// Synthetic-only HTTPS acceptance of the autonomous interview path.
// Usage: node scripts/codex-director-smoke.js <https-api> <fixture.json> <private.pem> <report.json>
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { sign, createPrivateKey, randomUUID } = require('node:crypto');

async function main() {
  const [endpoint, fixturePath, privateKeyPath, reportPath] = process.argv.slice(2);
  const origin = new URL(endpoint);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.hostname, 'codex-staging-api-codex-staging.up.railway.app');
  const { fixture } = JSON.parse(fs.readFileSync(fixturePath));
  assert.match(fixture.userId, /^user_staging_[a-f0-9-]{36}$/);
  const key = createPrivateKey(fs.readFileSync(privateKeyPath));
  const report = { testId: fixture.testId, startedAt: new Date().toISOString(), endpoint: origin.origin,
    syntheticOnly: true, auth: 'staging RSA-signed JWT, not hosted Clerk login', checks: {}, submissions: [], status: 'running' };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const token = (sub) => {
    const now = Math.floor(Date.now() / 1000);
    const value = [{ alg: 'RS256', typ: 'JWT', kid: 'fementor-staging' }, { sub,
      iss: 'https://fementor-staging.invalid', email: `${sub}@example.invalid`,
      name: 'Synthetic director fixture', iat: now, nbf: now - 5, exp: now + 1800 }]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
    return `${value}.${sign('RSA-SHA256', Buffer.from(value), key).toString('base64url')}`;
  };
  const request = (route, body, sub = fixture.userId) => fetch(new URL(route, origin), {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(1200000),
    headers: { Authorization: `Bearer ${token(sub)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const route = `/v1/interview/sessions/${fixture.sessionId}`;
  const read = async (suffix) => { const response = await request(`${route}${suffix}`); assert.equal(response.status, 200); return response.json(); };
  const submit = async (label, questionId, answer) => {
    const submissionId = randomUUID();
    const entry = { label, submissionId, questionId, answer, startedAt: new Date().toISOString() };
    report.submissions.push(entry); save();
    console.log(JSON.stringify({ phase: label, submissionId }));
    const response = await request(`${route}/turns/stream`, {
      submission_id: submissionId, question_id: questionId, answer,
      runtime: 'native-api', model: 'client-override', orchestrator: 'workflow',
    });
    assert.equal(response.status, 200);
    const frames = (await response.text()).split(/\r?\n\r?\n/).flatMap((frame) => {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return event && data ? [{ event, data: JSON.parse(data) }] : [];
    });
    entry.phases = frames.filter((frame) => !['token', 'result'].includes(frame.event));
    const result = frames.find((frame) => frame.event === 'result')?.data;
    assert.ok(result, `No result in ${label}: ${JSON.stringify(frames.find((f) => f.event === 'error')?.data)}`);
    assert.equal(result.submission_id, submissionId);
    assert.equal(result.agent_runtime.id, 'codex');
    assert.equal(result.agent_runtime.profile_id, 'codex-railway-interview-director-v1');
    const tokens = frames.filter((frame) => frame.event === 'token');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].data.textChunk, result.evaluation_text);
    assert.ok(!result.standard_answer);
    entry.result = result; entry.completedAt = new Date().toISOString(); save();
    const replayResponse = await request(`${route}/turns`, { submission_id: submissionId });
    assert.equal(replayResponse.status, 200);
    const replay = await replayResponse.json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.agent_runtime.run_id, result.agent_runtime.run_id);
    assert.deepEqual(replay.agent_decision, result.agent_decision);
    return result;
  };
  try {
    report.health = await (await fetch(new URL('/health', origin), { signal: AbortSignal.timeout(30000) })).json();
    assert.equal(report.health.database.driver, 'postgres');
    assert.equal(report.health.agent_runtime.orchestrator, 'director');
    assert.equal((await request(`${route}/turns`, { question_id: fixture.questionId, answer: '合成数据' }, fixture.strangerId)).status, 403);
    report.checks.ownerEnforced = true;
    const clarified = await submit('clarify', fixture.questionId, '我想先确认题意：这里只讨论 React 中同级列表的 key，还是也要讨论不同父组件之间的 key？这条消息是在询问题意，还不是我的正式回答。');
    assert.equal(clarified.agent_decision.action, 'clarify');
    assert.equal(clarified.handled_as, 'non_answer');
    assert.equal(clarified.next_question.id, fixture.questionId);
    assert.equal((await read('/turns')).items.length, 0);
    report.checks.clarificationKeepsQuestionWithoutScore = true;
    const answered = await submit('evaluate-and-follow-up', fixture.questionId,
      '我认为 key 就是数组下标，用来加快列表渲染。列表顺序变化以后 React 会重新绘制，所以输入框状态不会错位。其他细节我暂时说不清，希望你针对我这段回答的问题继续追问。');
    assert.equal(answered.handled_as, 'answer');
    assert.ok(Number.isInteger(answered.score) && answered.score >= 0 && answered.score <= 100);
    assert.ok(answered.agent_decision.evaluation_ref);
    assert.equal(answered.agent_decision.action, 'follow_up');
    assert.ok(answered.agent_decision.question_ref);
    assert.ok(answered.next_question?.id && answered.next_question.id !== fixture.questionId);
    const turns = await read('/turns');
    assert.equal(turns.items.length, 1);
    assert.equal(turns.items[0].score, answered.score);
    assert.equal(turns.submissions.length, 2);
    report.checks.twoSpecialistsAndAtomicScore = true;
    const finished = await submit('finish', answered.next_question.id, '今天先到这里，请直接结束本场面试，不用再出题，也不需要对这条结束请求评分。');
    assert.equal(finished.agent_decision.action, 'finish');
    assert.equal(finished.session_status, 'completed');
    assert.equal(finished.next_question, null);
    assert.equal((await read('')).status, 'completed');
    const queue = await read('/questions');
    assert.equal(queue.current_question, null);
    assert.ok(queue.items.some((item) => item.id === fixture.nextId && item.status === 'pending'));
    const restored = await read('/turns');
    assert.equal(restored.items.length, 1);
    assert.equal(restored.submissions.length, 3);
    assert.equal(restored.submissions.at(-1).result.session_status, 'completed');
    Object.assign(report.checks, { finishWithoutInventedScores: true, remainingTopicsPreserved: true,
      completedSubmissionReplay: true, restoredDialogue: true, serverRuntimeFixed: true, validatedContentOnly: true });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.error = { code: error.code || 'director_smoke_failed', message: error.message };
    process.exitCode = 1;
  } finally {
    report.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ testId: report.testId, status: report.status, checks: report.checks, error: report.error, report: reportPath }));
  }
}
main().catch(() => { console.error('Director smoke preflight failed; check staging fixture and local signing key paths.'); process.exitCode = 1; });
