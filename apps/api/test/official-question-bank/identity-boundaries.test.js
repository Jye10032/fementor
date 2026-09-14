const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');

const { enrichAuthUserFromClerk, getRequestAuth } = require('../../src/auth');
const { importResponse } = require('../../src/routes/official-question-bank-routes');
const {
  getWeaknessesResponse,
  listAttemptsResponse,
  promoteQuestionSourceResponse,
} = require('../../src/routes/practice-routes');

const originalEnvironment = {
  ALLOW_UNVERIFIED_AUTH_TOKEN: process.env.ALLOW_UNVERIFIED_AUTH_TOKEN,
  APP_RUNTIME_MODE: process.env.APP_RUNTIME_MODE,
  CLERK_JWT_KEY: process.env.CLERK_JWT_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  NODE_ENV: process.env.NODE_ENV,
};

const restore = (name, value) => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

const request = ({ authorization = '', cookie = '' } = {}) => ({
  headers: { authorization, cookie },
  socket: { encrypted: false },
});

const unsignedToken = (payload) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.`;
};

beforeEach(() => {
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_JWT_KEY;
  delete process.env.ALLOW_UNVERIFIED_AUTH_TOKEN;
  process.env.APP_RUNTIME_MODE = 'cloud';
  process.env.NODE_ENV = 'development';
});

afterEach(() => {
  Object.entries(originalEnvironment).forEach(([name, value]) => restore(name, value));
});

test('cloud mode rejects decoded but unverified Clerk tokens', async () => {
  const auth = await getRequestAuth(request({
    authorization: `Bearer ${unsignedToken({ sub: 'attacker', email: 'admin@example.com' })}`,
  }));

  assert.equal(auth.isAuthenticated, false);
  assert.equal(auth.verificationMode, 'rejected');
});

test('verified Clerk users without an email claim are enriched from their Clerk profile', async () => {
  const authUser = await enrichAuthUserFromClerk(
    {
      clerkUserId: 'user_admin',
      email: null,
      name: null,
      avatarUrl: null,
    },
    async (userId) => ({
      id: userId,
      primaryEmailAddressId: 'email_admin',
      emailAddresses: [{ id: 'email_admin', emailAddress: 'a13174323726@gmail.com' }],
      firstName: '叶',
      lastName: '季',
      imageUrl: 'https://img.example/admin.png',
    }),
  );

  assert.equal(authUser.email, 'a13174323726@gmail.com');
  assert.equal(authUser.name, '叶 季');
  assert.equal(authUser.avatarUrl, 'https://img.example/admin.png');
});

test('cloud anonymous official import uses the stable identity error', async () => {
  await assert.rejects(
    importResponse({ req: request(), pathname: '/v1/official-question-bank/question-1/import' }),
    (error) => error.statusCode === 401 && error.message === 'official_import_requires_identity',
  );
});

test('reserved official snapshots cannot be promoted through the generic write route', async () => {
  process.env.APP_RUNTIME_MODE = 'local';
  const result = await promoteQuestionSourceResponse({
    req: request(),
    body: {
      source_type: 'official_remote',
      source_ref_id: 'remote:question-1',
      canonical_question: '不能覆盖',
      question_text: '不能覆盖',
    },
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, 'official_source_is_read_only');
});

test('weakness and attempt reads do not accept another user id', async () => {
  process.env.APP_RUNTIME_MODE = 'local';
  const req = request();
  const identity = require('../../src/local-identity').ensureLocalRequestIdentity(req);

  const weaknesses = await getWeaknessesResponse({
    req,
    pathname: '/v1/users/another-user/weaknesses',
    searchParams: new URLSearchParams(),
  });
  const attempts = await listAttemptsResponse({
    req,
    searchParams: new URLSearchParams({ user_id: 'another-user' }),
  });

  assert.match(identity.userId, /^local:/);
  assert.equal(weaknesses.statusCode, 404);
  assert.equal(attempts.statusCode, 404);
});
