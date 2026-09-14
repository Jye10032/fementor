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
    <section className="border-t border-border/70 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">目标 JD</h2>
        <div className="flex items-center gap-1.5">
          {jdLibrary?.files.length ? (
            <button
              type="button"
              onClick={() => {
                onTogglePicker();
                onCloseOtherPicker();
              }}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
            >
              换一个 <ChevronDown className="ml-0.5 inline h-3 w-3" />
            </button>
          ) : null}
          <Link
            href="/resume?tab=jd"
            className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors duration-200 hover:bg-primary/10"
          >
            去上传
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="mt-3 py-3 text-sm text-muted-foreground">加载中...</div>
      ) : activeJd ? (
        <div className="mt-3 border-l-2 border-primary/45 bg-primary/[0.04] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm font-medium text-foreground">{activeJd.name}</p>
            <CheckCircle2 className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
          </div>
        </div>
      ) : (
        <div className="mt-3 py-3 text-sm text-muted-foreground">
          还没有 JD，
          <Link href="/resume?tab=jd" className="text-primary underline">
            前往上传
          </Link>
        </div>
      )}

      {jdPickerOpen && jdLibrary?.files.length ? (
        <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
          {jdLibrary.files.map((file) => {
            const isActive = file.name === jdLibrary.profile?.active_jd_file;
            return (
              <button
                key={file.name}
                type="button"
                onClick={() => onSelectJd(file.name)}
                disabled={switchingJd === file.name}
                className={`flex w-full cursor-pointer items-center gap-2 py-2.5 text-left transition-colors duration-200 hover:bg-secondary/40 ${
                  isActive
                    ? "border-l-2 border-primary/45 bg-primary/[0.04] pl-2.5"
                    : "pl-3"
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
