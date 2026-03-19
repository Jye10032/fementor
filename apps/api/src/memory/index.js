const fs = require('fs');
const path = require('path');
const { DATA_ROOT, sanitizeUserId } = require('../doc');

const MEMORY_ROOT = path.join(DATA_ROOT, 'memory');

const appendMemoryEntry = ({
  userId,
  question,
  answer,
  score,
  strengths,
  weaknesses,
  evidenceCount,
}) => {
  fs.mkdirSync(MEMORY_ROOT, { recursive: true });
  const safeUserId = sanitizeUserId(userId);
  const file = path.join(MEMORY_ROOT, `user-${safeUserId}.md`);
  const now = new Date().toISOString();
  const content = [
    `\n## ${now}`,
    `- question: ${question}`,
    `- answer_summary: ${String(answer || '').slice(0, 120)}`,
    `- score: ${score}`,
    `- strengths: ${(strengths || []).join(' | ') || '无'}`,
    `- weaknesses: ${(weaknesses || []).join(' | ') || '无'}`,
    `- evidence_refs_count: ${evidenceCount}`,
  ].join('\n');
  fs.appendFileSync(file, content, 'utf8');
  return file;
};

module.exports = {
  MEMORY_ROOT,
  appendMemoryEntry,
};
