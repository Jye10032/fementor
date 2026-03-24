import Link from "next/link";
import { ArrowLeft, Clock3, PanelRightOpen } from "lucide-react";
import { InterviewQuestion, StageStep } from "./types";

function getStatusTone(stageStep: StageStep, completed: boolean) {
  if (completed) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (stageStep === "transition" || stageStep === "completed") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  if (stageStep === "idle") {
    return "border-border bg-background/80 text-muted-foreground";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
}

type SessionTopBarProps = {
  answeredCount: number;
  totalCount: number;
  currentQuestion: InterviewQuestion | null;
  elapsedLabel: string;
  interviewCompleted: boolean;
  stageLabel: string;
  stageStep: StageStep;
  onOpenPanel: () => void;
};

export function SessionTopBar({
  answeredCount,
  totalCount,
  currentQuestion,
  elapsedLabel,
  interviewCompleted,
  stageLabel,
  stageStep,
  onOpenPanel,
}: SessionTopBarProps) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-card/86 px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/interview"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background/90 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="返回面试准备页"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/90 px-3 py-2 text-sm text-foreground">
            <Clock3 className="h-4 w-4 text-muted-foreground" />
            {elapsedLabel}
          </div>
          <div className="rounded-xl border border-border bg-background/90 px-3 py-2 text-sm text-foreground">
            已完成 {answeredCount}/{totalCount}
            {currentQuestion ? <span className="text-muted-foreground"> · 第 {currentQuestion.order_no} 题</span> : null}
          </div>
          <div className={`rounded-xl border px-3 py-2 text-sm ${getStatusTone(stageStep, interviewCompleted)}`}>
            {interviewCompleted ? "本场已完成" : stageLabel}
          </div>
        </div>

        <button onClick={onOpenPanel} className="action-secondary gap-2 px-4 py-2">
          <PanelRightOpen className="h-4 w-4" />
          面试面板
        </button>
      </div>
    </section>
  );
}
