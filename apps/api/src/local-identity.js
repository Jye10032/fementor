const { randomUUID } = require('crypto');

const LOCAL_IDENTITY_COOKIE = 'fementor_local_user';
const LOCAL_IDENTITY_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isLocalRuntime = () =>
  String(process.env.APP_RUNTIME_MODE || 'local').trim().toLowerCase() !== 'cloud';

const parseCookies = (header = '') =>
  String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator < 1) return cookies;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = '';
      }
      return cookies;
    }, {});

const isSecureRequest = (req) => {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  return Boolean(req?.socket?.encrypted) || forwardedProto === 'https';
};

const serializeLocalIdentityCookie = ({ value, secure = false }) => [
  `${LOCAL_IDENTITY_COOKIE}=${encodeURIComponent(value)}`,
  'Path=/',
  `Max-Age=${LOCAL_IDENTITY_MAX_AGE_SECONDS}`,
  'HttpOnly',
  'SameSite=Lax',
  secure ? 'Secure' : '',
].filter(Boolean).join('; ');

const ensureLocalRequestIdentity = (req) => {
  if (!isLocalRuntime()) return null;
  if (req.fementorLocalIdentity) return req.fementorLocalIdentity;

  const cookies = parseCookies(req?.headers?.cookie);
  const existing = String(cookies[LOCAL_IDENTITY_COOKIE] || '').trim();
  const cookieValue = UUID_PATTERN.test(existing) ? existing : randomUUID();
  const identity = {
    cookieValue,
    userId: `local:${cookieValue}`,
    isNew: cookieValue !== existing,
    setCookie: cookieValue !== existing
      ? serializeLocalIdentityCookie({ value: cookieValue, secure: isSecureRequest(req) })
      : '',
  };
  req.fementorLocalIdentity = identity;
  return identity;
};

module.exports = {
  LOCAL_IDENTITY_COOKIE,
  ensureLocalRequestIdentity,
  parseCookies,
  serializeLocalIdentityCookie,
};
