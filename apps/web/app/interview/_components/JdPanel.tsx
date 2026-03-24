"use client";

import { ChevronDown } from "lucide-react";
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
    <section className="tool-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="tool-section-title">JD</h2>
        <div className="flex items-center gap-2">
          {jdLibrary?.files.length ? (
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
          <Link href="/resume?tab=jd" className="action-secondary py-1.5 text-xs">
            去上传
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="tool-empty mt-3">加载中...</div>
      ) : activeJd ? (
        <div className="tool-surface mt-3">
          <p className="text-sm font-medium text-foreground">{activeJd.name}</p>
        </div>
      ) : (
        <div className="tool-empty mt-3">
          还没有 JD，
          <Link href="/resume?tab=jd" className="text-primary underline">
            前往上传
          </Link>
        </div>
      )}

      {jdPickerOpen && jdLibrary?.files.length ? (
        <div className="mt-3 space-y-2">
          {jdLibrary.files.map((file) => (
            <button
              key={file.name}
              type="button"
              onClick={() => onSelectJd(file.name)}
              disabled={switchingJd === file.name}
              className={`tool-radio-item w-full text-left ${
                file.name === jdLibrary.profile?.active_jd_file
                  ? "border-primary/40 bg-primary/5"
                  : ""
              }`}
            >
              <span className="block text-sm text-foreground">{file.name}</span>
              {file.name === jdLibrary.profile?.active_jd_file ? (
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
