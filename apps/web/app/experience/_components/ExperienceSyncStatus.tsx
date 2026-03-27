"use client";

import { ExperienceSyncJob } from "../_lib/experience.types";

type ExperienceSyncStatusProps = {
  job: ExperienceSyncJob | null;
  error: string | null;
};

const statusLabelMap: Record<ExperienceSyncJob["status"], string> = {
  pending: "任务已创建，等待执行",
  running: "正在抓取、清洗并入库",
  completed: "同步完成",
  failed: "同步失败",
};

export function ExperienceSyncStatus({ job, error }: ExperienceSyncStatusProps) {
  if (!job && !error) {
    return null;
  }

  return (
    <section className="panel-surface">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-foreground">同步状态</p>
          {job ? <p className="mt-1 text-sm text-muted-foreground">{statusLabelMap[job.status]}</p> : null}
          {error ? <p className="mt-2 text-sm text-[oklch(0.53_0.19_25)]">{error}</p> : null}
        </div>
        {job ? (
          <div className="grid min-w-[260px] grid-cols-3 gap-3">
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">新增</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{job.created_count}</p>
            </div>
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">跳过</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{job.skipped_count}</p>
            </div>
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">失败</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{job.failed_count}</p>
            </div>
          </div>
        ) : null}
      </div>
      {job?.error_message ? (
        <p className="mt-3 rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground">{job.error_message}</p>
      ) : null}
    </section>
  );
}
