const { getContextPolicy, countTokens, excerpt, contextTooLarge } = require('./token-budget');

const rawTurn = (turn) => JSON.stringify({ turn_index: turn.turn_index, question: turn.question,
  answer: turn.answer, score: turn.score, strengths: turn.strengths, weaknesses: turn.weaknesses });

// Complete mandatory material is never truncated. Older context is explicitly
// summarized only when the complete history no longer fits the request budget.
function buildBudgetedTurnContext({ input, turns, codex = false, policy = getContextPolicy(), buildBundle, serializeTurn = rawTurn, additionalInputReserve = 0 }) {
  policy = { ...policy, inputTokens: policy.inputTokens - additionalInputReserve };
  const ordered = [...(turns || [])].sort((a, b) => a.turn_index - b.turn_index);
  const envelope = (history) => {
    const data = { ...input, interviewContext: history };
    return JSON.stringify(buildBundle ? buildBundle(data) : codex
      ? require('../agent-runtime/codex/evaluation').buildEvaluationBundle(data)
      : require('./llm-service').buildUnifiedTurnMessages(data));
  };
  const measure = (history) => {
    const serialized = envelope(history);
    return { tokens: countTokens(serialized, policy.encoding), bytes: Buffer.byteLength(serialized) };
  };
  const fits = (history) => {
    const size = measure(history);
    return size.tokens <= policy.inputTokens && size.bytes <= policy.maxBytes;
  };
  if (!fits('')) throw contextTooLarge();
  const all = ordered.map(serializeTurn).join('\n');
  let contextText = all, selected = ordered, summarized = 0;
  if (!fits(all)) {
    selected = [];
    let summary = '';
    const baseTokens = measure('').tokens;
    const summaryBudget = Math.min(2048, Math.floor((policy.inputTokens - baseTokens) / 4));
    const compose = () => `${summary ? `历史压缩摘录（非完整原文，不替代原始证据）：\n${summary}\n` : ''}完整历史轮次：\n${[...selected].sort((a, b) => a.turn_index - b.turn_index).map(serializeTurn).join('\n')}`;
    // Prioritize the latest two turns, then lexical matches to this question,
    // then recency. Only whole original turns are selected.
    const terms = [...new Set(String(input.question || '').toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]{2}/gu) || [])];
    const recent = ordered.slice(-2).reverse();
    const relevance = ordered.slice(0, -2).map((turn) => ({ turn, rank: terms.reduce((score, term) =>
      score + (serializeTurn(turn).toLowerCase().includes(term) ? 1 : 0), 0) }))
      .sort((a, b) => b.rank - a.rank || b.turn.turn_index - a.turn.turn_index).map(({ turn }) => turn);
    for (const turn of [...recent, ...relevance]) {
      selected.push(turn);
      if (!fits(compose()) || measure(compose()).tokens > policy.inputTokens - summaryBudget) selected.pop();
    }
    const remaining = ordered.filter((turn) => !selected.includes(turn));
    // Extractive summaries use saved facts, never an invented reconstruction.
    // Share the summary allowance across omitted turns; report any actual loss.
    const perField = Math.max(8, Math.min(96, Math.floor(summaryBudget / Math.max(1, remaining.length) / 4)));
    for (const turn of [...remaining].reverse()) {
      const compact = JSON.stringify({ turn: turn.turn_index,
        question: excerpt(turn.question, perField, policy.encoding),
        answer_excerpt: excerpt(turn.answer, perField * 2, policy.encoding), score: turn.score,
        action: turn.action, reply_excerpt: excerpt(turn.reply_text, perField, policy.encoding),
        weaknesses: excerpt((turn.weaknesses || []).join('；'), perField, policy.encoding) });
      const previous = summary;
      summary = `${compact}\n${summary}`;
      if (!fits(compose())) { summary = previous; continue; }
      summarized++;
    }
    contextText = compose();
    if (!fits(contextText)) contextText = '';
  }
  const size = measure(contextText);
  return { contextText, summary: '', openPoints: [], metadata: {
    encoding: policy.encoding, window_tokens: policy.windowTokens, input_budget: policy.inputTokens,
    estimated_input_tokens: size.tokens, additional_input_reserve: additionalInputReserve, request_bytes: size.bytes, total_turns: ordered.length,
    full_turns: selected.length, summarized_turns: summarized, omitted_turns: ordered.length - selected.length - summarized, compacted: selected.length < ordered.length,
  } };
}

module.exports = { buildBudgetedTurnContext };
