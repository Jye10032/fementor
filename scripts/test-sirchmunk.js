const path = require('path');
const fs = require('fs');

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
  saveResumeDoc,
} = require('../apps/api/src/resume');
const {
  retrieveEvidence,
  getSirchmunkStatus,
} = require('../apps/api/src/retrieval');

const parseArgs = (argv) => {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === '--query' && next) {
      result.query = next;
      i += 1;
      continue;
    }
    if (current === '--text' && next) {
      result.text = next;
      i += 1;
      continue;
    }
    if (current === '--user' && next) {
      result.user = next;
      i += 1;
    }
  }
  return result;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const query = String(args.query || '候选人做过什么工程化重构').trim();
  const text = String(
    args.text
      || '我独立把一个新闻发布平台从 Create React App 迁移到 Vite + TypeScript，并补齐了 CI/CD、RBAC 权限和 AI 内容审核。',
  ).trim();
  const userId = String(args.user || `sirchmunk_test_${Date.now()}`).trim();

  saveResumeDoc({
    userId,
    filename: 'resume-test.txt',
    resumeText: text,
  });

  const result = await retrieveEvidence({
    userId,
    question: query,
    answer: text,
    strategy: 'sirchmunk',
    enableWebFallback: false,
  });

  const output = {
    llm_forwarding: {
      llm_base_url: process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || null,
      llm_model_name: process.env.LLM_MODEL_NAME || process.env.OPENAI_MODEL || null,
      llm_api_key_present: Boolean(process.env.LLM_API_KEY || process.env.OPENAI_API_KEY),
    },
    sirchmunk_status: getSirchmunkStatus(),
    input: {
      user_id: userId,
      query,
      text,
    },
    result,
  };

  console.log(JSON.stringify(output, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
