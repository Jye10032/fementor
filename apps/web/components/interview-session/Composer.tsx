import { Send, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { ComposerTextareaRef, InterviewQuestion, QuestionCardMode } from "./types";

type ComposerProps = {
  answer: string;
  currentQuestion: InterviewQuestion | null;
  interviewCompleted: boolean;
  sessionClosed: boolean;
  questionCardMode: QuestionCardMode;
  submittingTurn: boolean;
  composerRef: ComposerTextareaRef;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
};

function getPlaceholder({
  currentQuestion,
  interviewCompleted,
  sessionClosed,
  questionCardMode,
}: Pick<ComposerProps, "currentQuestion" | "interviewCompleted" | "sessionClosed" | "questionCardMode">) {
  if (sessionClosed) {
    return "本场面试已经结束，请返回面试准备页重新开始新的一场。";
  }
  if (interviewCompleted) {
    return "本场题目已全部完成，可先查看总结并选择生成复盘。";
  }
  if (questionCardMode === "transition") {
    return "系统正在整理上一题反馈，进入下一题后可继续作答。";
  }
  if (!currentQuestion) {
    return "当前没有待回答题目，可先同步题目状态或查看总结。";
  }
  return "请用真实面试口吻回答，尽量覆盖背景、思路、行动和结果。";
}

export function Composer({
  answer,
  currentQuestion,
  interviewCompleted,
  sessionClosed,
  questionCardMode,
  submittingTurn,
  composerRef,
  onAnswerChange,
  onSubmit,
}: ComposerProps) {
  const disabled = !currentQuestion || interviewCompleted || sessionClosed || submittingTurn || questionCardMode !== "active";

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [answer, composerRef]);

  return (
    <div className="border-t border-border/70 bg-card/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-6">
      <div className="mx-auto space-y-3">
        {questionCardMode === "transition" ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-4 text-sm leading-6 text-foreground">
            当前正在等待切换到下一题，输入区暂时锁定，避免上一轮评价与下一题回答混在一起。
          </div>
        ) : null}
        {sessionClosed ? (
          <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-4 text-sm leading-6 text-foreground">
            本场面试已经结束，当前会话不再接收新的回答。请返回面试准备页重新开始。
          </div>
        ) : null}
        <textarea
          ref={composerRef}
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          rows={2}
          placeholder={getPlaceholder({ currentQuestion, interviewCompleted, sessionClosed, questionCardMode })}
          className="field-shell min-h-[72px] max-h-[280px] w-full resize-none overflow-y-auto text-sm leading-7"
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            onClick={onSubmit}
            disabled={disabled || !answer.trim()}
            className="action-primary rounded-2xl gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submittingTurn ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submittingTurn ? "提交中..." : sessionClosed ? "本场已结束" : currentQuestion ? "提交回答" : "暂无可回答题目"}
          </button>
        </div>
      </div>
    </div>
  );
}
