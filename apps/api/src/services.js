const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');

const DATA_ROOT = path.resolve(__dirname, '../../../data');
const USER_DOC_ROOT = path.join(DATA_ROOT, 'user_docs');
const MEMORY_ROOT = path.join(DATA_ROOT, 'memory');
const SIRCHMUNK_BIN = process.env.SIRCHMUNK_BIN || 'sirchmunk';
const SIRCHMUNK_MODE = process.env.SIRCHMUNK_MODE || 'FAST';
const SIRCHMUNK_WORK_PATH = process.env.SIRCHMUNK_WORK_PATH || path.join(DATA_ROOT, '.sirchmunk');

const sanitizeUserId = (input) => String(input || '').replace(/[^a-zA-Z0-9_-]/g, '_');

const ensureUserDocDir = (userId) => {
  const dir = path.join(USER_DOC_ROOT, sanitizeUserId(userId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

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

const saveUserDoc = ({ userId, content, filename, prefix }) => {
  const dir = ensureUserDocDir(userId);
  const safePrefix = String(prefix || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_');
  const rawName = String(filename || '').trim() || `${safePrefix}-${Date.now()}.md`;
  const normalizedName = rawName.replace(/[^\w.\-]/g, '_');
  const targetName = normalizedName.startsWith(`${safePrefix}-`) ? normalizedName : `${safePrefix}-${normalizedName}`;
  const target = path.join(dir, targetName);
  fs.writeFileSync(target, String(content || ''), 'utf8');
  return target;
};

const saveResumeDoc = ({ userId, resumeText, filename }) =>
  saveUserDoc({ userId, content: resumeText, filename, prefix: 'resume' });

const saveJdDoc = ({ userId, jdText, filename }) =>
  saveUserDoc({ userId, content: jdText, filename, prefix: 'jd' });

const listUserDocs = (userId, options = {}) => {
  const dir = ensureUserDocDir(userId);
  const prefix = String(options.prefix || '').trim();
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
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

const listResumeDocs = (userId) => listUserDocs(userId, { prefix: 'resume' });
const listJdDocs = (userId) => listUserDocs(userId, { prefix: 'jd' });

const readUserDoc = ({ userId, fileName, prefix }) => {
  const dir = ensureUserDocDir(userId);
  const safeName = String(fileName || '').trim().replace(/[^\w.\-]/g, '_');
  const candidates = [];

  if (safeName) {
    candidates.push(safeName);
    if (prefix && !safeName.startsWith(`${prefix}-`)) {
      candidates.push(`${prefix}-${safeName}`);
    }
  }

  const matchedName = candidates.find((name) => fs.existsSync(path.join(dir, name)));
  if (!matchedName) return null;

  const fullPath = path.join(dir, matchedName);
  return {
    name: matchedName,
    path: fullPath,
    content: fs.readFileSync(fullPath, 'utf8'),
  };
};

const readResumeDoc = ({ userId, fileName }) => readUserDoc({ userId, fileName, prefix: 'resume' });
const readJdDoc = ({ userId, fileName }) => readUserDoc({ userId, fileName, prefix: 'jd' });

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

const localSearch = ({ userId, keywords, limit = 20 }) => {
  const dir = ensureUserDocDir(userId);
  const terms = (Array.isArray(keywords) ? keywords : [])
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  if (terms.length === 0) return [];

  const hits = new Map();

  for (const term of terms) {
    const proc = spawnSync(
      'rg',
      ['-n', '--no-heading', '--max-count', '3', '-F', term, dir],
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

const extractJsonCandidate = (raw) => {
  const text = stripAnsi(raw);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isSirchmunkLogLine(line));

  if (lines.length === 0) return '';

  const cleaned = lines.join('\n').trim();
  if (!cleaned) return '';

  const firstObject = cleaned.indexOf('{');
  const firstArray = cleaned.indexOf('[');
  const starts = [firstObject, firstArray].filter((index) => index >= 0);
  if (starts.length === 0) return '';

  const start = Math.min(...starts);
  return cleaned.slice(start).trim();
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

const normalizeSirchmunkItems = (raw, limit) => {
  const jsonText = extractJsonCandidate(raw);
  if (!jsonText) return [];

  try {
    const parsed = JSON.parse(jsonText);
    const array = pickSirchmunkArray(parsed);
    return array.slice(0, limit).map((item, index) => ({
      source: 'sirchmunk',
      source_uri: String(item.path || item.file || item.source_uri || `sirchmunk://result/${index + 1}`),
      text: String(item.text || item.snippet || item.content || '').slice(0, 1200),
      score: typeof item.score === 'number' ? item.score : null,
    }))
      .filter((item) => item.text && !isSirchmunkLogLine(item.text));
  } catch {
    // 只接受结构化 JSON 输出，避免把 CLI 运行日志误判为证据。
    return [];
  }
};

const sirchmunkSearch = ({ query, paths, limit = 5 }) => {
  if (!hasCommand(SIRCHMUNK_BIN)) {
    return {
      available: false,
      items: [],
      message: `${SIRCHMUNK_BIN} command not found; fallback to local rg search`,
    };
  }

  const validPaths = (paths || []).filter((item) => fs.existsSync(item));
  if (validPaths.length === 0) {
    return {
      available: true,
      items: [],
      message: 'no valid search paths for sirchmunk',
    };
  }

  fs.mkdirSync(SIRCHMUNK_WORK_PATH, { recursive: true });

  const env = {
    ...process.env,
    SIRCHMUNK_WORK_PATH,
    LLM_API_KEY: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    LLM_BASE_URL: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    LLM_MODEL_NAME: process.env.LLM_MODEL_NAME || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  };

  const args = ['search', query, ...validPaths, '--mode', SIRCHMUNK_MODE, '--output', 'json'];
  const run = spawnSync(SIRCHMUNK_BIN, args, {
    encoding: 'utf8',
    timeout: 20_000,
    env,
  });
  if (run.error || run.status !== 0) {
    return {
      available: true,
      items: [],
      message: String(run.stderr || run.error?.message || 'sirchmunk failed'),
    };
  }

  const items = normalizeSirchmunkItems(run.stdout, limit);
  if (items.length === 0) {
    return { available: true, items: [], message: 'empty sirchmunk output' };
  }

  return {
    available: true,
    items,
    message: 'ok',
  };
};

const getSirchmunkStatus = () => ({
  enabled: hasCommand(SIRCHMUNK_BIN),
  bin: SIRCHMUNK_BIN,
  mode: SIRCHMUNK_MODE,
  work_path: SIRCHMUNK_WORK_PATH,
});

const buildQueryPlan = ({ question, resumeSummary = '' }) => {
  const normalized = String(question || '').trim();
  const rawTerms = normalized
    .split(/[\s,，。！？?!.;；:：()（）]+/)
    .filter(Boolean);
  const resumeTerms = String(resumeSummary || '')
    .split(/[\s,，。！？?!.;；:：()（）]+/)
    .filter(Boolean)
    .slice(0, 8);

  const uniq = Array.from(new Set([...rawTerms, ...resumeTerms]));

  return {
    rewritten_query: normalized,
    keyword_groups: {
      entity_terms: uniq.slice(0, 4),
      intent_terms: uniq.slice(4, 6),
      evidence_terms: uniq.slice(6, 10),
    },
    next_action: 'local_search_first',
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
    confidence: typeof item.score === 'number' ? Math.max(0.5, Math.min(0.95, item.score)) : 0.7,
  }));

// 统一检索适配层：上层只依赖这一份结果，不依赖 rg / sirchmunk / web 的内部概念。
const retrieveEvidence = ({
  userId,
  question,
  answer = '',
  resumeSummary = '',
  limit = 6,
  strategy = 'auto',
  enableWebFallback = false,
}) => {
  const plan = buildQueryPlan({
    question: `${question} ${String(answer || '').slice(0, 120)}`.trim(),
    resumeSummary,
  });
  const keywordPool = [
    ...plan.keyword_groups.entity_terms,
    ...plan.keyword_groups.intent_terms,
    ...plan.keyword_groups.evidence_terms,
  ].filter(Boolean);
  const docPath = path.join(USER_DOC_ROOT, sanitizeUserId(userId));

  const localHits = localSearch({
    userId,
    keywords: keywordPool,
    limit,
  });
  const localEvidence = mapLocalHitsToEvidence(localHits);

  let sirchmunk = { available: false, items: [], message: 'not_requested' };
  // auto 模式下先走轻量本地检索，仅在命中不足时升级到 sirchmunk。
  const shouldTrySirchmunk = strategy === 'sirchmunk' || (strategy === 'auto' && localHits.length < 2);
  if (shouldTrySirchmunk) {
    sirchmunk = sirchmunkSearch({
      query: plan.rewritten_query,
      paths: [docPath],
      limit: Math.min(3, limit),
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
