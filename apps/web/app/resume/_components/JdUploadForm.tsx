"use client";

import { ChangeEvent } from "react";
import { Upload } from "lucide-react";

interface JdUploadFormProps {
  jdFilename: string;
  setJdFilename: (v: string) => void;
  jdText: string;
  setJdText: (v: string) => void;
  jdFileStatus: string;
  uploadingJdFile: boolean;
  savingJd: boolean;
  canSaveJd: boolean;
  jdDragOver: boolean;
  setJdDragOver: (v: boolean) => void;
  handleJdDrop: (e: React.DragEvent) => void;
  onJdFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onSaveJd: () => void;
}

export function JdUploadForm(props: JdUploadFormProps) {
  const {
    jdFilename, setJdFilename, jdText, setJdText,
    jdFileStatus, uploadingJdFile, savingJd, canSaveJd,
    jdDragOver, setJdDragOver, handleJdDrop,
    onJdFileChange, onSaveJd,
  } = props;

  return (
    <section className="panel-surface space-y-4">
      <h2 className="text-base font-semibold text-foreground">
        添加新 JD
      </h2>
      <div className="space-y-1.5">
        <label htmlFor="jd-filename" className="text-sm font-medium text-foreground">
          保存文件名
        </label>
        <input
          id="jd-filename"
          value={jdFilename}
          onChange={(e) => setJdFilename(e.target.value)}
          className="field-shell w-full text-sm"
          placeholder="jd.md"
        />
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setJdDragOver(true); }}
        onDragLeave={() => setJdDragOver(false)}
        onDrop={handleJdDrop}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors duration-200 ${
          jdDragOver ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:border-primary/30"
        }`}
      >
        <label className="flex cursor-pointer flex-col items-center gap-2">
          <Upload className={`h-8 w-8 transition-colors duration-200 ${jdDragOver ? "text-primary" : "text-muted-foreground/50"}`} />
          <span className="text-sm font-medium text-muted-foreground">
            {uploadingJdFile ? "读取中..." : "拖拽文件到此处，或点击选择"}
          </span>
          <span className="text-xs text-muted-foreground/60">txt / md / json / html</span>
          <input type="file" accept=".txt,.md,.json,.html,.htm,.csv" className="sr-only" onChange={onJdFileChange} aria-label="上传 JD 文件" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">{jdFileStatus}</p>
      <div className="space-y-1.5">
        <label htmlFor="jd-text" className="text-sm font-medium text-foreground">或粘贴 JD 文本</label>
        <textarea
          id="jd-text"
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          rows={8}
          className="field-shell w-full resize-y text-sm"
          placeholder="粘贴岗位职责、技术要求、业务方向和级别要求..."
        />
      </div>
      <div className="flex justify-end">
        <button onClick={onSaveJd} disabled={!canSaveJd || savingJd} className="action-primary cursor-pointer">
          {savingJd ? "保存中..." : "保存 JD"}
        </button>
      </div>
    </section>
  );
}