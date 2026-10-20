import { Check, Clock3, LoaderCircle, Sparkles } from "lucide-react";
import { formatElapsed } from "./copy";
import { ActivityStep } from "./useInterviewSubmission";

type StageStatusBarProps = {
  stageLabel: string;
  busy: boolean;
  saved: boolean;
  elapsedMs: number;
  steps: ActivityStep[];
  message: string;
  canRefresh: boolean;
  onRefresh: () => void;
};

export function StageStatusBar({
  stageLabel, busy, saved, elapsedMs, steps, message, canRefresh, onRefresh,
}: StageStatusBarProps) {
  const Icon = busy ? LoaderCircle : saved ? Check : Sparkles;
  return (
    <div className="mt-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 text-primary ${busy ? "animate-spin" : ""}`} />
        <span role="status" className="font-medium text-foreground">{message || stageLabel}</span>
        {busy && <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />本次等待 {formatElapsed(elapsedMs)}
        </span>}
        {saved && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-accent">回答已保存</span>}
        {canRefresh && <button onClick={onRefresh} className="font-medium text-primary underline underline-offset-4">同步处理状态</button>}
      </div>
      {busy && elapsedMs >= 60000 && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          本轮分析时间较长，你可以继续等待。离开或刷新页面会中断当前连接，返回后将重新确认处理结果。
        </p>
      )}
      {steps.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer select-none py-1">查看处理进度</summary>
          <ol className="mt-1 max-h-32 space-y-1.5 overflow-auto border-l border-border pl-3">
            {steps.map((step, index) => (
              <li key={`${step.at}-${index}`} className="flex gap-2">
                <span className="shrink-0 tabular-nums">{formatElapsed(step.at - steps[0].at)}</span>
                <span>{step.label}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
