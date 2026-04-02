import {
  ConversationRow,
  InterviewQuestion,
  InterviewTurnHistoryItem,
  InterviewTurnStageEvent,
  StageStep,
  TurnRecord,
  TurnResponse,
} from "./types";

export const questionTypeLabel: Record<InterviewQuestion["question_type"], string> = {
  basic: "基础题",
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

export function reconcileQueueItems(
  previousItems: InterviewQuestion[],
  currentQuestion: InterviewQuestion,
  data: TurnResponse,
) {
  const insertedFollowUp = data.next_question?.question_type === "follow_up";

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

  if (step === "saving") {
    return { step: "receiving", label: "接收回答" };
  }
  if (step === "intent") {
    return { step: "receiving", label: "接收回答" };
  }
  if (step === "question_type") {
    return { step: "evaluating", label: "评估回答" };
  }
  if (step === "evaluation") {
    return { step: "evaluating", label: "评估回答" };
  }
  if (step === "feedback") {
    return { step: "evaluating", label: "评估回答" };
  }
  if (step === "persist") {
    return { step: "completed", label: "数据整理入库" };
  }
  if (step === "reply") {
    return { step: "transition", label: "准备下一题" };
  }
  if (step === "planning") {
    return { step: "transition", label: "准备下一题" };
  }

  return {
    step: "evaluating",
    label: message || "评估回答",
  };
}
