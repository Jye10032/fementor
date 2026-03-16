const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const DATA_ROOT = path.resolve(__dirname, '../../../data');
const USER_DOC_ROOT = path.join(DATA_ROOT, 'user_docs');
const MEMORY_ROOT = path.join(DATA_ROOT, 'memory');
const SIRCHMUNK_BIN = process.env.SIRCHMUNK_BIN || 'sirchmunk';
const SIRCHMUNK_MODE = process.env.SIRCHMUNK_MODE || 'FAST';
const SIRCHMUNK_WORK_PATH = process.env.SIRCHMUNK_WORK_PATH || path.join(DATA_ROOT, '.sirchmunk');

const sanitizeUserId = (input) => String(input || '').replace(/[^a-zA-Z0-9_-]/g, '_');

const getUserBaseDir = (userId) => path.join(USER_DOC_ROOT, sanitizeUserId(userId));

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const ensureUserDocDir = (userId) => ensureDir(getUserBaseDir(userId));
const ensureUserProfileDir = (userId) => ensureDir(path.join(getUserBaseDir(userId), 'profile'));
const ensureUserKnowledgeDir = (userId) => ensureDir(path.join(getUserBaseDir(userId), 'knowledge'));

const summarizeResume = (resumeText) => {
  const lines = String(resumeText || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const skillHints = ['react', 'vue', 'angular', 'typescript', 'javascript', 'node', 'zustand', 'redux'];
  const lowered = lines.join(' ').toLowerCase();
  const skills = skillHints.filter((k) => lowered.includes(k)).slice(0, 6);
  const yearsMatch = lowered.match(/(\d+)\s*年/);
  const years = yearsMatch ? `${yearsMatch[1]}年经验` : '经验年限未明确';

  const topLines = lines.slice(0, 3).join('；').slice(0, 140);
  return `候选人${years}，核心技能：${skills.join('、') || '待补充'}。简历摘要：${topLines || '待补充'}`;
};

const extractResumeTextFromBinary = async ({ filename, fileBase64, buffer }) => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const fileBuffer = buffer && Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(String(fileBase64 || ''), 'base64');

  if (!fileBuffer.length) {
    throw new Error('empty file content');
  }

  if (ext === '.pdf') {
    const parsed = await pdfParse(fileBuffer);
    return String(parsed?.text || '').trim();
  }

  if (ext === '.docx') {
    const parsed = await mammoth.extractRawText({ buffer: fileBuffer });
    return String(parsed?.value || '').trim();
  }

  throw new Error(`unsupported binary resume extension: ${ext || 'unknown'}`);
};

const saveUserDoc = ({ userId, content, filename, prefix, category = 'knowledge' }) => {
  const dir = category === 'profile' ? ensureUserProfileDir(userId) : ensureUserKnowledgeDir(userId);
  const safePrefix = String(prefix || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_');
  const rawName = String(filename || '').trim() || `${safePrefix}-${Date.now()}.md`;
  const normalizedName = rawName.replace(/[^\w.\-]/g, '_');
  const targetName = normalizedName.startsWith(`${safePrefix}-`) ? normalizedName : `${safePrefix}-${normalizedName}`;
  const target = path.join(dir, targetName);
  fs.writeFileSync(target, String(content || ''), 'utf8');
  return target;
};

const saveResumeDoc = ({ userId, resumeText, filename }) =>
  saveUserDoc({ userId, content: resumeText, filename, prefix: 'resume', category: 'profile' });

const saveJdDoc = ({ userId, jdText, filename }) =>
  saveUserDoc({ userId, content: jdText, filename, prefix: 'jd', category: 'profile' });

const collectDocEntries = (dir, prefix = '') => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !prefix || entry.name.startsWith(`${prefix}-`))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        path: fullPath,
        size: stat.size,
        updated_at: stat.mtime.toISOString(),
      };
    });
};

