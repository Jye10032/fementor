"use client";

import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { ExperienceSyncJob } from "../_lib/experience.types";

type ExperienceSyncStatusProps = {
  job: ExperienceSyncJob | null;
  error: string | null;
};

const statusConfig: Record<ExperienceSyncJob["status"], { label: string; color: string; dotColor: string }> = {
  pending: { label: "任务已创建，等待执行", color: "text-primary", dotColor: "bg-primary" },
  running: { label: "正在抓取、清洗并入库", color: "text-primary", dotColor: "bg-primary" },
  completed: { label: "同步完成", color: "text-success", dotColor: "bg-success" },
  failed: { label: "同步失败", color: "text-destructive", dotColor: "bg-destructive" },
};

function StatusIcon({ status }: { status: ExperienceSyncJob["status"] }) {
  const cls = "h-4 w-4";
  switch (status) {
    case "pending": return <Clock className={`${cls} text-primary`} />;
    case "running": return <Loader2 className={`${cls} animate-spin text-primary`} />;
    case "completed": return <CheckCircle2 className={`${cls} text-success`} />;
    case "failed": return <AlertCircle className={`${cls} text-destructive`} />;
  }
}

export function ExperienceSyncStatus({ job, error }: ExperienceSyncStatusProps) {
  if (!job && !error) {
    return null;
  }

  const config = job ? statusConfig[job.status] : null;

  return (
    <section className="panel-surface fade-in-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {job ? <StatusIcon status={job.status} /> : null}
            <p className="text-sm font-semibold text-foreground">同步状态</p>
          </div>
          {job && config ? (
            <p className={`mt-1 text-sm ${config.color}`}>{config.label}</p>
          ) : null}
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>
        {job ? (
          <div className="grid min-w-[260px] grid-cols-3 gap-3">
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">新增</p>
              <p className="mt-2 text-lg font-semibold text-success">{job.created_count}</p>
            </div>
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">跳过</p>
              <p className="mt-2 text-lg font-semibold text-muted-foreground">{job.skipped_count}</p>
            </div>
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">失败</p>
              <p className={`mt-2 text-lg font-semibold ${job.failed_count > 0 ? "text-destructive" : "text-muted-foreground"}`}>{job.failed_count}</p>
            </div>
          </div>
        ) : null}
      </div>

      {job?.status === "running" ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full animate-pulse rounded-full bg-primary/60" style={{ width: "60%" }} />
        </div>
      ) : null}

      {job?.error_message ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/5 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{job.error_message}</p>
        </div>
      ) : null}
    </section>
  );
}
