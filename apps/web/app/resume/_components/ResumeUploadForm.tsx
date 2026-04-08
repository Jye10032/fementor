"use client";

import { ChangeEvent } from "react";
import { Upload } from "lucide-react";

interface ResumeUploadFormProps {
  name: string;
  setName: (v: string) => void;
  resumeFilename: string;
  setResumeFilename: (v: string) => void;
  resumeText: string;
  setResumeText: (v: string) => void;
  resumeFileStatus: string;
  uploadingResumeFile: boolean;
  parsingResume: boolean;
  canParseResume: boolean;
  isSignedIn: boolean;
  resumeDragOver: boolean;
  setResumeDragOver: (v: boolean) => void;
  handleResumeDrop: (e: React.DragEvent) => void;
  onResumeFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onParseResume: () => void;
}

export function ResumeUploadForm({
  name, setName, resumeFilename, setResumeFilename,
  resumeText, setResumeText, resumeFileStatus,
  uploadingResumeFile, parsingResume, canParseResume, isSignedIn,
  resumeDragOver, setResumeDragOver, handleResumeDrop,
  onResumeFileChange, onParseResume,
}: ResumeUploadFormProps) {
  return (
    <section className="panel-surface space-y-4">
      <h2 className="text-base font-semibold text-foreground">上传新简历</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="resume-name" className="text-sm font-medium text-foreground">姓名</label>
          <input id="resume-name" value={name} onChange={(e) => setName(e.target.value)} className="field-shell w-full text-sm" placeholder="用于简历摘要关联" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="resume-filename" className="text-sm font-medium text-foreground">保存文件名</label>
          <input id="resume-filename" value={resumeFilename} onChange={(e) => setResumeFilename(e.target.value)} className="field-shell w-full text-sm" placeholder="resume.md" />
        </div>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setResumeDragOver(true); }}
        onDragLeave={() => setResumeDragOver(false)}
        onDrop={handleResumeDrop}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors duration-200 ${
          resumeDragOver ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:border-primary/30"
        }`}
      >
        <label className="flex cursor-pointer flex-col items-center gap-2">
          <Upload className={`h-8 w-8 transition-colors duration-200 ${resumeDragOver ? "text-primary" : "text-muted-foreground/50"}`} />
          <span className="text-sm font-medium text-muted-foreground">
            {uploadingResumeFile ? "读取中..." : "拖拽文件到此处，或点击选择"}
          </span>
          <span className="text-xs text-muted-foreground/60">txt / md / json / html / pdf / docx</span>
          <input type="file" accept=".txt,.md,.json,.html,.htm,.csv,.pdf,.docx" className="sr-only" onChange={onResumeFileChange} aria-label="上传简历文件" />
        </label>
      </div>
      <p className={`text-xs ${/需要先登录|失败|不支持/.test(resumeFileStatus) ? "text-destructive" : "text-muted-foreground"}`}>{resumeFileStatus}</p>
      <div className="space-y-1.5">
        <label htmlFor="resume-text" className="text-sm font-medium text-foreground">或粘贴简历文本</label>
        <textarea id="resume-text" value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={6} className="field-shell w-full resize-y text-sm" placeholder="直接粘贴简历内容..." />
      </div>
      <div className="flex justify-end">
        <button onClick={onParseResume} disabled={!canParseResume || parsingResume} className="action-primary cursor-pointer">
          {parsingResume ? "解析中..." : isSignedIn ? "解析并保存" : "解析文本"}
        </button>
      </div>
    </section>
  );
}
