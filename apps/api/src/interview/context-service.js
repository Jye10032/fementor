const { jsonCompletion } = require('../llm');

const INTERVIEW_CONTEXT_RAW_BUDGET = 2200;
const INTERVIEW_CONTEXT_SUMMARY_BUDGET = 900;

const formatTurnForContext = (turn) => [
  `Q${turn.turn_index}: ${String(turn.question || '').trim()}`,
  `A${turn.turn_index}: ${String(turn.answer || '').trim()}`,
  `score=${turn.score || 0}`,
  `weaknesses=${(turn.weaknesses || []).join('、') || '无'}`,
].join('\n');

const summarizeInterviewOverflow = async ({ overflowTurns, currentQuestion, sessionContext }) => {
  if (overflowTurns.length === 0) {
    return { summary: '', open_points: [] };
  }

  const result = await jsonCompletion({
    sessionContext,
    messages: [
      {
        role: 'system',
        content: [
          '你是面试上下文压缩助手。',
          '请把较早的面试历史压缩成一段简短摘要，供后续评分和追问使用。',
          '保留已确认背景、已经讨论过的话题、仍未补足的薄弱点。',
          '输出 JSON：{"summary":"...","open_points":["..."]}。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          current_question: currentQuestion,
          overflow_turns: overflowTurns.map((turn) => ({
            turn_index: turn.turn_index,
            question: String(turn.question || '').slice(0, 180),
            answer: String(turn.answer || '').slice(0, 240),
            score: turn.score,
            strengths: turn.strengths || [],
            weaknesses: turn.weaknesses || [],
          })),
          rules: [
            '摘要控制在 200 字以内',
            '不要重复逐字搬运原回答',
            '优先保留后续追问仍需要知道的信息',
          ],
        }),
      },
    ],
  });

  return {
    summary: result.summary.trim(),
    open_points: result.open_points.map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
  };
};

const buildInterviewContextWindow = async ({
  turns,
  currentQuestion,
  sessionContext,
}) => {
  const orderedTurns = [...(turns || [])].sort((left, right) => (right.turn_index || 0) - (left.turn_index || 0));
  const rawTurns = [];
  const overflowTurns = [];
  let rawLength = 0;

  for (const turn of orderedTurns) {
    const formatted = formatTurnForContext(turn);
    if (rawLength + formatted.length <= INTERVIEW_CONTEXT_RAW_BUDGET || rawTurns.length === 0) {
      rawTurns.push(formatted);
      rawLength += formatted.length;
    } else {
      overflowTurns.push(turn);
    }
  }

  const overflowSummary = await summarizeInterviewOverflow({
    overflowTurns: [...overflowTurns].reverse(),
    currentQuestion,
    sessionContext,
  });
  const recentTurnsOrdered = [...rawTurns].reverse();

  const parts = [];
  if (overflowSummary.summary) {
    parts.push(`较早历史摘要:\n${overflowSummary.summary.slice(0, INTERVIEW_CONTEXT_SUMMARY_BUDGET)}`);
  }
  if (recentTurnsOrdered.length > 0) {
    parts.push(`最近轮次原文:\n${recentTurnsOrdered.join('\n\n')}`);
  }

  return {
    summary: overflowSummary.summary.slice(0, INTERVIEW_CONTEXT_SUMMARY_BUDGET),
    openPoints: overflowSummary.open_points || [],
    recentTurnsText: recentTurnsOrdered.join('\n\n'),
    contextText: parts.join('\n\n').trim(),
  };
};

const summarizeLongTermMemory = async ({
  resumeSummary,
  strengths,
  weaknesses,
  turns,
  questionItems,
}) => {
  const jobQuestionTypes = Array.from(new Set(
    (questionItems || [])
      .filter((item) => item.source_ref === 'job_description' || item.source === 'doc')
      .map((item) => String(item.stem || '').trim())
      .filter(Boolean),
  )).slice(0, 4);

  const result = await jsonCompletion({
    messages: [
      {
        role: 'system',
        content: [
          '你是长期记忆提炼助手。',
          '请基于一场模拟面试的整场表现，提炼可跨场次复用的稳定结论。',
          '只输出 JSON：{"stable_strengths":[],"stable_weaknesses":[],"project_signals":[],"role_fit_signals":[],"recommended_focus":[]}。',
          '不要写临时口误，不要写一次性细节，只保留对下一场面试和后续练习仍然有价值的结论。',
          '每个数组 0-4 条，短句、中文。',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          resume_summary: String(resumeSummary || '').slice(0, 400),
          strengths,
          weaknesses,
          interview_turns: (turns || []).map((turn) => ({
            turn_index: turn.turn_index,
            question: String(turn.question || '').slice(0, 180),
            score: turn.score,
            strengths: turn.strengths || [],
            weaknesses: turn.weaknesses || [],
          })),
          jd_related_questions: jobQuestionTypes,
          rules: [
            'stable_strengths 只保留跨多轮成立的优势',
            'stable_weaknesses 只保留反复出现或影响评分的弱点',
            'project_signals 聚焦项目型能力信号',
            'role_fit_signals 聚焦与 JD 适配或不适配的信号',
            'recommended_focus 必须是后续可执行的练习重点',
          ],
        }),
      },
    ],
  });

  return {
    stable_strengths: result.stable_strengths.map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
    stable_weaknesses: result.stable_weaknesses.map((item) => String(item).trim()).filter(Boolean).slice(0, 5),
    project_signals: result.project_signals.map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
    role_fit_signals: result.role_fit_signals.map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
    recommended_focus: result.recommended_focus.map((item) => String(item).trim()).filter(Boolean).slice(0, 4),
  };
};

module.exports = {
  buildInterviewContextWindow,
  summarizeLongTermMemory,
};
