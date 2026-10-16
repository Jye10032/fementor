#!/usr/bin/env node
// Synthetic material only. Does not load business storage or write interview state.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const cases = require('../test/fixtures/evidence/cases.json');
const { buildUnifiedTurnMessages } = require('../src/interview/llm-service');
const { buildInput, buildMessages, validateEvidence } = require('../src/interview/evidence/contract');
const { chatCompletion, extractJsonObject, getResolvedLlmConfig } = require('../src/llm');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main() {
  const live = process.argv.includes('--live');
  const caseArg = process.argv.indexOf('--case');
  const selectedCases = caseArg >= 0 ? cases.filter(item => item.id === process.argv[caseArg + 1]) : cases;
  if (!selectedCases.length) throw new Error('unknown case');
  const outputArg = process.argv.indexOf('--output');
  if (live && outputArg < 0) throw new Error('--output is required for live evaluation');
  const report = { generated_at: new Date().toISOString(), model: getResolvedLlmConfig().model,
    mode: live ? 'synthetic-live' : 'prompt-inspection', cases_hash: hash(cases),
    annotation_status: 'agent-authored proposed expectations; not human-certified',
    scope: 'prompt/model comparison only; no business DB, no hiring or production validation', results: [] };
  for (const example of selectedCases) {
    const input = buildInput({ id: `fixture-${example.id}`, question_id: `question-${example.id}`, question: example.question, answer: example.answer }, { expected_points: [] });
    const legacy = buildUnifiedTurnMessages({ question: example.question, answer: example.answer, jobDescription: '', resumeSummary: '', evidenceRefs: [] });
    const evidence = buildMessages(input);
    const outputs = await Promise.allSettled([['legacy', legacy], ['evidence', evidence]].map(async ([version, messages]) => {
      const started = Date.now();
      if (!live) return { version, prompt_hash: hash(messages), fixed_role_fit: messages[0].content.includes('role_fit') };
      const raw = await chatCompletion({ messages, temperature: 0, signal: AbortSignal.timeout(45000) });
      const result = extractJsonObject(raw);
      if (version === 'evidence') validateEvidence(result, input);
      return { version, prompt_hash: hash(messages), elapsed_ms: Date.now() - started, result };
    }));
    report.results.push({ id: example.id, proposed_expectation: { must: example.must, forbidden: example.forbidden, allowed: example.allowed },
      outputs: outputs.map((r,i) => r.status === 'fulfilled' ? r.value : { version: i ? 'evidence' : 'legacy', error: 'model call or contract validation failed', diagnostic: r.reason.statusCode || r.reason.name }) });
    if (outputArg >= 0) fs.writeFileSync(path.resolve(process.argv[outputArg + 1]), JSON.stringify(report, null, 2) + '\n');
    console.log(`${example.id}: ${outputs.map(r => r.status).join(', ')}`);
  }
  if (report.results.some(r => r.outputs.some(o => o.error))) process.exitCode = 1;
}
main().catch(() => { console.error('baseline evaluation failed; inspect configuration without exposing credentials'); process.exitCode = 1; });
