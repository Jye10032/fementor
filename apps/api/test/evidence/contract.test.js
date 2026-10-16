const test = require('node:test');
const assert = require('node:assert/strict');
const cases = require('../fixtures/evidence/cases.json');
const { buildInput, validateEvidence, buildMessages, VERSION } = require('../../src/interview/evidence/contract');
function fixture(example = cases[0]) {
  const input = buildInput({ id: 't1', question_id: 'q1', question: example.question, answer: example.answer }, { expected_points: [] });
  const result = { version: VERSION, intent: example.intent || 'answer',
    observations: example.intent ? [] : [{ dimension: example.dimension, assessment: example.assessment,
      claim: example.must, basis: example.basis || 'answer_demonstration',
      evidence: [{ turn_id: 't1', question_id: 'q1', quote: example.answer }] }],
    uncertainties: [], suggestion: { purpose: example.allowed[0], direction: 'stay', reason: '仅建议，不推进状态' } };
  return { input, result };
}
for (const example of cases) test(`annotated contract fixture: ${example.id}`, () => {
  const { input, result } = fixture(example);
  assert.equal(validateEvidence(result, input), result);
  assert.equal(input.assistance, 'unknown');
  assert.equal('score' in result, false);
});
test('rejects fabricated quotes, foreign turn/question, extra score and unsupported verification', () => {
  for (const mutate of [r => r.observations[0].evidence[0].quote = 'not in answer',
    r => r.observations[0].evidence[0].turn_id = 'foreign', r => r.observations[0].evidence[0].question_id = 'foreign',
    r => r.total_score = 100, r => r.observations[0].basis = 'tool_verified',
    r => r.observations[0].basis = 'hypothesis', r => r.intent = 'skip']) {
    const { input, result } = fixture(); mutate(result); assert.throws(() => validateEvidence(result, input));
  }
});
test('allows empty observations and keeps suggestions advisory without checklist', () => {
  const { input, result } = fixture(); result.observations = [];
  validateEvidence(result, input);
  assert.match(buildMessages(input)[0].content, /no coverage checklist/);
});
module.exports = { fixture };
