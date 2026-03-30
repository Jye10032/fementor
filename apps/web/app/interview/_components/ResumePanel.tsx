"use client";

import { CheckCircle2, ChevronDown, FileText } from "lucide-react";
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
    <section className="panel-surface space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">简历</h2>
        <div className="flex items-center gap-1.5">
          {resumeLibrary?.files.length ? (
            <button
              type="button"
              onClick={() => {
                onTogglePicker();
                onCloseOtherPicker();
              }}
              className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
            >
              换一个 <ChevronDown className="ml-0.5 inline h-3 w-3" />
            </button>
          ) : null}
          <Link
            href="/resume?tab=resume"
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors duration-200 hover:bg-primary/10"
          >
            去上传
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="tool-empty">加载中...</div>
      ) : activeResume ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-medium text-foreground">
              {activeResume.original_filename || activeResume.name}
            </p>
            <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
          </div>
          {resumeLibrary?.profile?.resume_summary ? (
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {resumeLibrary.profile.resume_summary}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="tool-empty">
          还没有简历，
          <Link href="/resume" className="text-primary underline">
            前往上传
          </Link>
        </div>
      )}

      {resumePickerOpen && resumeLibrary?.files.length ? (
        <div className="space-y-1.5">
          {resumeLibrary.files.map((file) => {
            const isActive = file.name === resumeLibrary.profile?.active_resume_file;
            return (
              <button
                key={file.name}
                type="button"
                onClick={() => onSelectResume(file.name)}
                disabled={switchingResume === file.name}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-xl border p-3 text-left transition-colors duration-200 ${
                  isActive
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/70 bg-background hover:border-primary/20"
                }`}
              >
                <FileText className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/50"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">
                    {file.original_filename || file.name}
                  </span>
                  {file.summary ? (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                      {file.summary}
                    </span>
                  ) : null}
                </span>
                {isActive && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
