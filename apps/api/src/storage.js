const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const getAppRuntimeMode = () =>
  String(process.env.APP_RUNTIME_MODE || 'local').trim().toLowerCase() === 'cloud'
    ? 'cloud'
    : 'local';

function isStorageEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getStorageHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function getStorageBaseUrl() {
  return SUPABASE_URL.replace(/\/+$/, '');
}

function sanitizeUserId(input) {
  return String(input || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getBucketName(kind) {
  const runtimeMode = getAppRuntimeMode();
  if (kind === 'resume') {
    return runtimeMode === 'cloud' ? 'resumes' : 'resumes-dev';
  }
  if (kind === 'jd') {
    return runtimeMode === 'cloud' ? 'jds' : 'jds-dev';
  }
  throw new Error(`unsupported storage bucket kind: ${kind}`);
}

function getObjectPath({ userId, fileName }) {
  return `${sanitizeUserId(userId)}/${String(fileName || '').trim()}`;
}

function getPublicPath({ bucket, objectPath }) {
  return `${bucket}/${objectPath}`;
}

function getObjectUrl({ bucket, objectPath }) {
  return `${getStorageBaseUrl()}/storage/v1/object/${bucket}/${objectPath}`;
}

async function expectOk(response, label) {
  if (response.ok) {
    return;
  }

  const body = await response.text();
  throw new Error(`${label} failed: HTTP ${response.status} ${body}`);
}

async function uploadTextObject({ bucket, objectPath, content, contentType = 'text/plain; charset=utf-8', upsert = false }) {
  const response = await fetch(getObjectUrl({ bucket, objectPath }), {
    method: 'POST',
    headers: getStorageHeaders({
      'Content-Type': contentType,
      'x-upsert': upsert ? 'true' : 'false',
    }),
    body: String(content || ''),
  });
  await expectOk(response, 'storage upload');

  return {
    bucket,
    objectPath,
    path: getPublicPath({ bucket, objectPath }),
    name: path.basename(objectPath),
  };
}

async function downloadTextObject({ bucket, objectPath }) {
  const response = await fetch(getObjectUrl({ bucket, objectPath }), {
    method: 'GET',
    headers: getStorageHeaders(),
  });

  if (response.status === 400 || response.status === 404) {
    return null;
  }

  await expectOk(response, 'storage download');
  return {
    bucket,
    objectPath,
    path: getPublicPath({ bucket, objectPath }),
    name: path.basename(objectPath),
    content: await response.text(),
  };
}

async function deleteObject({ bucket, objectPath }) {
  const response = await fetch(getObjectUrl({ bucket, objectPath }), {
    method: 'DELETE',
    headers: getStorageHeaders(),
  });

  if (response.status === 400 || response.status === 404) {
    return false;
  }

  await expectOk(response, 'storage delete');
  return true;
}

async function listObjects({ bucket, prefix }) {
  const response = await fetch(`${getStorageBaseUrl()}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: getStorageHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      prefix,
      limit: 1000,
      offset: 0,
      sortBy: { column: 'updated_at', order: 'desc' },
    }),
  });
  await expectOk(response, 'storage list');

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

module.exports = {
  deleteObject,
  downloadTextObject,
  getAppRuntimeMode,
  getBucketName,
  getObjectPath,
  getPublicPath,
  isStorageEnabled,
  listObjects,
  sanitizeUserId,
  uploadTextObject,
};
