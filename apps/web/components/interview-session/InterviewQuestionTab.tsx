import { difficultyLabel, questionTypeLabel, queueStatusLabel, sourceLabel } from "./copy";
import { InterviewQuestion } from "./types";

type InterviewQuestionTabProps = {
  queueItems: InterviewQuestion[];
  currentQuestionId: string | null;
  pendingNextQuestionId: string | null;
};

export function InterviewQuestionTab({
  queueItems,
  currentQuestionId,
  pendingNextQuestionId,
}: InterviewQuestionTabProps) {
  if (queueItems.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-background/75 p-4 text-sm leading-6 text-muted-foreground">
        当前还没有加载到题目队列。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {queueItems.map((item) => {
        const isCurrent = item.id === currentQuestionId;
        const isPending = item.id === pendingNextQuestionId;

        return (
          <article
            key={item.id}
            className={`rounded-xl border p-4 ${
              isPending
                ? "border-primary/25 bg-primary/5"
                : isCurrent
                  ? "border-primary/35 bg-primary/5"
                  : item.question_type === "follow_up"
                    ? "border-warning/25 bg-warning/5"
                    : "border-border/70 bg-background/75"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs text-muted-foreground">
                    第 {item.order_no} 题 · {questionTypeLabel[item.question_type]}
                  </p>
                  {isCurrent ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      当前题
                    </span>
                  ) : null}
                  {isPending ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      下一题
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-medium leading-6 text-foreground">{item.stem}</p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                {queueStatusLabel[item.status]}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                {difficultyLabel[item.difficulty]}
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                {sourceLabel[item.source]}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
