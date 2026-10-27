import { Check, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import { formatElapsed } from "./copy";
import { ActivityStep, RowActivity } from "./types";

export type LiveActivity = {
  rowId: string;
  busy: boolean;
  saved: boolean;
  elapsedMs: number;
  message: string;
  canRefresh: boolean;
  onRefresh: () => void;
};

type AgentActivityProps = {
  activity?: RowActivity;
  live: LiveActivity | null;
  failed?: boolean;
};

function StepList({ steps, startedAt, running }: { steps: ActivityStep[]; startedAt: number; running: boolean }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((step, index) => {
        const current = running && index === steps.length - 1;
        return (
          <li key={`${step.at}-${index}`} className="activity-step flex items-start gap-2 text-sm leading-6">
            {current
              ? <LoaderCircle aria-hidden className="mt-1 h-4 w-4 shrink-0 animate-spin text-primary" />
              : <Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-accent" />}
            <span className={current ? "font-medium text-foreground" : "text-muted-foreground"}>{step.label}</span>
            <span className="ml-auto shrink-0 pl-3 text-xs leading-6 tabular-nums text-muted-foreground/80">
              {formatElapsed(step.at - startedAt)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Agent-style processing trace: streams steps while the turn runs, then folds
// into a one-line summary that stays expandable on the reply.
export function AgentActivity({ activity, live, failed = false }: AgentActivityProps) {
  const running = Boolean(live?.busy);
  const startedAt = activity?.startedAt ?? Date.now() - (live?.elapsedMs ?? 0);
  const steps = [...(activity?.steps ?? [])];
  // Recovery and sync messages are not stage events; show them as the live tail.
  if (running && live!.message && steps.at(-1)?.label !== live!.message) {
    steps.push({ label: live!.message, at: startedAt + live!.elapsedMs });
  }
  if (running && steps.length === 0) steps.push({ label: "正在发送回答", at: startedAt });
  if (steps.length === 0 && !live?.canRefresh) return null;

  const durationMs = running ? live!.elapsedMs
    : activity?.endedAt ? activity.endedAt - activity.startedAt : null;

  if (running) {
    return (
      <div className="mt-2" aria-live="polite">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">面试官正在分析</span>
          <span className="tabular-nums">{formatElapsed(live!.elapsedMs)}</span>
          {live!.saved && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">回答已保存</span>}
        </div>
        <StepList steps={steps} startedAt={startedAt} running />
        {live!.elapsedMs >= 60000 && (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            本轮分析时间较长，可以继续等待。离开或刷新页面会中断当前连接，返回后会重新确认处理结果。
          </p>
        )}
      </div>
    );
  }

  const summary = [
    failed ? "处理过程" : "已完成分析",
    steps.length > 0 ? `${steps.length} 步` : null,
    durationMs !== null ? `用时 ${formatElapsed(durationMs)}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="mt-1.5 mb-2 space-y-1.5">
      {steps.length > 0 && (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
            {summary}
          </summary>
          <div className="mt-2 border-l border-border pl-3">
            <StepList steps={steps} startedAt={startedAt} running={false} />
          </div>
        </details>
      )}
      {live?.canRefresh && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {live.message && <span>{live.message}</span>}
          <button type="button" onClick={live.onRefresh}
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />同步处理状态
          </button>
        </div>
      )}
    </div>
  );
}
