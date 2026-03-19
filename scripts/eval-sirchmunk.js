const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../apps/api/.env');
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex <= 0) continue;
  const key = trimmed.slice(0, separatorIndex).trim();
  const value = trimmed.slice(separatorIndex + 1).trim();
  if (!(key in process.env)) {
    process.env[key] = value;
  }
}

const {
  listUserDocs,
  listJdDocs,
} = require('../apps/api/src/doc');
const {
  listResumeDocs,
} = require('../apps/api/src/resume');
const {
  retrieveEvidence,
  getSirchmunkStatus,
} = require('../apps/api/src/retrieval');
const { getUserById } = require('../apps/api/src/db');

const DEFAULT_CASES_PATH = path.resolve(__dirname, '../evals/sirchmunk-eval-cases.json');
const DEFAULT_REPORT_DIR = path.resolve(__dirname, '../docs/reports');

const parseArgs = (argv) => {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === '--user' && next) {
      result.user = next;
      index += 1;
      continue;
    }
    if (current === '--cases' && next) {
      result.cases = next;
      index += 1;
      continue;
    }
    if (current === '--report-dir' && next) {
      result.reportDir = next;
      index += 1;
      continue;
    }
    if (current === '--variants' && next) {
      result.variants = next;
      index += 1;
      continue;
    }
    if (current === '--max-cases' && next) {
      result.maxCases = next;
      index += 1;
    }
  }
  return result;
};

const normalizeText = (input) => String(input || '').toLowerCase();
const containsAny = (text, parts = []) => parts.some((part) => normalizeText(text).includes(normalizeText(part)));

const resolveScopePaths = ({ userId, scope = [] }) => {
  const user = getUserById(userId);
  const resumeDocs = listResumeDocs(userId);
  const jdDocs = listJdDocs(userId);
  const knowledgeDocs = listUserDocs(userId);
  const paths = [];

  if (scope.includes('resume')) {
    const activeResume = resumeDocs.find((item) => item.name === user?.active_resume_file);
    if (activeResume) {
      paths.push(activeResume.path);
    } else {
      paths.push(...resumeDocs.map((item) => item.path));
    }
  }

  if (scope.includes('jd')) {
    const activeJd = jdDocs.find((item) => item.name === user?.active_jd_file);
    if (activeJd) {
      paths.push(activeJd.path);
    } else {
      paths.push(...jdDocs.map((item) => item.path));
    }
  }

  if (scope.includes('knowledge')) {
    paths.push(...knowledgeDocs.map((item) => item.path));
  }

  return Array.from(new Set(paths));
};

const summarizeEvidence = (evidenceRefs = []) =>
  evidenceRefs.map((item) => `${path.basename(String(item.source_uri || ''))} ${String(item.quote || '')}`).join('\n');

const scoreCaseResult = ({ testCase, result }) => {
  const evidenceRefs = Array.isArray(result.evidence_refs) ? result.evidence_refs : [];
  const evidenceText = summarizeEvidence(evidenceRefs);
  const sourceUris = evidenceRefs.map((item) => String(item.source_uri || ''));
  const fileHit = testCase.expect_no_evidence
    ? evidenceRefs.length === 0
    : containsAny(sourceUris.join('\n'), testCase.expected_files_any_contains || []);
  const keywordHits = (testCase.expected_keywords || []).filter((keyword) => containsAny(evidenceText, [keyword]));

  if (testCase.expect_no_evidence) {
    return {
      file_hit: fileHit,
      keyword_hits: [],
      keyword_hit_count: 0,
      score: evidenceRefs.length === 0 ? 3 : 0,
      passed: evidenceRefs.length === 0,
    };
  }

  const score = (fileHit ? 3 : 0) + Math.min(keywordHits.length, 3) + (evidenceRefs.length > 0 ? 1 : 0);
  return {
    file_hit: fileHit,
    keyword_hits: keywordHits,
    keyword_hit_count: keywordHits.length,
    score,
    passed: fileHit || keywordHits.length > 0,
  };
};

const buildVariantConfig = (testCase, variant) => {
  if (variant === 'prompted') {
    return {
      strategy: 'sirchmunk',
      plannedQuery: testCase.planned_query || '',
      plannedKeywords: testCase.planned_keywords || [],
    };
  }
  if (variant === 'local') {
    return {
      strategy: 'local',
      plannedQuery: testCase.planned_query || '',
      plannedKeywords: testCase.planned_keywords || [],
    };
  }
  return {
    strategy: 'sirchmunk',
    plannedQuery: '',
    plannedKeywords: [],
  };
};

const aggregateVariant = (results = []) => {
  const total = results.length || 1;
  const passCount = results.filter((item) => item.metrics.passed).length;
  const fileHitCount = results.filter((item) => item.metrics.file_hit).length;
  const latencyValues = results.map((item) => item.latency_ms);
  const averageLatency = Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / total);
  const averageScore = Number((results.reduce((sum, item) => sum + item.metrics.score, 0) / total).toFixed(2));
  const averageEvidenceCount = Number((
    results.reduce((sum, item) => sum + item.evidence_count, 0) / total
  ).toFixed(2));

  return {
    total_cases: results.length,
    pass_rate: Number((passCount / total).toFixed(3)),
    file_hit_rate: Number((fileHitCount / total).toFixed(3)),
    average_score: averageScore,
    average_latency_ms: averageLatency,
    average_evidence_count: averageEvidenceCount,
  };
};