const listUserDocs = (userId, options = {}) => {
  const dir = ensureUserKnowledgeDir(userId);
  const legacyDir = ensureUserDocDir(userId);
  const prefix = String(options.prefix || '').trim();
  return [
    ...collectDocEntries(dir, prefix),
    ...collectDocEntries(legacyDir, prefix).filter((item) => !/^(resume|jd)-/i.test(item.name)),
  ]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

const listProfileDocs = (userId, prefix = '') => {
  const profileDir = ensureUserProfileDir(userId);
  const legacyDir = ensureUserDocDir(userId);
  return [
    ...collectDocEntries(profileDir, prefix),
    ...collectDocEntries(legacyDir, prefix),
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

const listResumeDocs = (userId) => listProfileDocs(userId, 'resume');
const listJdDocs = (userId) => listProfileDocs(userId, 'jd');

const readUserDoc = ({ userId, fileName, prefix, category = 'knowledge' }) => {
  const primaryDir = category === 'profile' ? ensureUserProfileDir(userId) : ensureUserKnowledgeDir(userId);
  const legacyDir = ensureUserDocDir(userId);
  const safeName = String(fileName || '').trim().replace(/[^\w.\-]/g, '_');
  const candidates = [];

  if (safeName) {
    candidates.push(safeName);
    if (prefix && !safeName.startsWith(`${prefix}-`)) {
      candidates.push(`${prefix}-${safeName}`);
    }
  }

  const fullPath = candidates
    .map((name) => [path.join(primaryDir, name), path.join(legacyDir, name)])
    .flat()
    .find((candidate) => fs.existsSync(candidate));
  if (!fullPath) return null;

  return {
    name: path.basename(fullPath),
    path: fullPath,
    content: fs.readFileSync(fullPath, 'utf8'),
  };
};

const readResumeDoc = ({ userId, fileName }) => readUserDoc({ userId, fileName, prefix: 'resume', category: 'profile' });
const readJdDoc = ({ userId, fileName }) => readUserDoc({ userId, fileName, prefix: 'jd', category: 'profile' });

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

const parseRgLine = (line) => {
  const m = line.match(/^(.+?):(\d+):(.*)$/);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), text: m[3] };
};

const localSearch = ({ userId, keywords, limit = 20, paths = [] }) => {
  const dir = ensureUserDocDir(userId);
  const targets = (Array.isArray(paths) && paths.length > 0 ? paths : [dir])
    .map((item) => String(item || '').trim())
    .filter((item) => item && fs.existsSync(item));
  const terms = (Array.isArray(keywords) ? keywords : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  if (terms.length === 0 || targets.length === 0) return [];

  const hits = new Map();

  for (const term of terms) {
    const proc = spawnSync(
      'rg',
      ['-n', '--no-heading', '--max-count', '3', '-F', term, ...targets],
      { encoding: 'utf8' },
    );

    if (proc.error) {
      continue;
    }
    const out = String(proc.stdout || '').trim();
    if (!out) continue;

    for (const raw of out.split('\n')) {
      const row = parseRgLine(raw);
      if (!row) continue;
      const key = `${row.file}:${row.line}`;
      if (!hits.has(key)) {
        hits.set(key, { ...row, keywords: [term] });
      } else {
        const exist = hits.get(key);
        if (!exist.keywords.includes(term)) exist.keywords.push(term);
      }
    }
  }

  return Array.from(hits.values())
    .sort((a, b) => b.keywords.length - a.keywords.length)
    .slice(0, limit);
};

const hasCommand = (name) => {
  if (String(name || '').includes(path.sep)) {
    try {
      fs.accessSync(name, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const r = spawnSync('which', [name], {
    encoding: 'utf8',
  });
  return r.status === 0 && String(r.stdout || '').trim().length > 0;
};

const stripAnsi = (input) => String(input || '').replace(/\u001b\[[0-9;]*m/g, '');
const normalizeInlineWhitespace = (input) => String(input || '').replace(/\s+/g, ' ').trim();

const SIRCHMUNK_LOG_PATTERNS = [
  /downloading model/i,
  /loaded .*knowledge clusters/i,
  /searching:/i,
  /^\s*mode:/i,
  /^\s*paths:/i,
  /to directory:/i,
  /from cache/i,
  /huggingface/i,
  /modelscope/i,
];

const isSirchmunkLogLine = (line) =>
  SIRCHMUNK_LOG_PATTERNS.some((pattern) => pattern.test(String(line || '').trim()));

const extractBracketedJsonCandidates = (raw) => {
  const text = stripAnsi(raw);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isSirchmunkLogLine(line));

  if (lines.length === 0) return [];

  const cleaned = lines.join('\n').trim();
  if (!cleaned) return [];

  const candidates = [];
  let start = -1;
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (char === '{' || char === '[') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === '}' || char === ']') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(cleaned.slice(start, index + 1).trim());
        start = -1;
      }
    }
  }

  return candidates;
};

const extractJsonCandidate = (raw) => {
  const candidates = extractBracketedJsonCandidates(raw);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      JSON.parse(candidates[index]);
      return candidates[index];
    } catch {}
  }
  return '';
};

