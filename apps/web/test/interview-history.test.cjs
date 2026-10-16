const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const source = path.resolve(__dirname, '../components/interview-session/copy.ts');
const compiled = new Module(source, module);
compiled._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, source);
const { restoreServerHistory, mergeHistoryRows } = compiled.exports;
const item = { id: 'turn-1', session_id: 'session', turn_index: 1, question: '题目', answer: '回答', score: 80, created_at: '2026-10-12T01:00:00Z' };
const submission = { id: 'submission-1', question: item.question, answer: item.answer, created_at: item.created_at, result: { session_id: 'session', turn_id: item.id, turn_index: 1, score: 80, evaluation_text: '完整评价和证据说明' } };
test('server restores full scores and non-scoring dialogue without cache', () => {
  const skip = { ...submission, id: 'skip', answer: '跳过', created_at: '2026-10-12T02:00:00Z', result: { ...submission.result, turn_id: null, handled_as: 'skip', evaluation_text: '', reply_text: '已跳过此题' } };
  const history = restoreServerHistory({ items: [item], submissions: [submission, skip] });
  assert.equal(history.turns.length, 1);
  assert.equal(history.turns[0].evaluation_text, '完整评价和证据说明');
  const rows = mergeHistoryRows([], history.events);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].content, '完整评价和证据说明');
  assert.equal(rows[3].content, '已跳过此题');
  assert.deepEqual(mergeHistoryRows(rows, history.events), rows);
});
test('server reconciliation retains richer old cached evaluations and clarification', () => {
  const previous = [
    { id: 'clarify', kind: 'answer', role: 'user', content: '请解释题意' },
    { id: 'reply', kind: 'evaluation', role: 'assistant', content: '题目说明' },
    { id: 'old-answer', kind: 'answer', role: 'user', content: '回答' },
    { id: 'old-eval', kind: 'evaluation', role: 'assistant', content: '缓存中的完整评价' },
  ];
  const history = restoreServerHistory({ items: [item] });
  const rows = mergeHistoryRows(previous, history.events);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].content, '题目说明');
  assert.equal(rows[3].content, '缓存中的完整评价');
});
test('a committed response lost before receipt replaces its pending placeholder once', () => {
  const previous = [
    { id: 'submission-answer-submission-1', kind: 'answer', role: 'user', content: '回答' },
    { id: 'submission-evaluation-submission-1', kind: 'evaluation', role: 'assistant', content: '正在评分' },
  ];
  const history = restoreServerHistory({ items: [item], submissions: [submission] });
  const rows = mergeHistoryRows(previous, history.events);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].content, '完整评价和证据说明');
  assert.deepEqual(mergeHistoryRows(rows, history.events), rows);
});
test('equal text in different submissions never overwrites an in-flight response', () => {
  const previous = [
    { id: 'submission-answer-new', kind: 'answer', role: 'user', content: '回答' },
    { id: 'submission-evaluation-new', kind: 'evaluation', role: 'assistant', content: '正在评分' },
  ];
  const history = restoreServerHistory({ items: [item], submissions: [submission] });
  const rows = mergeHistoryRows(previous, history.events);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(0, 2), previous);
});
