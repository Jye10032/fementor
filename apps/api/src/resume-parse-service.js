const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const {
  createResumeParseUsage,
  getResumeParseCacheByHash,
  getTodayResumeOcrUsageCount,
  isPostgresEnabled,
  saveResumeParseCache,
  upsertAppUserByClerk,
} = require('./postgres');
const { readMultipartForm, pickFormValue, readBody, createHttpError } = require('./http');
const { getResolvedUserContext, ensureLocalUserProfile } = require('./request-context');
const { extractResumeTextFromBinary, saveResumeDoc } = require('./resume');
const { summarizeResumeWithLLM } = require('./interview/llm-service');

const getResumeSourceTypeFromFilename = (filename, fallback = 'text') => {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx') return 'docx';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') return 'image';
  return fallback;
};

const buildResumeUsagePayload = (remainingCount, dailyLimit = 1) => ({
  daily_resume_ocr_limit: dailyLimit,
  remaining_resume_ocr_count: remainingCount,
});

const getFastifyMultipartFieldValue = (fields, key) => pickFormValue(fields?.[key]);

const parseResumeRequest = async ({ req, parsedMultipart = null }) => {
  const requestStartedAt = Date.now();
  const isMultipart = Boolean(parsedMultipart)
    || String(req.headers['content-type'] || '').includes('multipart/form-data');
  let fallbackUserId = '';
  let resumeText = '';
  let filename = '';
  let name = '';
  let parseMeta = null;
  let uploadedSourceType = 'text';
  let fileHashInput = '';

  console.log('[resume.parse.request.start]', {
    is_multipart: isMultipart,
  });

  if (isMultipart) {
    const multipartStartedAt = Date.now();
    const multipartPayload = parsedMultipart || await readMultipartForm(req);
    const { fields, files } = multipartPayload;
    console.log('[resume.parse.request.multipart.done]', {
      elapsed_ms: Date.now() - multipartStartedAt,
    });
    fallbackUserId = getFastifyMultipartFieldValue(fields, 'user_id');
    resumeText = getFastifyMultipartFieldValue(fields, 'resume_text');
    filename = getFastifyMultipartFieldValue(fields, 'filename');
    name = getFastifyMultipartFieldValue(fields, 'name');

    const rawFile = parsedMultipart
      ? files.resume_file || null
      : Array.isArray(files.resume_file) ? files.resume_file[0] : files.resume_file;
    if (!resumeText && rawFile) {
      filename = filename || rawFile.originalFilename || rawFile.newFilename || rawFile.filename || 'resume';
      const ext = path.extname(String(filename || '')).toLowerCase();
      uploadedSourceType = ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : 'text';
      const rawBuffer = rawFile.buffer || fs.readFileSync(rawFile.filepath);
      fileHashInput = rawBuffer.toString('base64');
      if (ext === '.pdf' || ext === '.docx') {
        const binaryReadStartedAt = Date.now();
        const parsedResume = await extractResumeTextFromBinary({
          filename,
          buffer: rawBuffer,
        });
        console.log('[resume.parse.request.binary_extract.done]', {
          filename,
          ext,
          elapsed_ms: Date.now() - binaryReadStartedAt,
        });
        resumeText = typeof parsedResume === 'string' ? parsedResume : String(parsedResume?.text || '').trim();
        parseMeta = parsedResume && typeof parsedResume === 'object' ? parsedResume.parse_meta || null : null;
      } else {
        const textReadStartedAt = Date.now();
        resumeText = rawBuffer.toString('utf8').trim();
        console.log('[resume.parse.request.text_read.done]', {
          filename,
          ext,
          text_length: resumeText.length,
          elapsed_ms: Date.now() - textReadStartedAt,
        });
      }
    }
  } else {
    const bodyStartedAt = Date.now();
    const body = await readBody(req);
    console.log('[resume.parse.request.body.done]', {
      elapsed_ms: Date.now() - bodyStartedAt,
    });
    fallbackUserId = String(body.user_id || '').trim();
    resumeText = String(body.resume_text || '').trim();
    filename = String(body.filename || '').trim();
    name = String(body.name || '').trim();
    const fileBase64 = String(body.file_base64 || '').trim();
    if (!resumeText && fileBase64) {
      const binaryReadStartedAt = Date.now();
      const parsedResume = await extractResumeTextFromBinary({ filename, fileBase64 });
      console.log('[resume.parse.request.binary_extract.done]', {
        filename,
        ext: path.extname(String(filename || '')).toLowerCase(),
        elapsed_ms: Date.now() - binaryReadStartedAt,
      });
      uploadedSourceType = path.extname(String(filename || '')).toLowerCase() === '.pdf' ? 'pdf' : 'docx';
      fileHashInput = fileBase64;
      resumeText = typeof parsedResume === 'string' ? parsedResume : String(parsedResume?.text || '').trim();
      parseMeta = parsedResume && typeof parsedResume === 'object' ? parsedResume.parse_meta || null : null;
    }
  }

  const context = await getResolvedUserContext({
    req,
    bodyUserId: fallbackUserId,
    requireAuth: uploadedSourceType === 'pdf',
  });

  if (uploadedSourceType === 'pdf' && !context.isAuthenticated) {
    throw createHttpError(401, 'unauthorized');
  }
  if (!resumeText) {
    throw createHttpError(400, 'resume_text is required');
  }

  const sourceType = getResumeSourceTypeFromFilename(filename, uploadedSourceType || 'text');
  const fileHash = createHash('sha256')
    .update(fileHashInput || resumeText)
    .digest('hex');
  const appUser = context.authUser?.clerkUserId
    ? await upsertAppUserByClerk({
      clerkUserId: context.authUser.clerkUserId,
      email: context.authUser.email,
      name: context.authUser.name,
      avatarUrl: context.authUser.avatarUrl,
    })
    : null;
  const businessUserId = appUser?.id || null;

  if (isPostgresEnabled()) {
    const cached = await getResumeParseCacheByHash({ fileHash });
    if (cached) {
      const remainingCount = businessUserId
        ? Math.max(0, 1 - (await getTodayResumeOcrUsageCount({ userId: businessUserId }) || 0))
        : 1;
      if (businessUserId) {
        await createResumeParseUsage({
          userId: businessUserId,
          fileHash,
          sourceType,
          engine: String(cached.parse_meta?.parser || cached.source_type || 'cache'),
          status: 'cached',
          charged: false,
        });
      }

      const savedPath = saveResumeDoc({
        userId: context.userId,
        resumeText: cached.parsed_text,
        filename,
        summary: cached.summary,
        originalFilename: filename,
      });
      ensureLocalUserProfile({
        userId: context.userId,
        authUser: context.authUser,
        name,
        resumeSummary: cached.summary,
        activeResumeFile: path.basename(savedPath),
      });

      return {
        statusCode: 200,
        payload: {
          user_id: context.userId,
          filename: path.basename(savedPath),
          resume_text: cached.parsed_text,
          resume_summary: cached.summary,
          saved_path: savedPath,
          parse_meta: cached.parse_meta,
          usage: buildResumeUsagePayload(remainingCount),
          cache_hit: true,
        },
      };
    }

    if (sourceType === 'pdf' && businessUserId) {
      const usedCount = await getTodayResumeOcrUsageCount({ userId: businessUserId });
      if ((usedCount || 0) >= 1) {
        await createResumeParseUsage({
          userId: businessUserId,
          fileHash,
          sourceType,
          engine: parseMeta?.parser || 'volcengine',
          status: 'blocked',
          charged: false,
          failureReason: 'resume_ocr_quota_exceeded',
        });
        return {
          statusCode: 429,
          payload: { error: 'resume_ocr_quota_exceeded' },
        };
      }
    }
  }

  console.log('[resume.parse.request.ready]', {
    user_id: context.userId,
    filename,
    source_type: sourceType,
    file_hash: fileHash,
    text_length: resumeText.length,
    parser: parseMeta?.parser || 'plain_text',
    elapsed_ms: Date.now() - requestStartedAt,
  });

  const summaryStartedAt = Date.now();
  const resumeStructured = await summarizeResumeWithLLM(resumeText);
  const summary = resumeStructured.summary;
  console.log('[resume.parse.request.summary.done]', {
    elapsed_ms: Date.now() - summaryStartedAt,
  });
  const saveStartedAt = Date.now();
  const savedPath = saveResumeDoc({
    userId: context.userId,
    resumeText,
    filename,
    summary,
    originalFilename: filename,
  });
  console.log('[resume.parse.request.save.done]', {
    saved_path: savedPath,
    elapsed_ms: Date.now() - saveStartedAt,
  });
  ensureLocalUserProfile({
    userId: context.userId,
    authUser: context.authUser,
    name,
    resumeSummary: summary,
    resumeStructuredJson: JSON.stringify(resumeStructured),
    activeResumeFile: path.basename(savedPath),
  });

  if (isPostgresEnabled()) {
    await saveResumeParseCache({
      userId: businessUserId,
      fileHash,
      sourceType,
      parsedText: resumeText,
      summary,
      parseMeta: parseMeta || {
        parser: sourceType === 'pdf' ? 'volcengine' : sourceType === 'docx' ? 'mammoth' : 'plain_text',
        used_ocr: sourceType === 'pdf',
        quality: 'good',
        original_filename: filename,
      },
      originalFilename: filename,
    });
    if (businessUserId) {
      await createResumeParseUsage({
        userId: businessUserId,
        fileHash,
        sourceType,
        engine: parseMeta?.parser || (sourceType === 'pdf' ? 'volcengine' : sourceType === 'docx' ? 'mammoth' : 'manual'),
        status: 'success',
        charged: sourceType === 'pdf' || sourceType === 'image',
      });
    }
  }

  const remainingCount = businessUserId
    ? Math.max(0, 1 - (await getTodayResumeOcrUsageCount({ userId: businessUserId }) || 0))
    : 1;
  console.log('[resume.parse.request.done]', {
    user_id: context.userId,
    filename,
    total_elapsed_ms: Date.now() - requestStartedAt,
  });

  return {
    statusCode: 200,
    payload: {
      user_id: context.userId,
      filename: path.basename(savedPath),
      resume_text: resumeText,
      resume_summary: summary,
      saved_path: savedPath,
      parse_meta: parseMeta,
      usage: buildResumeUsagePayload(remainingCount),
      cache_hit: false,
    },
  };
};

module.exports = {
  parseResumeRequest,
};
