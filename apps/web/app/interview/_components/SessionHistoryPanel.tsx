"use client";

import { useState } from "react";
import { Clock, Eye, Play, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { InterviewSession } from "../_lib/interview-page.types";

type SessionHistoryPanelProps = {
  loadingHistory: boolean;
  sessionHistory: InterviewSession[];
  onDeleteSession?: (id: string) => Promise<void>;
};

export function SessionHistoryPanel({
  loadingHistory,
  sessionHistory,
  onDeleteSession,
}: SessionHistoryPanelProps) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState("");

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!onDeleteSession) return;
    if (!window.confirm("确认删除该面试记录？")) return;
    setDeletingId(sessionId);
    try {
      await onDeleteSession(sessionId);
    } finally {
      setDeletingId("");
    }
  };

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
                  const query = new URLSearchParams({ session_id: session.id });
                  router.push(`/interview/session?${query.toString()}`);
                }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs transition-colors duration-200 ${
                  isActive
                    ? "border border-primary/30 bg-primary/5 hover:bg-primary/10"
                    : "border border-border/40 hover:bg-secondary/50"
                }`}
              >
                {isActive ? (
                  <Play className="h-3 w-3 shrink-0 text-primary" />
                ) : (
                  <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate text-foreground">{date}</span>
                <span className={`shrink-0 text-[10px] font-medium ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}>
                  {isActive ? "进行中" : "已完成"}
                </span>
                {onDeleteSession && (
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(e, session.id)}
                    disabled={deletingId === session.id}
                    className="shrink-0 rounded-lg p-0.5 text-muted-foreground/40 transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
                    aria-label="删除面试记录"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
