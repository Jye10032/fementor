const { getRequestAuth } = require('./auth');
const {
  getTodayResumeOcrUsageCount,
  isPostgresEnabled,
  resolveUserRoleByEmail,
  upsertAppUserByClerk,
} = require('./postgres');
const {
  getExperienceStorageDriver,
  getExperienceStorageTarget,
} = require('./experience/store');
const {
  countSessionsStartedOnUtcDate,
  getInterviewSession,
  getUserById,
  upsertUser,
} = require('./db');
const { createHttpError, requirePathSegment } = require('./http');

const getAppRuntimeMode = () =>
  String(process.env.APP_RUNTIME_MODE || 'local').trim().toLowerCase() === 'cloud'
    ? 'cloud'
    : 'local';

const getPublicSourceDriver = () => {
  const configuredDriver = String(process.env.PUBLIC_SOURCE_DRIVER || '').trim().toLowerCase();
  if (configuredDriver === 'postgres' || configuredDriver === 'sqlite') {
    return configuredDriver;
  }

  return isPostgresEnabled() ? 'postgres' : 'sqlite';
};

const getRuntimeStorageTarget = () => {
  if (getPublicSourceDriver() !== 'postgres') {
    return 'local_sqlite';
  }

  return getAppRuntimeMode() === 'cloud' ? 'remote_postgres' : 'local_postgres';
};

const isLocalRuntime = () => getAppRuntimeMode() === 'local';

const isLocalDefaultAdminEnabled = () => String(process.env.LOCAL_DEFAULT_ADMIN || '1').trim() !== '0';

const getLocalDefaultAdminUserId = () => String(process.env.DEV_FAKE_USER_ID || 'local_admin').trim() || 'local_admin';

const getNormalizedRole = (value) => String(value || '').trim().toLowerCase() === 'admin' ? 'admin' : 'user';

const resolveViewerRole = ({ authUser = null, appUser = null }) => {
  if (isLocalRuntime() && isLocalDefaultAdminEnabled()) {
    return 'admin';
  }
  if (getNormalizedRole(appUser?.role) === 'admin') {
    return 'admin';
  }
  if (resolveUserRoleByEmail(authUser?.email) === 'admin') {
    return 'admin';
  }
  return 'user';
};

const canManagePublicSources = ({ runtimeMode, role }) =>
  runtimeMode === 'local' || getNormalizedRole(role) === 'admin';

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

const getResolvedViewerAccessContext = async ({
  req,
  bodyUserId = '',
  queryUserId = '',
}) => {
  const runtimeMode = getAppRuntimeMode();
  const auth = await getRequestAuth(req);
  const authUserId = String(auth.authUser?.clerkUserId || '').trim();
  const fallbackUserId = String(bodyUserId || queryUserId || '').trim();
  const userId = authUserId
    || fallbackUserId
    || (runtimeMode === 'local' && isLocalDefaultAdminEnabled() ? getLocalDefaultAdminUserId() : '');

  if (!userId) {
    throw createHttpError(runtimeMode === 'cloud' ? 401 : 400, runtimeMode === 'cloud' ? 'unauthorized' : 'user_id is required');
  }

  let appUser = null;
  if (auth.authUser?.clerkUserId) {
    appUser = await upsertAppUserByClerk({
      clerkUserId: auth.authUser.clerkUserId,
      email: auth.authUser.email,
      name: auth.authUser.name,
      avatarUrl: auth.authUser.avatarUrl,
    });
  }

  const role = resolveViewerRole({ authUser: auth.authUser, appUser });

  return {
    ...auth,
    appUser,
    role,
    runtimeMode,
    publicSourceDriver: getPublicSourceDriver(),
    storageTarget: getRuntimeStorageTarget(),
    experienceStorageDriver: getExperienceStorageDriver(),
    experienceStorageTarget: getExperienceStorageTarget(),
    canManagePublicSources: canManagePublicSources({ runtimeMode, role }),
    userId,
  };
};

const assertCanManagePublicSources = (context) => {
  if (context.runtimeMode === 'cloud' && !context.isAuthenticated) {
    throw createHttpError(401, 'unauthorized');
  }
  if (!context.canManagePublicSources) {
    throw createHttpError(403, 'forbidden');
  }
};

const ensureLocalUserProfile = async ({
  userId,
  authUser = null,
  name = undefined,
  resumeSummary = undefined,
  resumeStructuredJson = undefined,
  activeResumeFile = undefined,
  activeJdFile = undefined,
}) => {
  await upsertUser({
    id: userId,
    name: name !== undefined ? name : authUser?.name || authUser?.email || '',
    resume_summary: resumeSummary,
    resume_structured_json: resumeStructuredJson,
    active_resume_file: activeResumeFile,
    active_jd_file: activeJdFile,
  });

  return getUserById(userId);
};

const buildViewerPayload = async ({ userId, authUser }) => {
  const user = await ensureLocalUserProfile({ userId, authUser });
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
  const dailyInterviewLimit = 1;
  const todayInterviewCount = await countSessionsStartedOnUtcDate({ userId });
  const remainingInterviewCount = Math.max(0, dailyInterviewLimit - todayInterviewCount);
  const runtimeMode = getAppRuntimeMode();
  const role = resolveViewerRole({ authUser, appUser });
  const storageTarget = getRuntimeStorageTarget();
  const experienceStorageTarget = getExperienceStorageTarget();

  return {
    viewer: {
      id: appUser?.id || userId,
      auth_user_id: authUser?.clerkUserId || appUser?.clerk_user_id || userId,
      email: authUser?.email || appUser?.email || null,
      name: authUser?.name || appUser?.name || user?.name || null,
      avatar_url: authUser?.avatarUrl || appUser?.avatar_url || null,
      role,
      plan: appUser?.plan || 'free',
      runtime_mode: runtimeMode,
      public_source_driver: getPublicSourceDriver(),
      public_source_storage_target: storageTarget,
      experience_storage_driver: getExperienceStorageDriver(),
      experience_storage_target: experienceStorageTarget,
      capabilities: {
        can_use_resume_ocr: true,
        daily_resume_ocr_limit: dailyLimit,
        remaining_resume_ocr_count: remainingCount,
        daily_interview_session_limit: dailyInterviewLimit,
        remaining_interview_session_count: remainingInterviewCount,
        can_manage_public_sources: canManagePublicSources({ runtimeMode, role }),
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
  const session = await getInterviewSession(normalizedSessionId);
  if (!session) {
    throw createHttpError(404, 'session not found');
  }
  if (session.user_id !== context.userId) {
    throw createHttpError(403, 'forbidden');
  }
  return { context, session, sessionId: normalizedSessionId };
};

module.exports = {
  assertCanManagePublicSources,
  buildViewerPayload,
  canManagePublicSources,
  ensureLocalUserProfile,
  ensureSessionOwner,
  getAppRuntimeMode,
  getExperienceStorageDriver,
  getExperienceStorageTarget,
  getPublicSourceDriver,
  getResolvedViewerAccessContext,
  getResolvedUserContext,
  getRuntimeStorageTarget,
};
