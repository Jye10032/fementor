#!/usr/bin/env node

const path = require('path');
const { saveNiukeExperiences, DEFAULT_OUTPUT_PATH } = require('../src/niuke-crawler');

const readArgValue = (args, index) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    return '';
  }
  return value;
};

const parseArgs = (argv) => {
  const args = argv.slice(2);
  const options = {
    articleUrls: [],
    verbose: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--keyword':
        options.keyword = readArgValue(args, index);
        index += 1;
        break;
      case '--pages':
        options.pages = Number(readArgValue(args, index));
        index += 1;
        break;
      case '--max-items':
        options.maxItems = Number(readArgValue(args, index));
        index += 1;
        break;
      case '--delay-ms':
        options.delayMs = Number(readArgValue(args, index));
        index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = Number(readArgValue(args, index));
        index += 1;
        break;
      case '--list-url':
        options.listUrl = readArgValue(args, index);
        index += 1;
        break;
      case '--output':
        options.output = path.resolve(process.cwd(), readArgValue(args, index));
        index += 1;
        break;
      case '--article-url':
        options.articleUrls.push(readArgValue(args, index));
        index += 1;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
          options.articleUrls.push(arg);
        }
        break;
    }
  }

  return options;
};

const printHelp = () => {
  console.log(`
用法:
  npm --prefix apps/api run crawl:niuke -- --keyword "前端 面经"

常用参数:
  --keyword      搜索关键词，默认 "前端 面经"
  --pages        抓取列表页数量，默认 3
  --max-items    最多抓取文章数，默认 30
  --delay-ms     每次请求间隔，默认 1200
  --timeout-ms   单次请求超时，默认 15000
  --list-url     自定义列表页模板，支持 {keyword} 和 {page}
  --article-url  直接抓取单篇文章，可重复传入
  --output       输出 JSON 路径，默认 ${DEFAULT_OUTPUT_PATH}
  --verbose      打印详细日志

示例:
  npm --prefix apps/api run crawl:niuke -- --keyword "前端实习 面经" --pages 2 --max-items 10 --verbose
  npm --prefix apps/api run crawl:niuke -- --article-url "https://www.nowcoder.com/discuss/123456789"
  `.trim());
};

const main = async () => {
  const options = parseArgs(process.argv);

  if (options.help) {
    printHelp();
    return;
  }

  const result = await saveNiukeExperiences(options);

  console.log(JSON.stringify({
    outputPath: result.outputPath,
    meta: result.meta,
    failures: result.failures.slice(0, 10),
  }, null, 2));
};

main().catch((error) => {
  console.error('[niuke-crawler.error]', error.message);
  process.exitCode = 1;
});
