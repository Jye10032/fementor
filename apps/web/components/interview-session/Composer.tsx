import { Send, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { ComposerTextareaRef, InterviewQuestion, QuestionCardMode } from "./types";

type ComposerProps = {
  answer: string;
  currentQuestion: InterviewQuestion | null;
  interviewCompleted: boolean;
  questionCardMode: QuestionCardMode;
  submittingTurn: boolean;
  composerRef: ComposerTextareaRef;
  onAnswerChange: (value: string) => void;
  onSubmit: () => void;
};

function getPlaceholder({
  currentQuestion,
  interviewCompleted,
  questionCardMode,
}: Pick<ComposerProps, "currentQuestion" | "interviewCompleted" | "questionCardMode">) {
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
  questionCardMode,
  submittingTurn,
  composerRef,
  onAnswerChange,
  onSubmit,
}: ComposerProps) {
  const disabled = !currentQuestion || interviewCompleted || submittingTurn || questionCardMode !== "active";

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [answer, composerRef]);

  return (
    <div className="bg-card/95 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:px-6">
      <div className="mx-auto max-w-4xl space-y-3">
        {questionCardMode === "transition" ? (
          <div className="rounded-[1.4rem] border border-sky-200 bg-sky-50 px-4 py-4 text-sm leading-6 text-sky-800">
            当前正在等待切换到下一题，输入区暂时锁定，避免上一轮评价与下一题回答混在一起。
          </div>
        ) : null}
        <textarea
          ref={composerRef}
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          rows={2}
          placeholder={getPlaceholder({ currentQuestion, interviewCompleted, questionCardMode })}
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
            {submittingTurn ? "提交中..." : currentQuestion ? "提交回答" : "暂无可回答题目"}
          </button>
        </div>
      </div>
    </div>
  );
}
