const classifyQuestionType = async ({
  queuedQuestionType = '',
}) => {
  const normalizedType = String(queuedQuestionType || '').trim();
  return {
    question_type: normalizedType || 'project',
    reason: normalizedType ? '沿用当前题目类型。' : '默认按项目题处理。',
  };
};

module.exports = {
  classifyQuestionType,
};
