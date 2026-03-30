"use client";

import { ChangeEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, FileText, FileUp, Upload } from "lucide-react";
import Link from "next/link";
import { PageShell } from "../../components/page-shell";
import { useAuthState } from "../../components/auth-provider";
import { useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";

type ResumeFile = {
  name: string;
  path: string;
  size: number;
  updated_at: string;
  summary: string;
  original_filename: string;
};
type ResumeLibraryResponse = {
  has_resume: boolean;
  profile: {
    id: string;
    name: string;
    resume_summary: string;
    active_resume_file: string;
    active_jd_file?: string;
    updated_at: string;
  } | null;
  files: ResumeFile[];
};
type JdFile = {
  name: string;
  path: string;
  size: number;
  updated_at: string;
  content?: string;
};
type JdLibraryResponse = {
  has_jd: boolean;
  profile: {
    id: string;
    name: string;
    active_jd_file: string;
    updated_at: string;
  } | null;
  files: JdFile[];
};

const TEXT_FILE_EXTENSIONS = ["txt", "md", "markdown", "json", "html", "htm", "csv"];
const BINARY_RESUME_EXTENSIONS = ["pdf", "docx"];
const RESUME_FILE_EXTENSIONS = [...TEXT_FILE_EXTENSIONS, ...BINARY_RESUME_EXTENSIONS];
const JD_FILE_EXTENSIONS = TEXT_FILE_EXTENSIONS;

function getFileExtension(filename: string) {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

function getResumeSourceType(file: File | null, filename: string, hasTextInput: boolean) {
  if (file) {
    const ext = getFileExtension(file.name);
    if (ext === "pdf") return "pdf";
    if (ext === "docx") return "docx";
  }

  if (hasTextInput || TEXT_FILE_EXTENSIONS.includes(getFileExtension(filename))) {
    return "text";
  }

  return "unknown";
}

type Tab = "resume" | "jd";

export default function ResumePage() {
  return (
    <Suspense fallback={<ResumePageFallback />}>
      <ResumePageContent />
    </Suspense>
  );
}

function ResumePageFallback() {
  return (
    <PageShell>
      <header className="fade-in-up flex flex-col gap-1 rounded-[1.5rem] border border-border/80 bg-card/90 p-5 shadow-[var(--shadow-card)] backdrop-blur">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Resume &amp; JD</p>
        <h1 className="text-xl font-semibold text-foreground">档案管理</h1>
        <p className="text-sm text-muted-foreground">管理简历与 JD，为模拟面试做准备。</p>
      </header>
      <div className="tool-empty">页面加载中...</div>
    </PageShell>
  );
}

function ResumePageContent() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") === "jd" ? "jd" : "resume") as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const { apiBase } = useRuntimeConfig();
  const { isLoaded, isSignedIn, viewer, viewerLoading, refreshViewer } = useAuthState();

  // --- Resume state ---
  const [resumeLibrary, setResumeLibrary] = useState<ResumeLibraryResponse | null>(null);
  const [loadingResume, setLoadingResume] = useState(false);
  const [selectingResume, setSelectingResume] = useState("");

  const [name, setName] = useState("Alice");
  const [resumeFilename, setResumeFilename] = useState("resume.md");
  const [resumeText, setResumeText] = useState("");
  const [resumeUploadFile, setResumeUploadFile] = useState<File | null>(null);
  const [resumeFileStatus, setResumeFileStatus] = useState(
    "支持 txt / md / json / html / pdf / docx，可上传文件或直接粘贴文本。"
  );
  const [uploadingResumeFile, setUploadingResumeFile] = useState(false);
  const [parsingResume, setParsingResume] = useState(false);

  // --- JD state ---
  const [jdLibrary, setJdLibrary] = useState<JdLibraryResponse | null>(null);
  const [loadingJd, setLoadingJd] = useState(false);
  const [selectingJd, setSelectingJd] = useState("");

  const [jdFilename, setJdFilename] = useState("jd.md");
  const [jdText, setJdText] = useState("");
  const [jdFileStatus, setJdFileStatus] = useState(
    "支持上传 txt / md / json / html 等文本文件，或直接粘贴 JD 文本。"
  );
  const [uploadingJdFile, setUploadingJdFile] = useState(false);
  const [savingJd, setSavingJd] = useState(false);

  const canParseResume = useMemo(
    () => resumeText.trim().length > 0 || Boolean(resumeUploadFile),
    [resumeText, resumeUploadFile]
  );

  const canSaveJd = useMemo(
    () => jdText.trim().length > 0,
    [jdText]
  );

  // Drag state for dropzones
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const [jdDragOver, setJdDragOver] = useState(false);

  const handleResumeDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setResumeDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const fakeEvent = { target: { files: [file], value: "" } } as unknown as ChangeEvent<HTMLInputElement>;
    onResumeFileChange(fakeEvent);
  }, []);

  const handleJdDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setJdDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const fakeEvent = { target: { files: [file], value: "" } } as unknown as ChangeEvent<HTMLInputElement>;
    onJdFileChange(fakeEvent);
  }, []);

  const refreshResumeLibrary = async () => {
    if (!isSignedIn) {
      setResumeLibrary(null);
      return;
    }
    setLoadingResume(true);
    try {
      const data = await apiRequest<ResumeLibraryResponse>(apiBase, "/v1/resume/library", {
        auth: "required",
      });
      setResumeLibrary(data);
    } catch {
      // ignore
    } finally {
      setLoadingResume(false);
    }
  };

  const refreshJdLibrary = async () => {
    if (!isSignedIn) {
      setJdLibrary(null);
      return;
    }
    setLoadingJd(true);
    try {
      const data = await apiRequest<JdLibraryResponse>(apiBase, "/v1/jd/library", {
        auth: "required",
      });
      setJdLibrary(data);
    } catch {
      // ignore
    } finally {
      setLoadingJd(false);
    }
  };

  useEffect(() => {
    void refreshResumeLibrary();
    void refreshJdLibrary();
  }, [apiBase, isSignedIn]);

  // Resume file handlers
  const onResumeFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = getFileExtension(file.name);
    if (!RESUME_FILE_EXTENSIONS.includes(ext)) {
      setResumeFileStatus(`不支持 .${ext || "unknown"} 格式，请使用 txt / md / pdf / docx。`);
      event.target.value = "";
      return;
    }
    setResumeFilename(file.name);
    if (BINARY_RESUME_EXTENSIONS.includes(ext)) {
      setResumeUploadFile(file);
      setResumeText("");
      setResumeFileStatus(`已选择 ${file.name}，将在解析时自动抽取文本。`);
    } else {
      try {
        setUploadingResumeFile(true);
        const text = await file.text();
        setResumeText(text);
        setResumeUploadFile(null);
        setResumeFileStatus(`已读取 ${file.name}，共 ${text.length} 字符。`);
      } catch (error) {
        setResumeFileStatus(`文件读取失败：${String(error)}`);
      } finally {
        setUploadingResumeFile(false);
      }
    }
    event.target.value = "";
  };

  const onParseResume = async () => {
    const sourceType = getResumeSourceType(resumeUploadFile, resumeFilename, Boolean(resumeText.trim()));

    if (sourceType === "pdf" && !isSignedIn) {
      setResumeFileStatus("PDF 解析需要先登录，因为该链路会调用受配额限制的后端 OCR API。");
      return;
    }

    try {
      setParsingResume(true);
      const formData = new FormData();
      formData.append("name", name);
      formData.append("filename", resumeFilename);
      if (resumeText.trim()) formData.append("resume_text", resumeText);
      if (resumeUploadFile) formData.append("resume_file", resumeUploadFile, resumeUploadFile.name);
      await apiRequest(apiBase, "/v1/resume/parse", {
        method: "POST",
        body: formData,
        auth: sourceType === "pdf" ? "required" : "optional",
      });
      setResumeText("");
      setResumeUploadFile(null);
      setResumeFileStatus("支持 txt / md / json / html / pdf / docx，可上传文件或直接粘贴文本。");
      if (isSignedIn) {
        await Promise.all([refreshViewer(), refreshResumeLibrary()]);
      }
    } catch (error) {
      setResumeFileStatus(`解析失败：${String(error)}`);
    } finally {
      setParsingResume(false);
    }
  };

  const onSelectResume = async (fileName: string) => {
    setSelectingResume(fileName);
    try {
      await apiRequest(apiBase, "/v1/resume/select", {
        method: "POST",
        body: JSON.stringify({ file_name: fileName }),
        auth: "required",
      });
      await refreshResumeLibrary();
    } catch {
      // ignore
    } finally {
      setSelectingResume("");
    }
  };

  // JD file handlers
  const onJdFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = getFileExtension(file.name);
    if (!JD_FILE_EXTENSIONS.includes(ext)) {
      setJdFileStatus(`不支持 .${ext || "unknown"} 格式，请使用 txt / md / json / html。`);
      event.target.value = "";
      return;
    }
    setJdFilename(file.name);
    try {
      setUploadingJdFile(true);
      const text = await file.text();
      setJdText(text);
      setJdFileStatus(`已读取 ${file.name}，共 ${text.length} 字符。`);
    } catch (error) {
      setJdFileStatus(`文件读取失败：${String(error)}`);
    } finally {
      setUploadingJdFile(false);
    }
    event.target.value = "";
  };

  const onSaveJd = async () => {
    try {
      setSavingJd(true);
      await apiRequest(apiBase, "/v1/jd/upload", {
        method: "POST",
        body: JSON.stringify({ filename: jdFilename, jd_text: jdText }),
        auth: "required",
      });
      setJdText("");
      setJdFilename("jd.md");
      setJdFileStatus("支持上传 txt / md / json / html 等文本文件，或直接粘贴 JD 文本。");
      await refreshJdLibrary();
    } catch (error) {
      setJdFileStatus(`保存失败：${String(error)}`);
    } finally {
      setSavingJd(false);
    }
  };

  const onSelectJd = async (fileName: string) => {
    setSelectingJd(fileName);
    try {
      await apiRequest(apiBase, "/v1/jd/select", {
        method: "POST",
        body: JSON.stringify({ file_name: fileName }),
        auth: "required",
      });
      await refreshJdLibrary();
    } catch {
      // ignore
    } finally {
      setSelectingJd("");
    }
  };

  return (
    <PageShell>
      {/* Header */}
      <header className="fade-in-up flex flex-col gap-4 rounded-[1.5rem] border border-border/80 bg-card/90 p-5 shadow-[var(--shadow-card)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Resume &amp; JD</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">档案管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理简历与 JD，为模拟面试做准备。</p>
        </div>
        {/* Auth chip */}
        {isLoaded && !viewerLoading && (
          <div className="shrink-0">
            {isSignedIn ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
                {viewer?.name || viewer?.email || "已登录"}
                {viewer?.capabilities?.remaining_resume_ocr_count != null && (
                  <span className="text-muted-foreground/60">
                    OCR {viewer.capabilities.remaining_resume_ocr_count}/{viewer.capabilities.daily_resume_ocr_limit}
                  </span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                未登录 — 可粘贴文本解析，PDF 需登录
              </span>
            )}
          </div>
        )}
      </header>

      {/* Tab switcher */}
      <div className="fade-in-up-delay-1 inline-flex self-start rounded-xl border border-border bg-background p-1">
        <button
          type="button"
          onClick={() => setActiveTab("resume")}
          className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
            activeTab === "resume"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary"
          }`}
        >
          简历
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("jd")}
          className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold transition-colors duration-200 ${
            activeTab === "jd"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary"
          }`}
        >
          JD
        </button>
      </div>

      {/* Resume tab */}
      {activeTab === "resume" && (
        <div className="fade-in-up grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          {/* Upload form */}
          <section className="panel-surface space-y-4">
            <h2 className="text-base font-semibold text-foreground">上传新简历</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="resume-name" className="text-sm font-medium text-foreground">姓名</label>
                <input
                  id="resume-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field-shell w-full text-sm"
                  placeholder="用于简历摘要关联"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="resume-filename" className="text-sm font-medium text-foreground">保存文件名</label>
                <input
                  id="resume-filename"
                  value={resumeFilename}
                  onChange={(e) => setResumeFilename(e.target.value)}
                  className="field-shell w-full text-sm"
                  placeholder="resume.md"
                />
              </div>
            </div>
            {/* Dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setResumeDragOver(true); }}
              onDragLeave={() => setResumeDragOver(false)}
              onDrop={handleResumeDrop}
              className={`rounded-[1.2rem] border-2 border-dashed p-6 text-center transition-colors duration-200 ${
                resumeDragOver
                  ? "border-primary/60 bg-primary/5"
                  : "border-border bg-background hover:border-primary/30"
              }`}
            >
              <label className="flex cursor-pointer flex-col items-center gap-2">
                <Upload className={`h-8 w-8 transition-colors duration-200 ${resumeDragOver ? "text-primary" : "text-muted-foreground/50"}`} />
                <span className="text-sm font-medium text-muted-foreground">
                  {uploadingResumeFile ? "读取中..." : "拖拽文件到此处，或点击选择"}
                </span>
                <span className="text-xs text-muted-foreground/60">txt / md / json / html / pdf / docx</span>
                <input
                  type="file"
                  accept=".txt,.md,.json,.html,.htm,.csv,.pdf,.docx"
                  className="sr-only"
                  onChange={onResumeFileChange}
                  aria-label="上传简历文件"
                />
              </label>
            </div>
            <p className={`text-xs ${/需要先登录|失败|不支持/.test(resumeFileStatus) ? "text-red-500" : "text-muted-foreground"}`}>{resumeFileStatus}</p>
            <div className="space-y-1.5">
              <label htmlFor="resume-text" className="text-sm font-medium text-foreground">或粘贴简历文本</label>
              <textarea
                id="resume-text"
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={6}
                className="field-shell w-full resize-y text-sm"
                placeholder="直接粘贴简历内容..."
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={onParseResume}
                disabled={!canParseResume || parsingResume}
                className="action-primary cursor-pointer"
              >
                {parsingResume ? "解析中..." : isSignedIn ? "解析并保存" : "解析文本"}
              </button>
            </div>
          </section>

          {/* Resume library */}
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
                    <div
                      key={file.name}
                      className={`rounded-xl border p-3 transition-colors duration-200 ${
                        isActive
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/70 bg-background hover:border-primary/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/50"}`} />
                          <span className="truncate text-sm font-medium text-foreground">
                            {file.original_filename || file.name}
                          </span>
                          {isActive && (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!isActive && (
                            <button
                              onClick={() => void onSelectResume(file.name)}
                              disabled={selectingResume === file.name}
                              className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
                            >
                              {selectingResume === file.name ? "..." : "设为默认"}
                            </button>
                          )}
                          <Link
                            href={`/resume/${encodeURIComponent(file.name)}`}
                            className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-200 hover:bg-primary/10"
                          >
                            查看
                          </Link>
                        </div>
                      </div>
                      {file.summary && (
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{file.summary}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* JD tab */}
      {activeTab === "jd" && (
        <div className="fade-in-up grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          {/* Upload form */}
          <section className="panel-surface space-y-4">
            <h2 className="text-base font-semibold text-foreground">添加新 JD</h2>
            <div className="space-y-1.5">
              <label htmlFor="jd-filename" className="text-sm font-medium text-foreground">保存文件名</label>
              <input
                id="jd-filename"
                value={jdFilename}
                onChange={(e) => setJdFilename(e.target.value)}
                className="field-shell w-full text-sm"
                placeholder="jd.md"
              />
            </div>
            {/* Dropzone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setJdDragOver(true); }}
              onDragLeave={() => setJdDragOver(false)}
              onDrop={handleJdDrop}
              className={`rounded-[1.2rem] border-2 border-dashed p-6 text-center transition-colors duration-200 ${
                jdDragOver
                  ? "border-primary/60 bg-primary/5"
                  : "border-border bg-background hover:border-primary/30"
              }`}
            >
              <label className="flex cursor-pointer flex-col items-center gap-2">
                <Upload className={`h-8 w-8 transition-colors duration-200 ${jdDragOver ? "text-primary" : "text-muted-foreground/50"}`} />
                <span className="text-sm font-medium text-muted-foreground">
                  {uploadingJdFile ? "读取中..." : "拖拽文件到此处，或点击选择"}
                </span>
                <span className="text-xs text-muted-foreground/60">txt / md / json / html</span>
                <input
                  type="file"
                  accept=".txt,.md,.json,.html,.htm,.csv"
                  className="sr-only"
                  onChange={onJdFileChange}
                  aria-label="上传 JD 文件"
                />
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
              <button
                onClick={onSaveJd}
                disabled={!canSaveJd || savingJd}
                className="action-primary cursor-pointer"
              >
                {savingJd ? "保存中..." : "保存 JD"}
              </button>
            </div>
          </section>

          {/* JD library */}
          <section className="panel-surface space-y-4">
            <h2 className="text-base font-semibold text-foreground">JD 库</h2>
            {loadingJd ? (
              <div className="tool-empty">加载中...</div>
            ) : !isSignedIn ? (
              <div className="tool-empty">登录后可查看 JD 库。</div>
            ) : !jdLibrary?.files.length ? (
              <div className="tool-empty">还没有 JD，添加后会显示在这里。</div>
            ) : (
              <div className="space-y-2">
                {jdLibrary.files.map((file) => {
                  const isActive = file.name === jdLibrary.profile?.active_jd_file;
                  return (
                    <div
                      key={file.name}
                      className={`rounded-xl border p-3 transition-colors duration-200 ${
                        isActive
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/70 bg-background hover:border-primary/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/50"}`} />
                          <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
                          {isActive && (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!isActive && (
                            <button
                              onClick={() => void onSelectJd(file.name)}
                              disabled={selectingJd === file.name}
                              className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
                            >
                              {selectingJd === file.name ? "..." : "设为默认"}
                            </button>
                          )}
                          <Link
                            href={`/resume/jd/${encodeURIComponent(file.name)}`}
                            className="cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium text-primary transition-colors duration-200 hover:bg-primary/10"
                          >
                            查看
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
