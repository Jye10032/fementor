import Link from "next/link";
import { ArrowLeft, Clock3, PanelRightOpen } from "lucide-react";
import { InterviewQuestion, StageStep } from "./types";
import { difficultyLabel, questionTypeLabel, sourceLabel } from "./copy";

function getStatusTone(stageStep: StageStep, completed: boolean) {
  if (completed) {
    return "border-accent/30 bg-accent/8 text-accent";
  }
  if (stageStep === "transition" || stageStep === "completed") {
    return "border-primary/30 bg-primary/8 text-primary";
  }
  if (stageStep === "idle") {
    return "border-border bg-background/80 text-muted-foreground";
  }
  return "border-warning/30 bg-warning/8 text-warning";
}

type SessionTopBarProps = {
  answeredCount: number;
  totalCount: number;
  currentQuestion: InterviewQuestion | null;
  elapsedLabel: string;
  interviewCompleted: boolean;
  sessionClosed: boolean;
  stageLabel: string;
  stageStep: StageStep;
  endedNotice?: string | null;
  onOpenPanel: () => void;
};

export function SessionTopBar({
  answeredCount,
  totalCount,
  currentQuestion,
  elapsedLabel,
  interviewCompleted,
  sessionClosed,
  stageLabel,
  stageStep,
  endedNotice,
  onOpenPanel,
}: SessionTopBarProps) {
  return (
    <section className="shrink-0 rounded-2xl border border-border/70 bg-card/86 px-4 py-2.5 shadow-[var(--shadow-card)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
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
              {sessionClosed ? "本场面试已结束" : interviewCompleted ? "本场已完成" : stageLabel}
            </div>
          </div>

          {endedNotice ? (
            <p className="text-sm font-medium leading-6 text-primary">
              {endedNotice}
            </p>
          ) : null}
        </div>

        <button onClick={onOpenPanel} className="action-secondary gap-2 px-4 py-2">
          <PanelRightOpen className="h-4 w-4" />
          面试面板
        </button>
      </div>
    </section>
  );
}
