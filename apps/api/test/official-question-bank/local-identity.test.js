const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');

const originalRuntimeMode = process.env.APP_RUNTIME_MODE;
const {
  LOCAL_IDENTITY_COOKIE,
  ensureLocalRequestIdentity,
  parseCookies,
} = require('../../src/local-identity');

beforeEach(() => {
  process.env.APP_RUNTIME_MODE = 'local';
});

after(() => {
  if (originalRuntimeMode === undefined) delete process.env.APP_RUNTIME_MODE;
  else process.env.APP_RUNTIME_MODE = originalRuntimeMode;
});

const request = (cookie = '') => ({
  headers: { cookie },
  socket: { encrypted: false },
});

test('local identity creates a secure opaque browser identity', () => {
  const identity = ensureLocalRequestIdentity(request());

  assert.match(identity.cookieValue, /^[0-9a-f-]{36}$/i);
  assert.equal(identity.userId, `local:${identity.cookieValue}`);
  assert.equal(identity.isNew, true);
  assert.match(identity.setCookie, new RegExp(`^${LOCAL_IDENTITY_COOKIE}=`));
  assert.match(identity.setCookie, /HttpOnly/);
  assert.match(identity.setCookie, /SameSite=Lax/);
});

test('local identity is stable within one browser and isolated across browsers', () => {
  const first = ensureLocalRequestIdentity(request());
  const cookieHeader = `${LOCAL_IDENTITY_COOKIE}=${encodeURIComponent(first.cookieValue)}`;
  const repeated = ensureLocalRequestIdentity(request(cookieHeader));
  const anotherBrowser = ensureLocalRequestIdentity(request());

  assert.equal(repeated.userId, first.userId);
  assert.equal(repeated.isNew, false);
  assert.equal(repeated.setCookie, '');
  assert.notEqual(anotherBrowser.userId, first.userId);
  assert.equal(parseCookies(cookieHeader)[LOCAL_IDENTITY_COOKIE], first.cookieValue);
});

test('cloud runtime never creates the local identity cookie', () => {
  process.env.APP_RUNTIME_MODE = 'cloud';
  assert.equal(ensureLocalRequestIdentity(request()), null);
});
