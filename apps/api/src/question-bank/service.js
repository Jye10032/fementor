const { randomUUID } = require('crypto');
const {
  addUserQuestionBankItem,
  createQuestionAttempt,
  getQuestionBankItemById,
  listPracticeQuestions,
  listPracticeUserQuestionBank,
  listQuestionBank,
  listUserQuestionBank,
  markQuestionReviewed,
  saveQuestionBankItems,
  getUserQuestionBankItemById,
  updateUserQuestionBankReviewState,
  upsertQuestionSource,
} = require('../db');

const inferQuestionSourceType = (sourceQuestion) => {
  if (sourceQuestion?.source === 'experience') return 'experience';
  return 'interview';
};

const normalizeSourceRefId = ({ sourceType, sourceQuestion, turn }) => {
  if (sourceType === 'experience') {
    const raw = String(sourceQuestion?.source_ref || '').trim();
    if (raw.startsWith('experience:')) {
      return raw.slice('experience:'.length) || turn.id;
    }
  }

  return String(sourceQuestion?.id || turn.id);
};

const buildQuestionSourcePayload = ({ chapter, sessionId, turn, sourceQuestion }) => {
  const sourceType = inferQuestionSourceType(sourceQuestion);
  return {
    sourceType,
    sourceRefId: normalizeSourceRefId({ sourceType, sourceQuestion, turn }),
    canonicalQuestion: String(turn.question || '').trim(),
    questionText: String(turn.question || '').trim(),
    normalizedQuestion: String(turn.question || '').trim(),
    category: String(sourceQuestion?.question_type || '').trim() || 'interview',
    difficulty: String(sourceQuestion?.difficulty || '').trim() || (turn.score >= 75 ? 'medium' : 'easy'),
    track: 'frontend',
    chapter,
    knowledgePoints: Array.isArray(turn.weaknesses) ? turn.weaknesses.slice(0, 3) : [],
    expectedPoints: Array.isArray(sourceQuestion?.expected_points) ? sourceQuestion.expected_points : [],
    metadata: {
      source_session_id: sessionId,
      source_turn_id: turn.id,
      source_question_id: sourceQuestion?.id || null,
      source_question_type: sourceQuestion?.question_type || '',
      source_question_source: sourceQuestion?.source || '',
    },
  };
};

