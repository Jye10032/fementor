const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBudgetedTurnContext } = require('../../src/interview/turn-context');
const { buildEvaluationBundle } = require('../../src/agent-runtime/codex/evaluation');
const { getContextPolicy, countTokens } = require('../../src/interview/token-budget');

test('long answers and required material survive the complete scoring bundle without character slicing', () => {
  const input = { question: '完整问题'.repeat(120), answer: '中文回答'.repeat(1100) + 'ANSWER-END',
    resumeSummary: '简历材料'.repeat(300) + 'RESUME-END', jobDescription: '岗位要求'.repeat(600) + 'JD-END' };
  const turns = Array.from({ length: 8 }, (_, i) => ({ turn_index: i + 1, question: `Q${i}`, answer: '历史'.repeat(200), score: 80 }));
  const context = buildBudgetedTurnContext({ input, turns, codex: true });
  const payload = JSON.parse(buildEvaluationBundle({ ...input, interviewContext: context.contextText }).input);
  assert.equal(payload.answer, input.answer);
  assert.equal(payload.question, input.question);
  assert.equal(payload.resume_summary, input.resumeSummary);
  assert.equal(payload.job_description, input.jobDescription);
  assert.equal(context.metadata.full_turns, 8);
  for (const turn of turns) assert.ok(context.contextText.includes(JSON.stringify(turn.answer)));
  assert.ok(context.metadata.estimated_input_tokens <= context.metadata.input_budget);
});

test('oversized history selects whole recent/relevant turns and labeled summaries within the budget', () => {
  const input = { question: 'React key', answer: 'Stable identity' };
  const baseline = buildBudgetedTurnContext({ input, turns: [], codex: true });
  const policy = { ...getContextPolicy(), inputTokens: baseline.metadata.estimated_input_tokens + 1200 };
  const turns = Array.from({ length: 30 }, (_, i) => ({ turn_index: i + 1,
    question: i === 0 ? 'React key' : `Question ${i}`, answer: `ANSWER-${i} ` + '解释状态'.repeat(100), score: 80, weaknesses: [] }));
  const context = buildBudgetedTurnContext({ input, turns, codex: true, policy });
  assert.equal(context.metadata.compacted, true);
  assert.ok(context.metadata.estimated_input_tokens <= policy.inputTokens);
  assert.ok(context.contextText.includes('非完整原文'));
  assert.ok(context.contextText.includes('ANSWER-29'));
  assert.ok(context.metadata.full_turns < turns.length);
});

test('mandatory input exceeding budget is rejected rather than silently truncated', () => {
  const input = { question: 'Q', answer: '重要材料'.repeat(4000) };
  assert.throws(() => buildBudgetedTurnContext({ input, turns: [], codex: true,
    policy: { ...getContextPolicy(), inputTokens: 2000 } }), { code: 'context_budget_exceeded', statusCode: 413 });
  assert.ok(countTokens('<|endoftext|>😀中文', 'o200k_base') > 0);
  assert.throws(() => getContextPolicy({ INTERVIEW_CONTEXT_WINDOW_TOKENS: '256k' }));
});