const buildMarkdownReport = ({ generatedAt, userId, casePath, report }) => {
  const lines = [
    '# Sirchmunk 检索增强评测报告',
    '',
    `- 生成时间：${generatedAt}`,
    `- 用户：${userId}`,
    `- 用例文件：${casePath}`,
    `- Sirchmunk：${JSON.stringify(report.sirchmunk_status)}`,
    '',
    '## 变体汇总',
    '',
    '| variant | cases | pass_rate | file_hit_rate | avg_score | avg_latency_ms | avg_evidence_count |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const [variant, summary] of Object.entries(report.summary_by_variant)) {
    lines.push(`| ${variant} | ${summary.total_cases} | ${summary.pass_rate} | ${summary.file_hit_rate} | ${summary.average_score} | ${summary.average_latency_ms} | ${summary.average_evidence_count} |`);
  }

  lines.push('', '## 用例结果', '');
  for (const testCase of report.cases) {
    lines.push(`### ${testCase.id}`);
    lines.push(`- category: ${testCase.category}`);
    lines.push(`- question: ${testCase.question}`);
    for (const variantResult of testCase.variants) {
      lines.push(`- ${variantResult.variant}: score=${variantResult.metrics.score}, passed=${variantResult.metrics.passed}, file_hit=${variantResult.metrics.file_hit}, keyword_hits=${variantResult.metrics.keyword_hits.join('、') || '无'}, evidence_count=${variantResult.evidence_count}, latency_ms=${variantResult.latency_ms}`);
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const userId = String(args.user || 'u_web_001').trim();
  const casePath = path.resolve(args.cases || DEFAULT_CASES_PATH);
  const reportDir = path.resolve(args.reportDir || DEFAULT_REPORT_DIR);
  const allCases = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  const variants = String(args.variants || 'direct,prompted,local')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => ['direct', 'prompted', 'local'].includes(item));
  const maxCases = Number(args.maxCases || 0);
  const cases = Number.isFinite(maxCases) && maxCases > 0 ? allCases.slice(0, maxCases) : allCases;
  const generatedAt = new Date().toISOString();
  const resultsByVariant = Object.fromEntries(variants.map((variant) => [variant, []]));
  const caseResults = [];

  for (const testCase of cases) {
    const paths = resolveScopePaths({ userId, scope: testCase.scope || [] });
    const variantsResult = [];

    for (const variant of variants) {
      const config = buildVariantConfig(testCase, variant);
      const startedAt = Date.now();
      let normalizedResult;
      try {
        const result = await retrieveEvidence({
          userId,
          question: testCase.question,
          answer: testCase.answer,
          strategy: config.strategy,
          questionType: testCase.question_type || 'project',
          paths,
          plannedQuery: config.plannedQuery,
          plannedKeywords: config.plannedKeywords,
          enableWebFallback: false,
        });
        const latencyMs = Date.now() - startedAt;
        const metrics = scoreCaseResult({ testCase, result });
        normalizedResult = {
          case_id: testCase.id,
          category: testCase.category,
          variant,
          latency_ms: latencyMs,
          strategy: result.strategy,
          evidence_count: Array.isArray(result.evidence_refs) ? result.evidence_refs.length : 0,
          metrics,
          top_evidence_refs: (result.evidence_refs || []).slice(0, 3),
          sirchmunk_message: result.sirchmunk?.message || '',
          error: '',
        };
      } catch (error) {
        normalizedResult = {
          case_id: testCase.id,
          category: testCase.category,
          variant,
          latency_ms: Date.now() - startedAt,
          strategy: 'error',
          evidence_count: 0,
          metrics: {
            file_hit: false,
            keyword_hits: [],
            keyword_hit_count: 0,
            score: 0,
            passed: false,
          },
          top_evidence_refs: [],
          sirchmunk_message: '',
          error: String(error?.message || error || 'unknown_error'),
        };
      }
      resultsByVariant[variant].push(normalizedResult);
      variantsResult.push(normalizedResult);
    }

    caseResults.push({
      id: testCase.id,
      category: testCase.category,
      question: testCase.question,
      variants: variantsResult,
    });
  }

  const report = {
    generated_at: generatedAt,
    user_id: userId,
    case_path: casePath,
    sirchmunk_status: getSirchmunkStatus(),
    summary_by_variant: Object.fromEntries(
      variants.map((variant) => [variant, aggregateVariant(resultsByVariant[variant])]),
    ),
    cases: caseResults,
  };

  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(reportDir, `sirchmunk-eval-${stamp}.json`);
  const mdPath = path.join(reportDir, `sirchmunk-eval-${stamp}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(mdPath, buildMarkdownReport({
    generatedAt,
    userId,
    casePath,
    report,
  }), 'utf8');

  console.log(JSON.stringify({
    json_report: jsonPath,
    markdown_report: mdPath,
    summary_by_variant: report.summary_by_variant,
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