const mapUserQuestionBankItemToLegacyShape = (item) => {
  const metadata = item.metadata || {};
  const question = String(item.custom_question_text || item.question_text || item.canonical_question || '').trim();
  return {
    id: item.id,
    user_id: item.user_id,
    source_session_id: metadata.source_session_id || null,
    source_turn_id: metadata.source_turn_id || null,
    source_question_id: metadata.source_question_id || item.question_source_id || null,
    source_question_type: metadata.source_question_type || item.category || 'unknown',
    source_question_source: metadata.source_question_source || item.source_type || item.source_channel || 'unknown',
    chapter: item.chapter || '',
    question,
    difficulty: item.difficulty || 'medium',
    tags: Array.isArray(item.knowledge_points) ? item.knowledge_points : [],
    weakness_tag: item.weakness_tag || '',
    next_review_at: item.next_review_at || null,
    review_status: item.review_status || 'pending',
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
};

const promoteInterviewRetrospectQuestions = ({
  session,
  sessionId,
  chapter,
  turns,
  questionMap,
  nextReviewAt,
}) => {
  const legacyItems = [];
  let sourceCreated = 0;
  let sourceUpdated = 0;
  let bankCreated = 0;
  let bankUpdated = 0;

  for (const turn of turns) {
    const sourceQuestion = turn.question_id ? questionMap.get(turn.question_id) : null;
    const sourceResult = upsertQuestionSource(buildQuestionSourcePayload({
      chapter,
      sessionId,
      turn,
      sourceQuestion,
    }));
    if (sourceResult.created) {
      sourceCreated += 1;
    } else {
      sourceUpdated += 1;
    }

    const bankResult = addUserQuestionBankItem({
      id: randomUUID(),
      userId: session.user_id,
      questionSourceId: sourceResult.item.id,
      track: sourceResult.item.track || 'frontend',
      chapter,
      reviewStatus: 'pending',
      weaknessTag: (turn.weaknesses || [])[0] || '',
      nextReviewAt,
      sourceChannel: inferQuestionSourceType(sourceQuestion),
    });
    if (bankResult.created) {
      bankCreated += 1;
    } else {
      bankUpdated += 1;
    }

    legacyItems.push({
      id: randomUUID(),
      user_id: session.user_id,
      source_session_id: sessionId,
      source_turn_id: turn.id,
      source_question_id: sourceQuestion?.id || null,
      source_question_type: sourceQuestion?.question_type || '',
      source_question_source: sourceQuestion?.source || '',
      chapter,
      question: turn.question,
      difficulty: sourceQuestion?.difficulty || (turn.score >= 75 ? 'medium' : 'easy'),
      tags: [
        '面试复盘',
        ...(sourceQuestion?.question_type ? [sourceQuestion.question_type] : []),
        ...(sourceQuestion?.source ? [sourceQuestion.source] : []),
        ...(turn.weaknesses || []).slice(0, 2),
      ],
      weakness_tag: (turn.weaknesses || [])[0] || '',
      next_review_at: nextReviewAt,
      review_status: 'pending',
    });
  }

  const legacyStat = saveQuestionBankItems({ items: legacyItems });

  return {
    items: legacyItems,
    legacyStat,
    sourceCreated,
    sourceUpdated,
    bankCreated,
    bankUpdated,
  };
};

const promoteQuestionSource = ({
  sourceType,
  sourceRefId,
  canonicalQuestion,
  questionText,
  normalizedQuestion = '',
  category = '',
  difficulty = 'medium',
  track = 'frontend',
  chapter = '',
  knowledgePoints = [],
  expectedPoints = [],
  metadata = {},
}) =>
  upsertQuestionSource({
    sourceType,
    sourceRefId,
    canonicalQuestion,
    questionText,
    normalizedQuestion,
    category,
    difficulty,
    track,
    chapter,
    knowledgePoints,
    expectedPoints,
    metadata,
  });

const addQuestionToUserBank = ({
  userId,
  questionSourceId,
  track = '',
  chapter = '',
  customQuestionText = '',
  sourceChannel = '',
}) =>
  addUserQuestionBankItem({
    id: randomUUID(),
    userId,
    questionSourceId,
    track,
    chapter,
    customQuestionText,
    sourceChannel,
  });

const listStructuredUserQuestionBank = ({
  userId,
  track,
  chapter,
  reviewStatus,
  limit = 20,
  offset = 0,
}) =>
  listUserQuestionBank({
    userId,
    track,
    chapter,
    reviewStatus,
    limit,
    offset,
  });

const recordQuestionAttempt = ({
  userId,
  userQuestionBankId,
  sessionType,
  sessionId,
  answer,
  score,
  strengths = [],
  weaknesses = [],
  evidenceRefs = [],
  feedback = '',
  mastered = false,
  nextReviewAt = null,
}) => {
  const userQuestionBankItem = getUserQuestionBankItemById(userQuestionBankId);
  if (!userQuestionBankItem || userQuestionBankItem.user_id !== userId) {
    return null;
  }

  const item = createQuestionAttempt({
    id: randomUUID(),
    userId,
    userQuestionBankId,
    sessionType,
    sessionId,
    answer,
    score,
    strengths,
    weaknesses,
    evidenceRefs,
    feedback,
    mastered,
    nextReviewAt,
  });

  return item;
};

const listUnifiedQuestionBank = ({ userId, chapter, limit = 20 }) => {
  const next = listUserQuestionBank({
    userId,
    chapter,
    limit,
  });

  if ((next.total || 0) > 0) {
    return next.items.map(mapUserQuestionBankItemToLegacyShape);
  }

  return listQuestionBank({ userId, chapter, limit });
};

const listUnifiedPracticeQuestions = ({
  userId,
  chapter,
  limit = 10,
  includeFuture = false,
}) => {
  const nextItems = listPracticeUserQuestionBank({
    userId,
    chapter,
    limit,
    includeFuture,
  });

  if (nextItems.length > 0) {
    return nextItems.map(mapUserQuestionBankItemToLegacyShape);
  }

  return listPracticeQuestions({
    userId,
    chapter,
    limit,
    includeFuture,
  });
};

const reviewUnifiedQuestion = ({
  userId,
  questionId,
  reviewStatus,
  nextReviewAt,
}) => {
  const currentUserQuestionBankItem = getUserQuestionBankItemById(questionId);
  if (currentUserQuestionBankItem) {
    if (currentUserQuestionBankItem.user_id !== userId) {
      return null;
    }

    const updated = updateUserQuestionBankReviewState({
      id: questionId,
      reviewStatus,
      nextReviewAt,
    });

    if (!updated) return null;

    return {
      id: updated.id,
      review_status: updated.review_status,
      next_review_at: updated.next_review_at,
      storage: 'user_question_bank',
    };
  }

  const currentLegacyQuestion = getQuestionBankItemById(questionId);
  if (currentLegacyQuestion && currentLegacyQuestion.user_id !== userId) {
    return null;
  }

  const ok = markQuestionReviewed({
    questionId,
    userId,
    reviewStatus,
    nextReviewAt,
  });

  if (!ok) return null;

  return {
    id: questionId,
    review_status: reviewStatus,
    next_review_at: nextReviewAt || null,
    storage: 'question_bank',
  };
};

module.exports = {
  addQuestionToUserBank,
  listUnifiedPracticeQuestions,
  listUnifiedQuestionBank,
  listStructuredUserQuestionBank,
  promoteInterviewRetrospectQuestions,
  promoteQuestionSource,
  recordQuestionAttempt,
  reviewUnifiedQuestion,
};
