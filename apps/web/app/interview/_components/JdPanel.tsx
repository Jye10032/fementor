"use client";

import { CheckCircle2, ChevronDown, FileText } from "lucide-react";
import Link from "next/link";
import { JdFile, JdLibraryResponse } from "../_lib/interview-page.types";

type JdPanelProps = {
  jdLibrary: JdLibraryResponse | null;
  activeJd: JdFile | null;
  loading: boolean;
  jdPickerOpen: boolean;
  switchingJd: string;
  onTogglePicker: () => void;
  onCloseOtherPicker: () => void;
  onSelectJd: (fileName: string) => void;
};

export function JdPanel({
  jdLibrary,
  activeJd,
  loading,
  jdPickerOpen,
  switchingJd,
  onTogglePicker,
  onCloseOtherPicker,
  onSelectJd,
}: JdPanelProps) {
  return (
    <section className="panel-surface space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">JD</h2>
        <div className="flex items-center gap-1.5">
          {jdLibrary?.files.length ? (
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
            href="/resume?tab=jd"
            className="cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors duration-200 hover:bg-primary/10"
          >
            去上传
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="tool-empty">加载中...</div>
      ) : activeJd ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-medium text-foreground">{activeJd.name}</p>
            <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
          </div>
        </div>
      ) : (
        <div className="tool-empty">
          还没有 JD，
          <Link href="/resume?tab=jd" className="text-primary underline">
            前往上传
          </Link>
        </div>
      )}

      {jdPickerOpen && jdLibrary?.files.length ? (
        <div className="space-y-1.5">
          {jdLibrary.files.map((file) => {
            const isActive = file.name === jdLibrary.profile?.active_jd_file;
            return (
              <button
                key={file.name}
                type="button"
                onClick={() => onSelectJd(file.name)}
                disabled={switchingJd === file.name}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-xl border p-3 text-left transition-colors duration-200 ${
                  isActive
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/70 bg-background hover:border-primary/20"
                }`}
              >
                <FileText className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/50"}`} />
                <span className="block text-sm text-foreground">{file.name}</span>
                {isActive && <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
