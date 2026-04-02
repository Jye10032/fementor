const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const SUPABASE_URL = String(
  process.env.SUPABASE_URL
  || process.env.NEXT_PUBLIC_SUPABASE_URL
  || '',
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_STORAGE_BUCKET = String(process.env.SUPABASE_STORAGE_BUCKET || 'resumes').trim();

function getRequiredConfig() {
  if (!SUPABASE_URL) {
    throw new Error('SUPABASE_URL is required');
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  }

  return {
    baseUrl: SUPABASE_URL.replace(/\/+$/, ''),
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
    bucket: SUPABASE_STORAGE_BUCKET,
  };
}

function getHeaders(serviceRoleKey, extra = {}) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

async function expectOk(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} failed: HTTP ${response.status} ${body}`);
  }
}

async function run() {
  const { baseUrl, serviceRoleKey, bucket } = getRequiredConfig();
  const objectPath = `smoke-tests/${Date.now()}-storage-check.txt`;
  const body = `storage smoke test ${new Date().toISOString()}\n`;

  const uploadResponse = await fetch(
    `${baseUrl}/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: 'POST',
      headers: getHeaders(serviceRoleKey, {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-upsert': 'false',
      }),
      body,
    },
  );
  await expectOk(uploadResponse, 'upload');

  const downloadResponse = await fetch(
    `${baseUrl}/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: 'GET',
      headers: getHeaders(serviceRoleKey),
    },
  );
  await expectOk(downloadResponse, 'download');
  const downloadedBody = await downloadResponse.text();

  const removeResponse = await fetch(
    `${baseUrl}/storage/v1/object/${bucket}/${objectPath}`,
    {
      method: 'DELETE',
      headers: getHeaders(serviceRoleKey),
    },
  );
  await expectOk(removeResponse, 'delete');

  console.log(JSON.stringify({
    ok: true,
    bucket,
    objectPath,
    uploaded: true,
    downloadedMatches: downloadedBody === body,
    deleted: true,
  }));
}

run().catch((error) => {
  console.error('[storage.test.failed]', error.message);
  process.exit(1);
});
