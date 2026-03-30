"use client";

import { ChangeEvent } from "react";
import { Play } from "lucide-react";
import { JdFile, ResumeFile } from "../_lib/interview-page.types";

type InterviewSetupPanelProps = {
  activeResume: ResumeFile | null;
  activeJd: JdFile | null;
  canStart: boolean;
  starting: boolean;
  useExperienceQuestions: boolean;
  onUseExperienceQuestionsChange: (nextValue: boolean) => void;
  experienceQuery: string;
  onExperienceQueryChange: (value: string) => void;
  onStart: () => void;
};

export function InterviewSetupPanel({
  activeResume,
  activeJd,
  canStart,
  starting,
  useExperienceQuestions,
  onUseExperienceQuestionsChange,
  experienceQuery,
  onExperienceQueryChange,
  onStart,
}: InterviewSetupPanelProps) {
  const handleCheckboxChange = (event: ChangeEvent<HTMLInputElement>) => {
    onUseExperienceQuestionsChange(event.target.checked);
  };

  return (
    <div className="tool-footer-bar">
      <div className="flex flex-1 flex-col gap-3">
        <p className="tool-footer-bar__hint">
          {canStart
            ? `已就绪：${activeResume?.original_filename || activeResume?.name} · ${activeJd?.name}`
            : "需要同时配置好简历和 JD 才能开始。"}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="use-experience" className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              id="use-experience"
              type="checkbox"
              checked={useExperienceQuestions}
              onChange={handleCheckboxChange}
              className="cursor-pointer"
            />
            参考近期真实面经
          </label>
          <input
            id="experience-query"
            value={experienceQuery}
            onChange={(event) => onExperienceQueryChange(event.target.value)}
            placeholder="例如：前端实习 / React 面经"
            disabled={!useExperienceQuestions}
            className="field-shell min-w-[260px] flex-1"
            aria-label="面经搜索关键词"
          />
        </div>
      </div>
      <button
        onClick={onStart}
        disabled={starting || !canStart}
        className="action-primary cursor-pointer gap-2"
      >
        <Play className="h-4 w-4" />
        {starting ? "启动中..." : "开始模拟面试"}
      </button>
    </div>
  );
}
