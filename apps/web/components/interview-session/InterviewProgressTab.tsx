import { FileSearch, RefreshCw, Timer, Trophy } from "lucide-react";
import { getRetrievalStrategyLabel } from "./copy";
import { TurnRecord } from "./types";

type InterviewProgressTabProps = {
  answeredCount: number;
  totalCount: number;
  averageScore: number | null;
  latestTurn: TurnRecord | null;
  stageLabel: string;
  queueLoading: boolean;
  retrospecting: boolean;
  finishing: boolean;
  canRetrospect: boolean;
  onRefresh: () => void;
  onRetrospect: () => void;
  onFinish: () => void;
};

export function InterviewProgressTab({
  answeredCount,
  totalCount,
  averageScore,
  latestTurn,
  stageLabel,
  queueLoading,
  retrospecting,
  finishing,
  canRetrospect,
  onRefresh,
  onRetrospect,
  onFinish,
}: InterviewProgressTabProps) {
  const stats = [
    {
      icon: Timer,
      label: "已完成题目",
      value: `${answeredCount}/${totalCount || 0}`,
      hint: "当前会话进度",
    },
    {
      icon: Trophy,
      label: "平均得分",
      value: averageScore !== null ? String(averageScore) : "-",
      hint: "根据已完成轮次计算",
    },
    {
      icon: FileSearch,
      label: "资料佐证",
      value: latestTurn ? String(latestTurn.evidence_refs_count) : "0",
      hint: getRetrievalStrategyLabel(latestTurn?.retrieval_strategy),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-[1.4rem] border border-border/80 bg-background/75 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">当前状态</p>
        <p className="mt-2 text-base font-semibold text-foreground">{stageLabel}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          面试会优先保持主作答路径稳定，详细状态与统计信息集中放在这里查看。
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map((item) => (
          <article key={item.label} className="rounded-[1.4rem] border border-border/80 bg-background/75 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <item.icon className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{item.value}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.hint}</p>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={onRefresh} disabled={queueLoading} className="action-secondary gap-2 px-4 py-2">
          <RefreshCw className={`h-4 w-4 ${queueLoading ? "animate-spin" : ""}`} />
          {queueLoading ? "同步中..." : "同步题目状态"}
        </button>
        <button
          onClick={onRetrospect}
          disabled={retrospecting || !canRetrospect}
          className="action-secondary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrospecting ? "生成中..." : "生成复盘"}
        </button>
        <button
          onClick={onFinish}
          disabled={finishing}
          className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {finishing ? "结束中..." : "结束面试"}
        </button>
      </div>
    </div>
  );
}
