const { createClerkClient, verifyToken } = require('@clerk/backend');

let clerkClient = null;
let clerkClientSecretKey = '';

function decodeBase64Url(value) {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return Buffer.from(normalized + '='.repeat(padding), 'base64').toString('utf8');
}

function parseJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch {
    return null;
  }
}

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || '').trim();
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return authorization.slice(7).trim();
}

function buildAuthUserFromPayload(payload) {
  if (!payload || !payload.sub) {
    return null;
  }

  const givenName = String(payload.given_name || '').trim();
  const familyName = String(payload.family_name || '').trim();
  const fullName = String(payload.name || '').trim() || [givenName, familyName].filter(Boolean).join(' ') || null;

  return {
    clerkUserId: String(payload.sub).trim(),
    email: String(payload.email || payload.email_address || '').trim() || null,
    name: fullName,
    avatarUrl: String(payload.picture || '').trim() || null,
  };
}

function getClerkClient(secretKey) {
  if (!secretKey) {
    return null;
  }

  if (!clerkClient || clerkClientSecretKey !== secretKey) {
    clerkClient = createClerkClient({ secretKey });
    clerkClientSecretKey = secretKey;
  }

  return clerkClient;
}

async function enrichAuthUserFromClerk(authUser, fetchUser = fetchClerkUser) {
  if (!authUser || authUser.email) {
    return authUser;
  }

  const user = await fetchUser(authUser.clerkUserId);
  if (!user) {
    return authUser;
  }

  const primaryEmail = user.primaryEmailAddress?.emailAddress
    || user.emailAddresses?.find((address) => address.id === user.primaryEmailAddressId)?.emailAddress
    || user.emailAddresses?.[0]?.emailAddress
    || null;
  const givenName = String(user.firstName || '').trim();
  const familyName = String(user.lastName || '').trim();

  return {
    ...authUser,
    email: String(primaryEmail || '').trim() || null,
    name: authUser.name || String(user.fullName || '').trim() || [givenName, familyName].filter(Boolean).join(' ') || null,
    avatarUrl: authUser.avatarUrl || String(user.imageUrl || '').trim() || null,
  };
}

async function fetchClerkUser(userId) {
  const secretKey = String(process.env.CLERK_SECRET_KEY || '').trim();
  const client = getClerkClient(secretKey);
  if (!client || !userId) {
    return null;
  }

  try {
    return await client.users.getUser(userId);
  } catch (error) {
    console.warn('[auth.clerk.user_lookup_failed]', error instanceof Error ? error.message : 'user lookup failed');
    return null;
  }
}

async function verifyClerkSessionToken(token) {
  const secretKey = String(process.env.CLERK_SECRET_KEY || '').trim() || undefined;
  const jwtKey = String(process.env.CLERK_JWT_KEY || '').trim() || undefined;

  if (!secretKey && !jwtKey) {
    return null;
  }

  const payload = await verifyToken(token, {
    secretKey,
    jwtKey,
  });

  const authUser = buildAuthUserFromPayload(payload);
  return enrichAuthUserFromClerk(authUser);
}

async function getRequestAuth(req) {
  const token = getBearerToken(req);
  if (!token) {
    return {
      isAuthenticated: false,
      token: '',
      authUser: null,
      verificationMode: 'none',
    };
  }

  try {
    const authUser = await verifyClerkSessionToken(token);
    if (authUser) {
      return {
        isAuthenticated: true,
        token,
        authUser,
        verificationMode: 'verified',
      };
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      return {
        isAuthenticated: false,
        token,
        authUser: null,
        verificationMode: 'rejected',
        error: error instanceof Error ? error.message : 'token verification failed',
      };
    }
  }

  const allowDecodedFallback = String(process.env.ALLOW_UNVERIFIED_AUTH_TOKEN || '').trim() === '1'
    && String(process.env.APP_RUNTIME_MODE || 'local').trim().toLowerCase() !== 'cloud'
    && process.env.NODE_ENV !== 'production';
  if (!allowDecodedFallback) {
    return {
      isAuthenticated: false,
      token,
      authUser: null,
      verificationMode: 'rejected',
    };
  }

  const payload = parseJwtPayload(token);
  const fallbackAuthUser = buildAuthUserFromPayload(payload);
  if (!fallbackAuthUser) {
    return {
      isAuthenticated: false,
      token,
      authUser: null,
      verificationMode: 'rejected',
    };
  }

  return {
    isAuthenticated: true,
    token,
    authUser: fallbackAuthUser,
    verificationMode: 'decoded_fallback',
  };
}

module.exports = {
  buildAuthUserFromPayload,
  enrichAuthUserFromClerk,
  getRequestAuth,
};
