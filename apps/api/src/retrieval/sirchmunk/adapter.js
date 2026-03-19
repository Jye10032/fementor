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
    return [];
  }
};

const normalizeSirchmunkLogItems = (raw, limit) => {
  const text = stripAnsi(String(raw || ''));
  const lines = text.split(/\r?\n/);
  const items = [];

  for (const line of lines) {
    const posMatch = line.match(/\[Pos\s+(\d+)\s+\|\s+Src:\s*([^\]]+)\]\s+Score:\s*([0-9.]+)\s+\|\s+(.+)$/i);
    if (posMatch) {
      items.push({
        source: 'sirchmunk',
        source_uri: `sirchmunk://logpos/${posMatch[1]}`,
        text: normalizeInlineWhitespace(posMatch[4] || '').slice(0, 1200),
        score: Number(posMatch[3]),
        reasoning: `log_source=${normalizeInlineWhitespace(posMatch[2] || '')}`,
        summary: '',
      });
    }
  }

  return items
    .filter((item) => item.text && !isNoResultText(item.text))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    .slice(0, limit);
};

const extractSirchmunkItemsFromOutputs = ({ stdout, stderr, limit }) => {
  const candidates = [
    normalizeSirchmunkItems(stdout, limit),
    normalizeSirchmunkItems(stderr, limit),
    normalizeSirchmunkItems(`${stdout}\n${stderr}`, limit),
    normalizeSirchmunkLogItems(stderr, limit),
  ];

  return candidates.find((items) => Array.isArray(items) && items.length > 0) || [];
};

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

module.exports = {
  extractSirchmunkItemsFromOutputs,
  mapSirchmunkItemsToEvidence,
};
