const path = require('path');
const { getUserById, setActiveResumeFile, setActiveJdFile } = require('../db');
const { saveJdDoc, listJdDocs, readJdDoc, deleteJdDoc } = require('../doc');
const { listResumeDocs, readResumeDoc, updateResumeDocMeta, deleteResumeDoc } = require('../resume');
const { json, jsonError, readBody } = require('../http');
const { ensureLocalUserProfile, getResolvedUserContext } = require('../request-context');
const { summarizeResumeWithLLM } = require('../interview/llm-service');
const { parseResumeRequest } = require('../resume-parse-service');
const { ensureExampleProfileDocs } = require('../profile-example-docs');
const { isPostgresEnabled, upsertAppUserByClerk } = require('../postgres');

const mergeProfileUsers = (sqliteUser, postgresUser) => {
  if (!postgresUser) {
    return sqliteUser;
  }

  if (!sqliteUser) {
    return postgresUser;
  }

  return {
    ...sqliteUser,
    ...postgresUser,
    resume_summary: postgresUser.resume_summary || sqliteUser.resume_summary || '',
    resume_structured_json: postgresUser.resume_structured_json || sqliteUser.resume_structured_json || '',
    active_resume_file: postgresUser.active_resume_file || sqliteUser.active_resume_file || '',
    active_jd_file: postgresUser.active_jd_file || sqliteUser.active_jd_file || '',
  };
};

const syncPostgresProfile = async ({ authUser, profile = {} }) => {
  if (!isPostgresEnabled() || !authUser?.clerkUserId) {
    return null;
  }

  return upsertAppUserByClerk({
    clerkUserId: authUser.clerkUserId,
    email: authUser.email,
    name: authUser.name,
    avatarUrl: authUser.avatarUrl,
    resumeSummary: profile.resumeSummary,
    resumeStructuredJson: profile.resumeStructuredJson,
    activeResumeFile: profile.activeResumeFile,
    activeJdFile: profile.activeJdFile,
  });
};

const readMultipartParts = async (request) => {
  const fields = {};
  const files = {};

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      if (part.fieldname !== 'resume_file') {
        part.file.resume();
        continue;
      }

      files[part.fieldname] = {
        buffer: await part.toBuffer(),
        filename: part.filename,
        mimetype: part.mimetype,
        fieldname: part.fieldname,
      };
      continue;
    }

    fields[part.fieldname] = part.value;
  }

  return { fields, files };
};

const getResumeLibraryResponse = async ({ req, queryUserId }) => {
  const context = await getResolvedUserContext({
    req,
    queryUserId,
    requireAuth: true,
  });
  const userId = context.userId;
  await ensureExampleProfileDocs({ userId, authUser: context.authUser });
  const sqliteUser = await getUserById(userId);
  const postgresUser = await syncPostgresProfile({ authUser: context.authUser });
  const user = mergeProfileUsers(sqliteUser, postgresUser);
  const files = await listResumeDocs(userId);
  const activeFile = files.find((item) => item.name === user?.active_resume_file) || null;
  const activeSummary = String(activeFile?.summary || user?.resume_summary || '').trim();

  return {
    statusCode: 200,
    payload: {
      user_id: userId,
      profile: user ? {
        id: user.id,
        name: user.name,
        resume_summary: activeSummary,
        active_resume_file: user.active_resume_file,
        active_jd_file: user.active_jd_file,
        updated_at: user.updated_at,
      } : null,
      files,
      has_resume: Boolean(activeSummary || files.length > 0),
    },
  };
};

const selectResumeResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(body.user_id || '').trim(),
    requireAuth: true,
  });
  const userId = context.userId;
  const fileName = String(body.file_name || '').trim();
  if (!fileName) {
    return { statusCode: 400, payload: { error: 'file_name is required' } };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { statusCode: 404, payload: { error: 'user not found' } };
  }

  const doc = await readResumeDoc({ userId, fileName });
  if (!doc) {
    return { statusCode: 404, payload: { error: 'resume file not found' } };
  }

  let summary = String(doc.meta?.summary || '').trim();
  let resumeStructuredJson = '';
  if (!summary) {
    const structured = await summarizeResumeWithLLM(doc.content);
    summary = structured.summary;
    resumeStructuredJson = JSON.stringify(structured);
    await updateResumeDocMeta({
      userId,
      fileName: doc.name,
      summary,
      originalFilename: doc.meta?.original_filename || doc.name,
    });
  }
  const updated = await setActiveResumeFile({
    userId,
    fileName: doc.name,
    resumeSummary: summary,
    resumeStructuredJson,
  });
  await syncPostgresProfile({
    authUser: context.authUser,
    profile: {
      resumeSummary: updated?.resume_summary || summary,
      resumeStructuredJson,
      activeResumeFile: updated?.active_resume_file || doc.name,
    },
  });

  return {
    statusCode: 200,
    payload: {
      user_id: userId,
      active_resume_file: updated?.active_resume_file || doc.name,
      resume_summary: updated?.resume_summary || summary,
    },
  };
};

