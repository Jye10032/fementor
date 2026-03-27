const { getRequestAuth } = require('./auth');
const {
  getTodayResumeOcrUsageCount,
  upsertAppUserByClerk,
} = require('./postgres');
const {
  getInterviewSession,
  getUserById,
  upsertUser,
} = require('./db');
const { createHttpError, requirePathSegment } = require('./http');

const getResolvedUserContext = async ({
  req,
  bodyUserId = '',
  queryUserId = '',
  requireAuth = false,
  allowDevFallback = true,
}) => {
  const auth = await getRequestAuth(req);
  const authUserId = String(auth.authUser?.clerkUserId || '').trim();
  const fallbackUserId = String(bodyUserId || queryUserId || '').trim();
  const devFallbackUserId = allowDevFallback
    ? String(process.env.DEV_FAKE_USER_ID || '').trim()
    : '';

  const userId = authUserId || fallbackUserId || devFallbackUserId;

  if (requireAuth && !auth.isAuthenticated) {
    throw createHttpError(401, 'unauthorized');
  }

  if (!userId) {
    throw createHttpError(requireAuth ? 401 : 400, requireAuth ? 'unauthorized' : 'user_id is required');
  }

  return {
    ...auth,
    userId,
  };
};

const ensureLocalUserProfile = ({
  userId,
  authUser = null,
  name = undefined,
  resumeSummary = undefined,
  activeResumeFile = undefined,
  activeJdFile = undefined,
}) => {
  upsertUser({
    id: userId,
    name: name !== undefined ? name : authUser?.name || authUser?.email || '',
    resume_summary: resumeSummary,
    active_resume_file: activeResumeFile,
    active_jd_file: activeJdFile,
  });

  return getUserById(userId);
};

const buildViewerPayload = async ({ userId, authUser }) => {
  const user = ensureLocalUserProfile({ userId, authUser });
  const appUser = authUser?.clerkUserId
    ? await upsertAppUserByClerk({
      clerkUserId: authUser.clerkUserId,
      email: authUser.email,
      name: authUser.name,
      avatarUrl: authUser.avatarUrl,
    })
    : null;
  const todayUsageCount = appUser
    ? await getTodayResumeOcrUsageCount({ userId: appUser.id })
    : null;
  const dailyLimit = 1;
  const remainingCount = todayUsageCount === null
    ? dailyLimit
    : Math.max(0, dailyLimit - todayUsageCount);

  return {
    viewer: {
      id: appUser?.id || userId,
      auth_user_id: authUser?.clerkUserId || appUser?.clerk_user_id || userId,
      email: authUser?.email || appUser?.email || null,
      name: authUser?.name || appUser?.name || user?.name || null,
      avatar_url: authUser?.avatarUrl || appUser?.avatar_url || null,
      plan: appUser?.plan || 'free',
      capabilities: {
        can_use_resume_ocr: true,
        daily_resume_ocr_limit: dailyLimit,
        remaining_resume_ocr_count: remainingCount,
      },
    },
  };
};

const ensureSessionOwner = async ({ req, pathname, sessionId, bodyUserId = '', requireSessionId = true }) => {
  const normalizedSessionId = requireSessionId
    ? requirePathSegment(pathname, 4, 'session_id')
    : String(sessionId || '').trim();
  const context = await getResolvedUserContext({
    req,
    bodyUserId: String(bodyUserId || '').trim(),
    requireAuth: true,
  });
  const session = getInterviewSession(normalizedSessionId);
  if (!session) {
    throw createHttpError(404, 'session not found');
  }
  if (session.user_id !== context.userId) {
    throw createHttpError(403, 'forbidden');
  }
  return { context, session, sessionId: normalizedSessionId };
};

module.exports = {
  buildViewerPayload,
  ensureLocalUserProfile,
  ensureSessionOwner,
  getResolvedUserContext,
};
