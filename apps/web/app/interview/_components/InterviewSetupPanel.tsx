"use client";

import { Play } from "lucide-react";
import { JdFile, ResumeFile } from "../_lib/interview-page.types";

type InterviewSetupPanelProps = {
  activeResume: ResumeFile | null;
  activeJd: JdFile | null;
  canStart: boolean;
  starting: boolean;
  onStart: () => void;
};

export function InterviewSetupPanel({
  activeResume,
  activeJd,
  canStart,
  starting,
  onStart,
}: InterviewSetupPanelProps) {
  return (
    <div className="tool-footer-bar">
      <p className="tool-footer-bar__hint">
        {canStart
          ? `已就绪：${activeResume?.original_filename || activeResume?.name} · ${activeJd?.name}`
          : "需要同时配置好简历和 JD 才能开始。"}
      </p>
      <button onClick={onStart} disabled={starting || !canStart} className="action-primary">
        <Play className="h-4 w-4" />
        {starting ? "启动中..." : "开始模拟面试"}
      </button>
    </div>
  );
}
