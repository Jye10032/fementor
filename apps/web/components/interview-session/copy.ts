import {
  ConversationRow,
  InterviewQuestion,
  InterviewTurnHistoryItem,
  InterviewTurnStageEvent,
  StageStep,
  TurnRecord,
  TurnResponse,
  TurnHistoryResponse,
} from "./types";

export const questionTypeLabel: Record<InterviewQuestion["question_type"], string> = {
  basic: "基础题",
  knowledge: "知识题",
  project: "项目题",
  scenario: "场景题",
  follow_up: "追问题",
};

export const difficultyLabel: Record<InterviewQuestion["difficulty"], string> = {
  easy: "简单",
  medium: "中等",
  hard: "较难",
};

export const sourceLabel: Record<InterviewQuestion["source"], string> = {
  resume: "简历提取",
  doc: "资料提取",
  llm: "系统生成",
  experience: "近期面经",
};

export const queueStatusLabel: Record<InterviewQuestion["status"], string> = {
  pending: "待回答",
  asked: "进行中",
  answered: "已完成",
  skipped: "已跳过",
};

export function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function buildEvaluationNarration(turn: TurnRecord) {
  if (turn.evaluation_text?.trim()) return turn.evaluation_text.trim();

  return [
    typeof turn.score === "number" ? `本轮得分 ${turn.score} 分。` : "",
    turn.feedback ? `总体评价：${turn.feedback}` : "",
    turn.strengths?.length ? `做得较好的点：${turn.strengths.map(s => s.replace(/[。，；、,;.]+$/, "")).join("，")}。` : "",
    turn.weaknesses?.length ? `接下来优先补强：${turn.weaknesses.map(s => s.replace(/[。，；、,;.]+$/, "")).join("，")}。` : "",
    turn.standard_answer ? `参考标准答案：${turn.standard_answer}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function getConversationLabel(row: ConversationRow) {
  if (row.kind === "evaluation") return "AI 评价";
  if (row.kind === "reply") return "面试官";
  if (row.kind === "notice") return "系统提示";
  return "你";
}

export function normalizeTurnRecord(data: TurnResponse, question: string, answer: string): TurnRecord {
  return {
    ...data,
    strengths: data.strengths || [],
    weaknesses: data.weaknesses || [],
    question,
    answer,
  };
}

export function normalizePersistedTurnRecord(item: InterviewTurnHistoryItem): TurnRecord {
  return {
    session_id: item.session_id,
    question_id: item.question_id || null,
    turn_id: item.id,
    turn_index: item.turn_index,
    handled_as: "answer",
    score: item.score,
    strengths: item.strengths || [],
    weaknesses: item.weaknesses || [],
    question: item.question,
    answer: item.answer,
  };
}

export function buildConversationRowsFromTurns(turns: TurnRecord[]): ConversationRow[] {
  return turns.flatMap((turn) => [
    {
      id: `history-answer-${turn.turn_id || turn.turn_index}`,
      role: "user",
      kind: "answer",
      content: turn.answer,
    },
    {
      id: `history-evaluation-${turn.turn_id || turn.turn_index}`,
      role: "assistant",
      kind: "evaluation",
      content: buildEvaluationNarration(turn),
    },
  ]);
}

export function restoreServerHistory(data: TurnHistoryResponse) {
  const submissions = data.submissions || [];
  const completed = new Map(submissions.filter((item) => item.result.turn_id).map((item) => [item.result.turn_id, item]));
  const turns = data.items.map((item) => {
    const saved = completed.get(item.id);
    return saved ? normalizeTurnRecord(saved.result, saved.question, saved.answer) : normalizePersistedTurnRecord(item);
  });
  const events = [
    ...data.items.filter((item) => !completed.has(item.id)).map((item) => ({
      created_at: item.created_at, complete: false,
      rows: buildConversationRowsFromTurns([normalizePersistedTurnRecord(item)]),
    })),
    ...submissions.map((item) => ({ created_at: item.created_at, complete: true, rows: [
      { id: `submission-answer-${item.id}`, role: "user", kind: "answer", content: item.answer },
      { id: `submission-evaluation-${item.id}`, role: "assistant", kind: item.result.handled_as === "answer" ? "evaluation" : "reply",
        decision: item.result.agent_decision,
        content: item.result.evaluation_text || item.result.reply_text || buildEvaluationNarration(normalizeTurnRecord(item.result, item.question, item.answer)) },
    ] as ConversationRow[] })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { turns, events };
}

// Keep older cached dialogue (including clarification), while reconciling saved
// responses by stable IDs. The content fallback migrates pre-submission caches.
export function mergeHistoryRows(previous: ConversationRow[], events: ReturnType<typeof restoreServerHistory>["events"]) {
  const rows = [...previous];
  const matched = new Set<number>();
  for (const event of events) {
    const [answer, evaluation] = event.rows;
    let index = rows.findIndex((row) => row.id === answer.id);
    if (index < 0) index = rows.findIndex((row, i) => !matched.has(i)
      && !/^(submission|history)-answer-/.test(row.id)
      && row.kind === "answer" && row.content === answer.content && ["evaluation", "reply", "notice"].includes(rows[i + 1]?.kind));
    if (index < 0) {
      index = rows.length;
      rows.push(answer, evaluation);
    } else {
      rows[index] = answer;
      // Old turn rows contain only score summaries; retain the richer cache.
      if (["evaluation", "reply", "notice"].includes(rows[index + 1]?.kind)) {
        rows[index + 1] = event.complete ? evaluation : { ...evaluation, content: rows[index + 1].content };
      } else rows.splice(index + 1, 0, evaluation);
    }
    matched.add(index);
  }
  return rows;
}

export function reconcileQueueItems(
  previousItems: InterviewQuestion[],
  currentQuestion: InterviewQuestion,
  data: TurnResponse,
) {
  const insertedFollowUp = Boolean(data.next_question && !previousItems.some((item) => item.id === data.next_question!.id));

  const nextItems = previousItems.map((item) => {
    if (item.id === currentQuestion.id) {
      return { ...item, status: data.current_question_status || item.status };
    }
    if (insertedFollowUp && item.order_no > currentQuestion.order_no) {
      return { ...item, order_no: item.order_no + 1 };
    }
    if (data.next_question && item.id === data.next_question.id) {
      return {
        ...item,
        ...data.next_question,
        status: data.next_question.status as InterviewQuestion["status"],
      };
    }
    return item;
  });

  if (data.next_question && !nextItems.some((item) => item.id === data.next_question?.id)) {
    nextItems.push(data.next_question as InterviewQuestion);
  }

  return [...nextItems].sort((a, b) => a.order_no - b.order_no);
}

export function getStageDisplay(event: Partial<InterviewTurnStageEvent> | null): {
  step: StageStep;
  label: string;
} {
  const step = String(event?.step || "").trim().toLowerCase();
  const message = event?.message?.trim();

  const stages: Record<string, { step: StageStep; label: string }> = {
    preparing: { step: "receiving", label: "正在接收回答" },
    saving: { step: "receiving", label: "正在接收回答" },
    saved: { step: "preparing", label: "回答已保存" },
    environment_preparing: { step: "preparing", label: "正在准备分析" },
    expert_preparing: { step: "preparing", label: "正在准备专家分析" },
    intent: { step: "deciding", label: "正在理解回答" },
    question_type: { step: "evaluating", label: "正在分析回答" },
    evaluation: { step: "evaluating", label: "面试官正在分析回答" },
    expert_evaluation: { step: "evaluating", label: "评分专家正在评估回答" },
    expert_question: { step: "generating_followup", label: "问题专家正在准备提问" },
    director_deciding: { step: "deciding", label: "面试官正在决定下一步" },
    feedback: { step: "deciding", label: "正在整理反馈" },
    planning: { step: "deciding", label: "正在决定下一步" },
    reply: { step: "deciding", label: "正在整理回复" },
    persist: { step: "persisting", label: "正在保存面试进度" },
  };
  const display = stages[step] || { step: "evaluating" as const, label: "正在处理本轮回答" };
  return { ...display, label: message || display.label };
}
