import {
  ConversationRow,
  InterviewQuestion,
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
    turn.strengths?.length ? `做得较好的点：${turn.strengths.join("，")}。` : "",
    turn.weaknesses?.length ? `接下来优先补强：${turn.weaknesses.join("，")}。` : "",
    turn.standard_answer ? `参考标准答案：${turn.standard_answer}` : "",
    typeof turn.evidence_refs_count === "number"
      ? `本轮命中 ${turn.evidence_refs_count} 条资料佐证${turn.retrieval_strategy ? `，检索策略为 ${getRetrievalStrategyLabel(turn.retrieval_strategy)}` : ""}。`
      : "",
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
    evidence_refs_count: data.evidence_refs_count ?? 0,
    question,
    answer,
  };
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

export function getRetrievalStrategyLabel(strategy?: string | null) {
  if (!strategy) return "等待系统判断";

  const normalized = strategy.toLowerCase();
  if (normalized.includes("resume")) return "优先参考简历内容";
  if (normalized.includes("doc")) return "优先参考资料内容";
  if (normalized.includes("hybrid")) return "简历与资料联合检索";
  if (normalized.includes("llm")) return "系统生成";
  return strategy;
}

export function getStageDisplay(event: Partial<InterviewTurnStageEvent> | null): {
  step: StageStep;
  label: string;
} {
  const step = String(event?.step || "").trim().toLowerCase();
  const message = event?.message?.trim();

  if (step === "saving") {
    return { step: "receiving", label: "正在接收回答" };
  }
  if (step === "intent") {
    return { step: "deciding", label: "正在判断输入类型" };
  }
  if (step === "question_type") {
    return { step: "deciding", label: "正在识别题型与证据来源" };
  }
  if (step === "retrieval") {
    return { step: "retrieving", label: "正在检索相关资料" };
  }
  if (step === "evaluation") {
    return { step: "evaluating", label: "正在生成评分反馈" };
  }
  if (step === "feedback") {
    return { step: "evaluating", label: "正在整理最终评价" };
  }
  if (step === "persist") {
    return { step: "evaluating", label: "正在写入评分结果" };
  }
  if (step === "reply") {
    if (message?.includes("追问")) {
      return { step: "generating_followup", label: message };
    }
    return { step: "deciding", label: message || "正在生成面试官回复" };
  }
  if (step === "planning") {
    if (message?.includes("切换到下一题")) {
      return { step: "transition", label: "正在切换到下一题" };
    }
    return { step: "deciding", label: "正在规划下一步" };
  }

  return {
    step: "evaluating",
    label: message || "系统正在处理你的回答",
  };
}