const readResumeResponse = async ({ req, queryUserId, fileName }) => {
  const context = await getResolvedUserContext({
    req,
    queryUserId,
    requireAuth: true,
  });
  const userId = context.userId;
  await ensureExampleProfileDocs({ userId, authUser: context.authUser });
  if (!fileName) {
    return { statusCode: 400, payload: { error: 'file_name is required' } };
  }
  const doc = await readResumeDoc({ userId, fileName });
  if (!doc) {
    return { statusCode: 404, payload: { error: 'resume not found' } };
  }

  return {
    statusCode: 200,
    payload: {
      user_id: userId,
      name: doc.name,
      content: doc.content,
      summary: doc.meta?.summary || '',
      original_filename: doc.meta?.original_filename || doc.name,
      updated_at: doc.meta?.updated_at || '',
    },
  };
};

const readJdResponse = async ({ req, queryUserId, fileName }) => {
  const context = await getResolvedUserContext({
    req,
    queryUserId,
    requireAuth: true,
  });
  const userId = context.userId;
  ensureExampleProfileDocs({ userId, authUser: context.authUser });
  if (!fileName) {
    return { statusCode: 400, payload: { error: 'file_name is required' } };
  }
  const doc = await readJdDoc({ userId, fileName });
  if (!doc) {
    return { statusCode: 404, payload: { error: 'jd not found' } };
  }

  return {
    statusCode: 200,
    payload: {
      user_id: userId,
      name: doc.name,
      content: doc.content,
    },
  };
};

const uploadJdResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(body.user_id || '').trim(),
    requireAuth: true,
  });
  const userId = context.userId;
  const jdText = String(body.jd_text || body.job_description || '').trim();
  const filename = String(body.filename || '').trim() || 'jd.md';
  if (!jdText) {
    return { statusCode: 400, payload: { error: 'jd_text is required' } };
  }

  const savedPath = await saveJdDoc({ userId, jdText, filename });
  await ensureLocalUserProfile({
    userId,
    authUser: context.authUser,
    activeJdFile: path.basename(savedPath),
  });
  await syncPostgresProfile({
    authUser: context.authUser,
    profile: {
      activeJdFile: path.basename(savedPath),
    },
  });

  return {
    statusCode: 200,
    payload: {
      user_id: userId,
      active_jd_file: path.basename(savedPath),
      saved_path: savedPath,
    },
  };
};

const jdLibraryResponse = async ({ req, queryUserId }) => {
  const context = await getResolvedUserContext({
    req,
    queryUserId,
    requireAuth: true,
  });
  const userId = context.userId;
  await ensureExampleProfileDocs({ userId, authUser: context.authUser });
  const sqliteUser = await getUserById(userId);
  const postgresUser = await syncPostgresProfile({ authUser: context.authUser });
  const user = mergeProfileUsers(sqliteUser, postgresUser);
  const files = await listJdDocs(userId);

  return {
    statusCode: 200,
    payload: {
      user_id: userId,
      profile: user ? {
        id: user.id,
        name: user.name,
        active_jd_file: user.active_jd_file,
        updated_at: user.updated_at,
      } : null,
      files,
      has_jd: Boolean(user?.active_jd_file || files.length > 0),
    },
  };
};

const selectJdResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(body.user_id || '').trim(),
    requireAuth: true,
  });
  const userId = context.userId;
  const fileName = String(body.file_name || '').trim();
  if (!fileName) {
    return { statusCode: 400, payload: { error: 'file_name is required' } };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { statusCode: 404, payload: { error: 'user not found' } };
  }

  const doc = await readJdDoc({ userId, fileName });
  if (!doc) {
    return { statusCode: 404, payload: { error: 'jd file not found' } };
  }

  const updated = await setActiveJdFile({ userId, fileName: doc.name });
  await syncPostgresProfile({
    authUser: context.authUser,
    profile: {
      activeJdFile: updated?.active_jd_file || doc.name,
    },
  });

  return {
    statusCode: 200,
    payload: {
      user_id: userId,
      active_jd_file: updated?.active_jd_file || doc.name,
    },
  };
};

const deleteResumeResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(body.user_id || '').trim(),
    requireAuth: true,
  });
  const userId = context.userId;
  const fileName = String(body.file_name || '').trim();
  if (!fileName) {
    return { statusCode: 400, payload: { error: 'file_name is required' } };
  }
  const deleted = await deleteResumeDoc({ userId, fileName });
  if (!deleted) {
    return { statusCode: 404, payload: { error: 'resume file not found' } };
  }
  const user = await getUserById(userId);
  if (user && user.active_resume_file === fileName) {
    await setActiveResumeFile({ userId, fileName: '', resumeSummary: '', resumeStructuredJson: '' });
    await syncPostgresProfile({
      authUser: context.authUser,
      profile: {
        resumeSummary: '',
        resumeStructuredJson: '',
        activeResumeFile: '',
      },
    });
  }
  return { statusCode: 200, payload: { deleted: true } };
};