const pickSirchmunkArray = (parsed) => {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.data)) return parsed.data;
  if (parsed && typeof parsed === 'object' && parsed.cluster && typeof parsed.cluster === 'object') {
    return [parsed.cluster];
  }
  return [];
};

const isNoResultText = (text) => /no relevant content found|no results found/i.test(String(text || '').trim());

const flattenSirchmunkCluster = (cluster, index) => {
  const evidences = Array.isArray(cluster?.evidences) ? cluster.evidences : [];
  const snippetItems = evidences.flatMap((evidence) => {
    const snippets = Array.isArray(evidence?.snippets) ? evidence.snippets : [];
    return snippets.map((snippet, snippetIndex) => ({
      source: 'sirchmunk',
      source_uri: String(evidence?.file_or_url || cluster?.path || cluster?.file || `sirchmunk://result/${index + 1}`),
      text: normalizeInlineWhitespace(snippet?.snippet || ''),
      score: typeof snippet?.score === 'number' ? snippet.score : null,
      reasoning: normalizeInlineWhitespace(snippet?.reasoning || ''),
      summary: normalizeInlineWhitespace(evidence?.summary || cluster?.content || cluster?.description?.[0] || ''),
      rank: snippetIndex,
    }));
  }).filter((item) => item.text && !isNoResultText(item.text));

  if (snippetItems.length > 0) {
    return snippetItems;
  }

  const fallbackText = normalizeInlineWhitespace(cluster?.text || cluster?.snippet || cluster?.content || '');
  if (!fallbackText || isNoResultText(fallbackText)) return [];

  return [{
    source: 'sirchmunk',
    source_uri: String(cluster?.path || cluster?.file || cluster?.source_uri || `sirchmunk://result/${index + 1}`),
    text: fallbackText,
    score: typeof cluster?.score === 'number' ? cluster.score : null,
    reasoning: '',
    summary: normalizeInlineWhitespace(cluster?.description?.[0] || ''),
    rank: 0,
  }];
};

const normalizeSirchmunkItems = (raw, limit) => {
  const jsonText = extractJsonCandidate(raw);
  if (!jsonText) return [];

  try {
    const parsed = JSON.parse(jsonText);
    const array = pickSirchmunkArray(parsed);
    return array
      .flatMap((item, index) => flattenSirchmunkCluster(item, index))
      .filter((item) => item.text && !isSirchmunkLogLine(item.text))
      .sort((a, b) => {
        const scoreDiff = (b.score ?? -1) - (a.score ?? -1);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.rank ?? 0) - (b.rank ?? 0);
      })
      .slice(0, limit)
      .map((item) => ({
        source: 'sirchmunk',
        source_uri: item.source_uri,
        text: item.text.slice(0, 1200),
        score: item.score,
        reasoning: item.reasoning,
        summary: item.summary.slice(0, 400),
      }));
  } catch {
    // 只接受结构化 JSON 输出，避免把 CLI 运行日志误判为证据。
    return [];
  }
};

const ANSWER_KEYWORD_STOPWORDS = new Set([
  '这个', '那个', '就是', '然后', '还有', '以及', '我们', '你们', '他们', '自己',
  '因为', '所以', '但是', '如果', '觉得', '进行', '实现', '使用', '通过', '主要',
  '比较', '相关', '一些', '一个', '一种', '时候', '方面', '问题', '项目', '回答',
  '优化', '方案', '处理', '可以', '已经', '需要', '没有', '当前', '这里', '里面',
  'the', 'and', 'with', 'from', 'that', 'this', 'have', 'has', 'into', 'about',
]);

