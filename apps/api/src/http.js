const { formidable } = require('formidable');

const getCorsHeaders = (req) => {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
};

const getErrorStatusCode = (error, fallbackStatusCode = 400) => {
  const statusCode = Number(error?.statusCode);
  return Number.isInteger(statusCode) && statusCode >= 100 ? statusCode : fallbackStatusCode;
};

const getErrorMessage = (error, fallbackMessage = 'bad request') => String(error?.message || fallbackMessage);

const jsonError = (res, error, fallbackStatusCode = 400, fallbackMessage = 'bad request') =>
  json(res, getErrorStatusCode(error, fallbackStatusCode), { error: getErrorMessage(error, fallbackMessage) });

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      resolve(req.body || {});
      return;
    }

    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const readMultipartForm = (req) =>
  new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize: 8 * 1024 * 1024,
      maxTotalFileSize: 8 * 1024 * 1024,
      keepExtensions: true,
    });

    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ fields, files });
    });
  });

const pickFormValue = (value) => {
  if (Array.isArray(value)) return pickFormValue(value[0]);
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const writeSse = (res, event, payload) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const flushSseFrame = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const getPathSegment = (pathname, index) => decodeURIComponent(String(pathname || '').split('/')[index] || '').trim();

const parseNumberOrFallback = (value, fallbackValue) => {
  const parsedValue = Number(value);
  return Number.isNaN(parsedValue) ? fallbackValue : parsedValue;
};

const requirePathSegment = (pathname, index, fieldName) => {
  const value = getPathSegment(pathname, index);
  if (!value) {
    throw createHttpError(400, `${fieldName} is required`);
  }
  return value;
};

module.exports = {
  createHttpError,
  flushSseFrame,
  getCorsHeaders,
  getErrorStatusCode,
  getErrorMessage,
  json,
  jsonError,
  parseNumberOrFallback,
  pickFormValue,
  readBody,
  readMultipartForm,
  requirePathSegment,
  writeSse,
};
