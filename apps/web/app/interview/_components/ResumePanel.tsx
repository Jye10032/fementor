"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { ResumeFile, ResumeLibraryResponse } from "../_lib/interview-page.types";

type ResumePanelProps = {
  resumeLibrary: ResumeLibraryResponse | null;
  activeResume: ResumeFile | null;
  loading: boolean;
  resumePickerOpen: boolean;
  switchingResume: string;
  onTogglePicker: () => void;
  onCloseOtherPicker: () => void;
  onSelectResume: (fileName: string) => void;
};

export function ResumePanel({
  resumeLibrary,
  activeResume,
  loading,
  resumePickerOpen,
  switchingResume,
  onTogglePicker,
  onCloseOtherPicker,
  onSelectResume,
}: ResumePanelProps) {
  return (
    <section className="tool-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="tool-section-title">简历</h2>
        <div className="flex items-center gap-2">
          {resumeLibrary?.files.length ? (
            <button
              type="button"
              onClick={() => {
                onTogglePicker();
                onCloseOtherPicker();
              }}
              className="action-secondary flex items-center gap-1 py-1.5 text-xs"
            >
              换一个 <ChevronDown className="h-3 w-3" />
            </button>
          ) : null}
          <Link href="/resume?tab=resume" className="action-secondary py-1.5 text-xs">
            去上传
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="tool-empty mt-3">加载中...</div>
      ) : activeResume ? (
        <div className="tool-surface mt-3">
          <p className="text-sm font-medium text-foreground">
            {activeResume.original_filename || activeResume.name}
          </p>
          {resumeLibrary?.profile?.resume_summary ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {resumeLibrary.profile.resume_summary}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="tool-empty mt-3">
          还没有简历，
          <Link href="/resume" className="text-primary underline">
            前往上传
          </Link>
        </div>
      )}

      {resumePickerOpen && resumeLibrary?.files.length ? (
        <div className="mt-3 space-y-2">
          {resumeLibrary.files.map((file) => (
            <button
              key={file.name}
              type="button"
              onClick={() => onSelectResume(file.name)}
              disabled={switchingResume === file.name}
              className={`tool-radio-item w-full text-left ${
                file.name === resumeLibrary.profile?.active_resume_file
                  ? "border-primary/40 bg-primary/5"
                  : ""
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-foreground">
                  {file.original_filename || file.name}
                </span>
                {file.summary ? (
                  <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                    {file.summary}
                  </span>
                ) : null}
              </span>
              {file.name === resumeLibrary.profile?.active_resume_file ? (
                <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  当前
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