const isUsefulAnswerKeyword = (term) => {
  const value = String(term || '').trim();
  if (!value || value.length < 2) return false;
  if (ANSWER_KEYWORD_STOPWORDS.has(value.toLowerCase())) return false;
  if (/^\d+$/.test(value)) return false;
  return /[a-zA-Z@#./:_-]/.test(value) || /[\u4e00-\u9fa5]/.test(value);
};

const buildAnswerKeywordSummary = (answer) => {
  const answerText = String(answer || '').trim();
  if (!answerText) return '';

  const normalizedText = answerText
    .replace(/\r/g, '\n')
    .replace(/[（(]\d+[）)]/g, ' ')
    .replace(/[“”"'`]/g, ' ')
    .replace(/\s+/g, ' ');

  const phraseMatches = normalizedText.match(/[A-Za-z][A-Za-z0-9@#./:_-]{1,40}|[\u4e00-\u9fa5]{2,12}/g) || [];
  const lineSegments = answerText
    .split(/\r?\n|[。！？；;]+/)
    .map((item) => normalizeInlineWhitespace(item))
    .filter(Boolean)
    .slice(0, 8);

  const prioritizedPhrases = lineSegments
    .filter((segment) => segment.length >= 4 && segment.length <= 36)
    .flatMap((segment) => {
      const pieces = segment
        .split(/[，,、]/)
        .map((item) => normalizeInlineWhitespace(item))
        .filter(Boolean)
        .filter((item) => item.length >= 2 && item.length <= 24);
      return pieces.length > 0 ? pieces : [segment];
    });

  const ordered = [];
  const seen = new Set();
  for (const term of [...prioritizedPhrases, ...phraseMatches]) {
    const normalized = normalizeInlineWhitespace(term)
      .replace(/^[\-:：]+|[\-:：]+$/g, '')
      .trim();
    if (!isUsefulAnswerKeyword(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(normalized);
    if (ordered.length >= 14) break;
  }

  return normalizeInlineWhitespace(ordered.join(' '));
};

const sirchmunkSearch = ({ query, paths, limit = 5, mode = SIRCHMUNK_MODE }) =>
  new Promise((resolve) => {
  if (!hasCommand(SIRCHMUNK_BIN)) {
    resolve({
      available: false,
      items: [],
      message: `${SIRCHMUNK_BIN} command not found`,
    });
    return;
  }

  const validPaths = (paths || []).filter((item) => fs.existsSync(item));
  if (validPaths.length === 0) {
    resolve({
      available: true,
      items: [],
      message: 'no valid search paths for sirchmunk',
    });
    return;
  }

  fs.mkdirSync(SIRCHMUNK_WORK_PATH, { recursive: true });

  const env = {
    ...process.env,
    SIRCHMUNK_WORK_PATH,
    LLM_API_KEY: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    LLM_BASE_URL: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    LLM_MODEL_NAME: process.env.LLM_MODEL_NAME || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };

  const effectiveMode = String(mode || SIRCHMUNK_MODE || 'FAST').trim().toUpperCase() || 'FAST';
  const args = ['search', query, ...validPaths, '--mode', effectiveMode, '--output', 'json'];
  const child = spawn(SIRCHMUNK_BIN, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  let finished = false;
  let timeoutId = null;

  const finalize = (payload) => {
    if (finished) return;
    finished = true;
    if (timeoutId) clearTimeout(timeoutId);
    resolve(payload);
  };

  timeoutId = setTimeout(() => {
    child.kill('SIGTERM');
    finalize({
      available: true,
      items: [],
      message: 'sirchmunk timed out',
    });
  }, 20_000);

  child.stdout.on('data', (chunk) => {
    const text = String(chunk || '');
    stdout += text;
    console.log('[sirchmunk.stdout.chunk]', text);
  });

  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '');
    stderr += text;
    console.log('[sirchmunk.stderr.chunk]', text);
  });

  child.on('error', (error) => {
    console.log('[sirchmunk.raw]', {
      bin: SIRCHMUNK_BIN,
      args,
      mode: effectiveMode,
      status: null,
      signal: null,
      error: error?.message || 'unknown error',
      stdout,
      stderr,
    });
    finalize({
      available: true,
      items: [],
      message: String(error?.message || 'sirchmunk failed'),
    });
  });

  child.on('close', (code, signal) => {
    console.log('[sirchmunk.raw]', {
      bin: SIRCHMUNK_BIN,
      args,
      mode: effectiveMode,
      status: code,
      signal: signal || null,
      error: null,
      stdout,
      stderr,
    });

    if (code !== 0) {
      finalize({
        available: true,
        items: [],
        message: String(stderr || 'sirchmunk failed'),
      });
      return;
    }

    const items = normalizeSirchmunkItems(stdout, limit);
    if (items.length === 0) {
      finalize({ available: true, items: [], message: 'empty sirchmunk output' });
      return;
    }

    finalize({
      available: true,
      items,
      message: 'ok',
    });
  });
});

const getSirchmunkStatus = () => ({
  enabled: hasCommand(SIRCHMUNK_BIN),
  bin: SIRCHMUNK_BIN,
  mode: SIRCHMUNK_MODE,
  work_path: SIRCHMUNK_WORK_PATH,
});

const buildQueryPlan = ({ question, resumeSummary = '', plannedKeywords = [] }) => {
  const normalized = String(question || '').trim();
  const rawTerms = normalized
    .split(/[\s,，。！？?!.;；:：()（）]+/)
    .filter(Boolean);
  const resumeTerms = String(resumeSummary || '')
    .split(/[\s,，。！？?!.;；:：()（）]+/)
    .filter(Boolean)
    .slice(0, 8);
  const plannerTerms = (Array.isArray(plannedKeywords) ? plannedKeywords : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12);

  const uniq = Array.from(new Set([...plannerTerms, ...rawTerms, ...resumeTerms]));

  return {
    rewritten_query: normalized,
    keyword_groups: {
      entity_terms: uniq.slice(0, 4),
      intent_terms: uniq.slice(4, 6),
      evidence_terms: uniq.slice(6, 10),
    },
    next_action: 'sirchmunk_search_first',
  };
};

// 统一把本地 grep 命中转成上层可消费的证据结构，避免业务层感知底层实现细节。
const mapLocalHitsToEvidence = (hits) =>
  (hits || []).map((hit) => ({
    source_type: 'local_doc',
    source_uri: `${hit.file}:${hit.line}`,
    quote: hit.text,
    confidence: Math.min(0.95, 0.45 + hit.keywords.length * 0.1),
  }));

// sirchmunk 的原始输出并不稳定，这里收敛成和本地检索一致的证据协议。
const mapSirchmunkItemsToEvidence = (items) =>
  (items || []).map((item, index) => ({
    source_type: 'sirchmunk',
    source_uri: item.source_uri || `sirchmunk://result/${index + 1}`,
    quote: String(item.text || '').slice(0, 300),
    confidence: typeof item.score === 'number'
      ? Math.max(0.5, Math.min(0.95, item.score / 10))
      : 0.7,
    reasoning: String(item.reasoning || '').slice(0, 180),
    summary: String(item.summary || '').slice(0, 220),
  }));

// 统一检索适配层：上层只依赖这一份结果，不依赖 rg / sirchmunk / web 的内部概念。
const retrieveEvidence = async ({
  userId,
  question,
  answer = '',
  resumeSummary = '',
  limit = 6,
  strategy = 'auto',
  enableWebFallback = false,
  questionType = 'basic',
  paths = [],
  sirchmunkMode = null,
  plannedQuery = '',
  plannedKeywords = [],
  retrievalGoal = 'find_evidence',
}) => {
  const fullQueryText = `${String(question || '').trim()} ${String(answer || '').trim()}`.trim();
  const answerKeywordSummary = buildAnswerKeywordSummary(answer);
  const normalizedPlannedQuery = normalizeInlineWhitespace(plannedQuery);
  const plan = buildQueryPlan({
    question: normalizedPlannedQuery || fullQueryText,
    resumeSummary,
    plannedKeywords,
  });
  const sirchmunkQuery = normalizeInlineWhitespace([
    normalizedPlannedQuery || String(question || '').trim(),
    ...(Array.isArray(plannedKeywords) ? plannedKeywords : []).slice(0, 8),
    answerKeywordSummary,
  ].filter(Boolean).join(' '));
  const validPaths = (Array.isArray(paths) && paths.length > 0 ? paths : [ensureUserKnowledgeDir(userId)])
    .map((item) => String(item || '').trim())
    .filter((item) => item && fs.existsSync(item));
  const effectiveSirchmunkMode = String(sirchmunkMode || SIRCHMUNK_MODE || 'FAST').trim().toUpperCase() || 'FAST';
  console.log('[retrieval.query]', {
    user_id: userId,
    strategy,
    question_type: questionType,
    retrieval_goal: retrievalGoal,
    question: String(question || ''),
    answer: String(answer || ''),
    full_query: fullQueryText,
    planned_query: normalizedPlannedQuery,
    planned_keywords: (Array.isArray(plannedKeywords) ? plannedKeywords : []).slice(0, 12),
    rewritten_query: plan.rewritten_query,
    answer_keyword_summary: answerKeywordSummary,
    sirchmunk_query: sirchmunkQuery,
    paths: validPaths,
    sirchmunk_mode: effectiveSirchmunkMode,
  });
  const keywordPool = [
    ...plan.keyword_groups.entity_terms,
    ...plan.keyword_groups.intent_terms,
    ...plan.keyword_groups.evidence_terms,
  ].filter(Boolean);
  const shouldUseLocal = strategy === 'local';
  const localHits = shouldUseLocal
    ? localSearch({
      userId,
      keywords: keywordPool,
      limit,
      paths: validPaths,
    })
    : [];
  const localEvidence = mapLocalHitsToEvidence(localHits);

  let sirchmunk = { available: false, items: [], message: 'not_requested' };
  // 默认主路径改为 sirchmunk，本地 rg 仅保留显式 strategy=local 的调试入口。
  const shouldTrySirchmunk = strategy === 'sirchmunk' || strategy === 'auto';
  if (shouldTrySirchmunk) {
    sirchmunk = await sirchmunkSearch({
      query: sirchmunkQuery || plan.rewritten_query,
      paths: validPaths,
      limit: Math.min(3, limit),
      mode: effectiveSirchmunkMode,
    });
  }
  const sirchmunkEvidence = mapSirchmunkItemsToEvidence(sirchmunk.items);

  // needFallback 的语义不是“一个结果都没有才算失败”，而是“当前证据层无法形成有效证据”。
  // 这里先用最保守的空结果规则，后面可以继续升级成按证据质量阈值触发。
  const needFallback = localEvidence.length === 0 && sirchmunkEvidence.length === 0;
  const webFallback = webSearchFallback({
    enabled: enableWebFallback,
    reason: needFallback ? 'local_evidence_insufficient' : 'not_needed',
    query: plan.rewritten_query,
  });
  const webEvidence = (webFallback.items || []).map((item) => ({
    source_type: item.source_type || 'web',
    source_uri: item.source_uri || '',
    quote: item.quote || '',
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
  }));

  // strategy 表示本次最终主要依赖哪一层检索，便于上层做评估和对比实验。
  const primaryStrategy = sirchmunkEvidence.length > 0
    ? 'sirchmunk'
    : localEvidence.length > 0
      ? 'local'
      : webEvidence.length > 0
        ? 'web'
        : 'none';

  return {
    strategy: primaryStrategy,
    plan,
    local: {
      items: localHits,
      evidence_refs: localEvidence,
    },
    sirchmunk,
    web_fallback: webFallback,
    evidence_refs: [...localEvidence, ...sirchmunkEvidence, ...webEvidence],
    need_fallback: needFallback,
  };
};

const webSearchFallback = ({ enabled, reason, query }) => {
  if (!enabled) {
    return { enabled: false, reason, items: [] };
  }
  return {
    enabled: true,
    reason,
    items: [
      {
        source_type: 'web',
        source_uri: 'placeholder://websearch',
        quote: `WebSearch placeholder for query: ${query}`,
      },
    ],
  };
};

module.exports = {
  DATA_ROOT,
  summarizeResume,
  extractResumeTextFromBinary,
  saveResumeDoc,
  saveJdDoc,
  listUserDocs,
  listResumeDocs,
  listJdDocs,
  readUserDoc,
  readResumeDoc,
  readJdDoc,
  appendMemoryEntry,
  localSearch,
  buildQueryPlan,
  retrieveEvidence,
  sirchmunkSearch,
  getSirchmunkStatus,
  webSearchFallback,
};