const deleteJdResponse = async ({ req, body }) => {
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(body.user_id || '').trim(),
    requireAuth: true,
  });
  const userId = context.userId;
  const fileName = String(body.file_name || '').trim();
  if (!fileName) {
    return { statusCode: 400, payload: { error: 'file_name is required' } };
  }
  const deleted = await deleteJdDoc({ userId, fileName });
  if (!deleted) {
    return { statusCode: 404, payload: { error: 'jd file not found' } };
  }
  const user = await getUserById(userId);
  if (user && user.active_jd_file === fileName) {
    await setActiveJdFile({ userId, fileName: '' });
    await syncPostgresProfile({
      authUser: context.authUser,
      profile: {
        activeJdFile: '',
      },
    });
  }
  return { statusCode: 200, payload: { deleted: true } };
};

const handleDocumentRoutes = async ({ req, res, url }) => {
  if (req.method === 'POST' && url.pathname === '/v1/resume/parse') {
    try {
      const result = await parseResumeRequest({ req });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/resume/library') {
    try {
      const result = await getResumeLibraryResponse({
        req,
        queryUserId: String(url.searchParams.get('user_id') || '').trim(),
      });
      res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=120');
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/resume/select') {
    try {
      const body = await readBody(req);
      const result = await selectResumeResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/resume/read') {
    try {
      const result = await readResumeResponse({
        req,
        queryUserId: String(url.searchParams.get('user_id') || '').trim(),
        fileName: String(url.searchParams.get('file_name') || '').trim(),
      });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/jd/read') {
    try {
      const result = await readJdResponse({
        req,
        queryUserId: String(url.searchParams.get('user_id') || '').trim(),
        fileName: String(url.searchParams.get('file_name') || '').trim(),
      });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/jd/upload') {
    try {
      const body = await readBody(req);
      const result = await uploadJdResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/v1/jd/library') {
    try {
      const result = await jdLibraryResponse({
        req,
        queryUserId: String(url.searchParams.get('user_id') || '').trim(),
      });
      res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=120');
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/v1/jd/select') {
    try {
      const body = await readBody(req);
      const result = await selectJdResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/resume/delete') {
    try {
      const body = await readBody(req);
      const result = await deleteResumeResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/v1/jd/delete') {
    try {
      const body = await readBody(req);
      const result = await deleteJdResponse({ req, body });
      json(res, result.statusCode, result.payload);
    } catch (error) {
      jsonError(res, error);
    }
    return true;
  }

  return false;
};

async function registerDocumentRoutes(app) {
  app.post('/v1/resume/parse', async (request, reply) => {
    request.raw.body = request.body;
    const parsedMultipart = request.isMultipart()
      ? await readMultipartParts(request)
      : null;
    const result = await parseResumeRequest({
      req: request.raw,
      parsedMultipart,
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/resume/library', async (request, reply) => {
    const result = await getResumeLibraryResponse({
      req: request.raw,
      queryUserId: String(request.query?.user_id || '').trim(),
    });
    reply.header('Cache-Control', 'private, max-age=15, stale-while-revalidate=120');
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/resume/select', async (request, reply) => {
    const result = await selectResumeResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/resume/read', async (request, reply) => {
    const result = await readResumeResponse({
      req: request.raw,
      queryUserId: String(request.query?.user_id || '').trim(),
      fileName: String(request.query?.file_name || '').trim(),
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/jd/read', async (request, reply) => {
    const result = await readJdResponse({
      req: request.raw,
      queryUserId: String(request.query?.user_id || '').trim(),
      fileName: String(request.query?.file_name || '').trim(),
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/jd/upload', async (request, reply) => {
    const result = await uploadJdResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.get('/v1/jd/library', async (request, reply) => {
    const result = await jdLibraryResponse({
      req: request.raw,
      queryUserId: String(request.query?.user_id || '').trim(),
    });
    reply.header('Cache-Control', 'private, max-age=15, stale-while-revalidate=120');
    reply.code(result.statusCode);
    return result.payload;
  });

  app.post('/v1/jd/select', async (request, reply) => {
    const result = await selectJdResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.delete('/v1/resume/delete', async (request, reply) => {
    const result = await deleteResumeResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });

  app.delete('/v1/jd/delete', async (request, reply) => {
    const result = await deleteJdResponse({
      req: request.raw,
      body: request.body || {},
    });
    reply.code(result.statusCode);
    return result.payload;
  });
}

module.exports = {
  handleDocumentRoutes,
  registerDocumentRoutes,
};
