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
    <section className="fade-in-up border-b border-border/70 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm">
            {job ? <StatusIcon status={job.status} /> : null}
            <p className="font-semibold text-foreground">同步状态</p>
            {job && config ? <span className={`text-xs ${config.color}`}>{config.label}</span> : null}
          </div>
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>
        {job ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>新增 <strong className="font-semibold text-success">{job.created_count}</strong></span>
            <span>跳过 <strong className="font-semibold text-foreground">{job.skipped_count}</strong></span>
            <span>失败 <strong className={`font-semibold ${job.failed_count > 0 ? "text-destructive" : "text-foreground"}`}>{job.failed_count}</strong></span>
          </div>
        ) : null}
      </div>

      {job?.status === "running" ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full animate-pulse rounded-full bg-primary/60" style={{ width: "60%" }} />
        </div>
      ) : null}

      {job?.error_message ? (
        <div className="mt-3 flex items-start gap-2 border-l-2 border-destructive/60 bg-destructive/5 px-3 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{job.error_message}</p>
        </div>
      ) : null}
    </section>
  );
}
