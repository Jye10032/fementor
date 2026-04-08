"use client";

import Link from "next/link";
import { CheckCircle2, FileText, Trash2 } from "lucide-react";
import type { ResumeLibraryResponse } from "../_lib/resume.types";

interface ResumeLibraryListProps {
  resumeLibrary: ResumeLibraryResponse | null;
  loadingResume: boolean;
  isSignedIn: boolean;
  selectingResume: string;
  deletingResume: string;
  onSelectResume: (fileName: string) => void;
  onDeleteResume: (fileName: string) => void;
}

export function ResumeLibraryList({
  resumeLibrary, loadingResume, isSignedIn,
  selectingResume, deletingResume,
  onSelectResume, onDeleteResume,
}: ResumeLibraryListProps) {
  return (
    <section className="panel-surface space-y-4">
      <h2 className="text-base font-semibold text-foreground">简历库</h2>
      {loadingResume ? (
        <div className="tool-empty">加载中...</div>
      ) : !isSignedIn ? (
        <div className="tool-empty">登录后可查看个人简历库。</div>
      ) : !resumeLibrary?.files.length ? (
        <div className="tool-empty">还没有简历，上传后会显示在这里。</div>
      ) : (
        <div className="space-y-2">
          {resumeLibrary.files.map((file) => {
            const isActive = file.name === resumeLibrary.profile?.active_resume_file;
            return (
              <div key={file.name} className={`rounded-xl border p-3 transition-colors duration-200 ${
                isActive ? "border-primary/40 bg-primary/5" : "border-border/70 bg-background hover:border-primary/20"
              }`}>
                {/* Item header */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/50"}`} />
                    <span className="truncate text-sm font-medium text-foreground">{file.original_filename || file.name}</span>
                    {isActive && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!isActive && (
                      <button onClick={() => void onSelectResume(file.name)} disabled={selectingResume === file.name} className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground">
                        {selectingResume === file.name ? "..." : "设为默认"}
                      </button>
                    )}
                    <Link href={`/resume/${encodeURIComponent(file.name)}`} className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-200 hover:bg-primary/10">
                      查看
                    </Link>
                    <button onClick={() => void onDeleteResume(file.name)} disabled={deletingResume === file.name} className="cursor-pointer rounded-lg p-1 text-muted-foreground/50 transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive" aria-label="删除简历">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/60">
                    {new Date(file.updated_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {file.summary && <p className="mt-1 text-xs leading-5 text-muted-foreground">{file.summary}</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
