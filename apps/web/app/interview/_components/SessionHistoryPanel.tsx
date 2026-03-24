"use client";

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
    <section className="sidebar-section">
      <h2 className="tool-section-title mb-3">历史记录</h2>
      {loadingHistory ? (
        <div className="tool-empty">加载中...</div>
      ) : !sessionHistory.length ? (
        <div className="tool-empty">暂无历史记录</div>
      ) : (
        <div className="space-y-1">
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
                className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                  isActive
                    ? "cursor-pointer bg-primary/8 hover:bg-primary/15"
                    : "cursor-default opacity-60"
                }`}
              >
                <span className="truncate text-foreground">{date}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isActive ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
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
