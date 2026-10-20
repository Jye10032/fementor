import { Send, RefreshCw, Square } from "lucide-react";
import { useEffect } from "react";
import { ComposerTextareaRef, InterviewQuestion, QuestionCardMode } from "./types";

type ComposerProps = {
  answer: string;
  currentQuestion: InterviewQuestion | null;
  interviewCompleted: boolean;
  sessionClosed: boolean;
  questionCardMode: QuestionCardMode;
  submittingTurn: boolean;
  retryable: boolean;
  locked: boolean;
  canStop: boolean;
  composerRef: ComposerTextareaRef;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
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
    return "看完本轮反馈后，点击“进入下一题”继续作答。";
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
  retryable,
  locked,
  canStop,
  composerRef,
  onAnswerChange,
  onSubmit,
  onStop,
}: ComposerProps) {
  const disabled = !currentQuestion || interviewCompleted || sessionClosed || submittingTurn || locked || questionCardMode !== "active";

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [answer, composerRef]);

  if (questionCardMode === "transition") {
    return (
      <div className="border-t border-border/70 bg-card/95 px-4 py-3 text-xs leading-5 text-muted-foreground md:px-6">
        可以先阅读本轮反馈，准备好后点击“进入下一题”。
      </div>
    );
  }

  return (
    <div className="border-t border-border/70 bg-card/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:px-6">
      <div className="mx-auto space-y-3">
        {sessionClosed ? (
          <div className="rounded-xl border border-warning/20 bg-warning/5 px-4 py-4 text-sm leading-6 text-foreground">
            本场面试已经结束，当前会话不再接收新的回答。请返回面试准备页重新开始。
          </div>
        ) : null}
        <textarea
          ref={composerRef}
          aria-label="本轮回答"
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          rows={2}
          placeholder={getPlaceholder({ currentQuestion, interviewCompleted, sessionClosed, questionCardMode })}
          className="field-shell min-h-[72px] max-h-[280px] w-full resize-none overflow-y-auto text-sm leading-7"
          disabled={disabled}
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {canStop && <button onClick={onStop} className="action-secondary gap-2 rounded-2xl">
            <Square className="h-3.5 w-3.5" />停止本轮
          </button>}
          <button
            onClick={onSubmit}
            disabled={disabled || !answer.trim()}
            className="action-primary rounded-2xl gap-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submittingTurn ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submittingTurn ? "处理中..." : sessionClosed ? "本场已结束" : locked ? "等待状态同步" : retryable ? "重试本轮" : currentQuestion ? "提交回答" : "暂无可回答题目"}
          </button>
        </div>
      </div>
    </div>
  );
}
