#!/usr/bin/env node

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { init } = require('../src/db');
const { recleanAllExperiencePosts } = require('../src/experience/service');

function parseArgs(argv) {
  const options = {
    onlyValid: false,
    verbose: false,
  };

  for (const arg of argv) {
    if (arg === '--only-valid') {
      options.onlyValid = true;
      continue;
    }
    if (arg === '--verbose') {
      options.verbose = true;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  init();

  const result = await recleanAllExperiencePosts({
    onlyValid: options.onlyValid,
    onProgress: options.verbose
      ? ({ total, completed_count, failed_count, current_post_id }) => {
        console.log(
          `[experience.reclean] ${completed_count + failed_count}/${total} ${current_post_id} ok=${completed_count} failed=${failed_count}`,
        );
      }
      : undefined,
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.failed_count > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error('[experience.reclean.failed]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
