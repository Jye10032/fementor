import { CheckCircle2, Sparkles, Trophy, Waypoints } from "lucide-react";
import { RetrospectSummary } from "./RetrospectSummary";
import { RetrospectResponse, TurnRecord } from "./types";

type InterviewCompletionReportProps = {
  answeredCount: number;
  averageScore: number | null;
  latestTurn: TurnRecord | null;
  retrospect: RetrospectResponse | null;
  retrospecting: boolean;
  finishing: boolean;
  sessionClosed?: boolean;
  onRetrospect: () => void;
  onFinish: () => void;
};

export function InterviewCompletionReport({
  answeredCount,
  averageScore,
  latestTurn,
  retrospect,
  retrospecting,
  finishing,
  sessionClosed = false,
  onRetrospect,
  onFinish,
}: InterviewCompletionReportProps) {
  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-[var(--shadow-soft)] md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Interview Summary</p>
            <h2 className="mt-3 text-3xl font-semibold text-foreground">本场模拟面试已完成</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              {sessionClosed ? "本场面试已结束，可以查看已完成回答的评价与复盘。" : "题目作答与评分流程已经结束。可以先生成复盘，也可以直接结束本次会话。"}
            </p>
          </div>
          <div className="rounded-xl border border-accent/30 bg-accent/8 px-4 py-3 text-sm font-medium text-accent">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              已完成 {answeredCount} 道题
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <article className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">平均得分</p>
              <Trophy className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-foreground">{averageScore ?? "-"}</p>
          </article>
          <article className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">最近一轮状态</p>
              <Waypoints className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-3 text-3xl font-semibold text-foreground">{latestTurn ? "已完成" : "-"}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {latestTurn ? "最近一轮回答已完成评分" : "本场尚无已评分的回答"}
            </p>
          </article>
          <article className="rounded-2xl border border-border/70 bg-background/80 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">当前状态</p>
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-3 text-lg font-semibold text-foreground">
              {retrospect ? "复盘结果已生成" : latestTurn ? "可继续生成复盘" : "暂无可复盘的回答"}
            </p>
          </article>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={onRetrospect}
            disabled={retrospecting || !latestTurn}
            className="action-primary px-5 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retrospecting ? "生成中..." : "生成复盘"}
          </button>
          <button
            onClick={onFinish}
            disabled={finishing || sessionClosed}
            className="action-secondary px-5 py-3 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sessionClosed ? "已结束" : finishing ? "结束中..." : "结束面试"}
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card/92 p-5 shadow-[var(--shadow-card)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">复盘结论</p>
        <div className="mt-4">
          <RetrospectSummary retrospect={retrospect} variant="report" />
        </div>
      </section>
    </section>
  );
}
