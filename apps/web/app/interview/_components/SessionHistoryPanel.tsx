"use client";

import { Clock, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { InterviewSession } from "../_lib/interview-page.types";

type SessionHistoryPanelProps = {
  loadingHistory: boolean;
  sessionHistory: InterviewSession[];
};

export function SessionHistoryPanel({
  loadingHistory,
  sessionHistory,
}: SessionHistoryPanelProps) {
  const router = useRouter();

  return (
    <section className="panel-surface sticky top-22 space-y-3">
      <h2 className="text-base font-semibold text-foreground">历史记录</h2>
      {loadingHistory ? (
        <div className="tool-empty">加载中...</div>
      ) : !sessionHistory.length ? (
        <div className="tool-empty">暂无历史记录</div>
      ) : (
        <div className="space-y-1.5">
          {sessionHistory.map((session) => {
            const date = new Date(session.started_at).toLocaleDateString("zh-CN");
            const isActive = session.status === "in_progress";
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  if (!isActive) return;
                  const query = new URLSearchParams({ session_id: session.id });
                  router.push(`/interview/session?${query.toString()}`);
                }}
                disabled={!isActive}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition-colors duration-200 ${
                  isActive
                    ? "cursor-pointer border border-amber-200 bg-amber-50 hover:bg-amber-100/80"
                    : "cursor-default border border-border/50 opacity-60"
                }`}
              >
                {isActive ? (
                  <Play className="h-3 w-3 shrink-0 text-amber-600" />
                ) : (
                  <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-foreground">{date}</span>
                <span className={`shrink-0 text-[10px] font-medium ${
                  isActive ? "text-amber-600" : "text-muted-foreground"
                }`}>
                  {isActive ? "进行中" : "已完成"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
