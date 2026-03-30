import { useEffect, useState } from "react";
import { ArrowRight, FileQuestion, Sparkles } from "lucide-react";
import { difficultyLabel, questionTypeLabel, sourceLabel } from "./copy";
import { InterviewQuestion, QuestionCardMode } from "./types";

type CurrentQuestionCardProps = {
  currentQuestion: InterviewQuestion | null;
  pendingNextQuestion: InterviewQuestion | null;
  questionCardMode: QuestionCardMode;
  onAdvance: () => void;
};

export function CurrentQuestionCard({
  currentQuestion,
  pendingNextQuestion,
  questionCardMode,
  onAdvance,
}: CurrentQuestionCardProps) {
  const displayQuestion = currentQuestion ?? pendingNextQuestion;
  const isShowingPendingQuestion = !currentQuestion && Boolean(pendingNextQuestion);
  const isTransitioning = questionCardMode === "transition" && Boolean(pendingNextQuestion);
  const nextQuestion = isTransitioning ? pendingNextQuestion : null;
  const [isAdvancing, setIsAdvancing] = useState(false);

  useEffect(() => {
    if (!isTransitioning) {
      setIsAdvancing(false);
    }
  }, [isTransitioning]);

  if (!displayQuestion) {
    return (
      <section className="py-1">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <FileQuestion className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">当前题目</p>
            <p className="mt-2 text-sm leading-7 text-foreground">当前没有待展示题目，请在面试面板中同步状态或查看完成报告。</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-1">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className={isTransitioning ? "question-card-settle" : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {isShowingPendingQuestion ? "下一题" : "当前题目"}
            </p>
            {isTransitioning ? (
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                即将切题
              </span>
            ) : null}
            {displayQuestion.question_type === "follow_up" ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                追问
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[1.05rem] font-semibold leading-7 text-foreground">{displayQuestion.stem}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
              第 {displayQuestion.order_no} 题
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
              {questionTypeLabel[displayQuestion.question_type]}
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
              {difficultyLabel[displayQuestion.difficulty]}
            </span>
            <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
              {sourceLabel[displayQuestion.source]}
            </span>
          </div>
        </div>

        {nextQuestion ? (
          <div className="question-card-settle w-full rounded-[1.2rem] border border-sky-200 bg-sky-50 p-3 lg:max-w-[260px]">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white text-sky-700">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold text-sky-900">上一轮反馈已完成</p>
            </div>
            <div className="mt-2 overflow-hidden rounded-full bg-white/80">
              <div className="auto-advance-progress h-1.5 rounded-full bg-sky-500" />
            </div>
            <p className="mt-1.5 text-xs font-medium tracking-[0.08em] text-sky-700">
              约 5 秒后自动进入，也可立即切换
            </p>
            <p className="mt-2 text-sm font-medium leading-6 text-sky-900">
              下一题：第 {nextQuestion.order_no} 题
              {nextQuestion.question_type === "follow_up" ? " · 追问" : ""}
            </p>
            <p className="mt-0.5 line-clamp-2 text-sm leading-6 text-sky-800">
              {nextQuestion.stem}
            </p>
            <button
              onClick={() => {
                setIsAdvancing(true);
                onAdvance();
              }}
              disabled={isAdvancing}
              className="action-primary group mt-3 w-full justify-center gap-2 py-2 text-sm disabled:translate-y-0"
            >
              {isAdvancing ? "正在进入下一题..." : "进入下一题"}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
