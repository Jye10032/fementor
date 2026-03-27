"use client";

import { ChangeEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileUp } from "lucide-react";
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
      <div className="tool-page">
        <header className="tool-header">
          <div className="space-y-1">
            <h1 className="tool-heading">档案管理</h1>
            <p className="tool-subheading">管理简历与 JD，为模拟面试做准备。</p>
          </div>
        </header>
        <div className="tool-empty">页面加载中...</div>
      </div>
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
      <div className="tool-page">
        <header className="tool-header">
          <div className="space-y-1">
            <h1 className="tool-heading">档案管理</h1>
            <p className="tool-subheading">管理简历与 JD，为模拟面试做准备。</p>
          </div>
        </header>

        <section className="tool-section">
          {!isLoaded || viewerLoading ? (
            <p className="text-sm text-muted-foreground">正在同步登录态...</p>
          ) : isSignedIn ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  当前已登录：{viewer?.name || viewer?.email || "已登录用户"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF 解析会消耗后端 OCR 配额；当前剩余 {viewer?.capabilities?.remaining_resume_ocr_count ?? "-"} / {viewer?.capabilities?.daily_resume_ocr_limit ?? "-"}。
                </p>
              </div>
              <span className="rounded-full border border-border/70 bg-secondary/70 px-3 py-1 text-xs text-muted-foreground">
                Viewer 驱动
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">当前未登录。</p>
              <p className="text-xs leading-5 text-muted-foreground">
                你可以先粘贴纯文本尝试解析；上传 PDF 前必须先登录，因为该链路会调用受配额限制的后端 API。JD 库、简历库和默认档案切换也需要登录。
              </p>
            </div>
          )}
        </section>

        {/* Tab switcher */}
        <div className="inline-flex self-start rounded-xl border border-border bg-background p-1">
          <button
            type="button"
            onClick={() => setActiveTab("resume")}
            className={
              activeTab === "resume"
                ? "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm"
                : "rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
            }
          >
            简历
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("jd")}
            className={
              activeTab === "jd"
                ? "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm"
                : "rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
            }
          >
            JD
          </button>
        </div>

        {/* Resume tab */}
        {activeTab === "resume" && (
          <div className="w-full space-y-5">
            {/* Upload form */}
            <section className="tool-section">
              <h2 className="tool-section-title">上传新简历</h2>
              <div className="tool-grid">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">姓名</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="field-shell w-full text-sm"
                    placeholder="用于简历摘要关联，例如 Alice"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">保存文件名</label>
                  <input
                    value={resumeFilename}
                    onChange={(e) => setResumeFilename(e.target.value)}
                    className="field-shell w-full text-sm"
                    placeholder="resume.md"
                  />
                </div>
              </div>
              <div className="tool-dropzone">
                <label className="flex cursor-pointer flex-col items-center gap-2 text-center">
                  <FileUp className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {uploadingResumeFile ? "读取中..." : "点击上传文件"}
                  </span>
                  <input
                    type="file"
                    accept=".txt,.md,.json,.html,.htm,.csv,.pdf,.docx"
                    className="sr-only"
                    onChange={onResumeFileChange}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">{resumeFileStatus}</p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">或粘贴简历文本</label>
                <textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  rows={8}
                  className="field-shell w-full text-sm"
                  placeholder="直接粘贴简历内容..."
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onParseResume}
                  disabled={!canParseResume || parsingResume}
                  className="action-primary"
                >
                  {parsingResume ? "解析中..." : isSignedIn ? "解析并保存" : "解析文本 / 登录后上传 PDF"}
                </button>
              </div>
            </section>

            {/* Resume library */}
            <section className="tool-section">
              <h2 className="tool-section-title">简历库</h2>
              {loadingResume ? (
                <div className="tool-empty">加载中...</div>
              ) : !isSignedIn ? (
                <div className="tool-empty">登录后可查看个人简历库与默认简历。</div>
              ) : !resumeLibrary?.files.length ? (
                <div className="tool-empty">还没有简历，上传后会显示在这里。</div>
              ) : (
                <div className="space-y-3">
                  {resumeLibrary.files.map((file) => {
                    const isActive = file.name === resumeLibrary.profile?.active_resume_file;
                    return (
                      <div
                        key={file.name}
                        className={`tool-radio-item flex-col items-start gap-2 ${
                          isActive ? "border-primary/40 bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            {isActive && (
                              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                默认
                              </span>
                            )}
                            <span className="truncate text-sm font-medium text-foreground">
                              {file.original_filename || file.name}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!isActive && (
                              <button
                                onClick={() => void onSelectResume(file.name)}
                                disabled={selectingResume === file.name}
                                className="action-secondary py-1.5 text-xs"
                              >
                                {selectingResume === file.name ? "设置中..." : "设为默认"}
                              </button>
                            )}
                            <Link
                              href={`/resume/${encodeURIComponent(file.name)}`}
                              className="action-secondary py-1.5 text-xs"
                            >
                              查看
                            </Link>
                          </div>
                        </div>
                        {file.summary && (
                          <p className="text-sm leading-6 text-muted-foreground">{file.summary}</p>
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
          <div className="w-full space-y-5">
            {/* Upload form */}
            <section className="tool-section">
              <h2 className="tool-section-title">添加新 JD</h2>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">保存文件名</label>
                <input
                  value={jdFilename}
                  onChange={(e) => setJdFilename(e.target.value)}
                  className="field-shell w-full text-sm"
                  placeholder="jd.md"
                />
              </div>
              <div className="tool-dropzone">
                <label className="flex cursor-pointer flex-col items-center gap-2 text-center">
                  <FileUp className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {uploadingJdFile ? "读取中..." : "点击上传文件"}
                  </span>
                  <input
                    type="file"
                    accept=".txt,.md,.json,.html,.htm,.csv"
                    className="sr-only"
                    onChange={onJdFileChange}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">{jdFileStatus}</p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">或粘贴 JD 文本</label>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  rows={10}
                  className="field-shell w-full text-sm"
                  placeholder="粘贴岗位职责、技术要求、业务方向和级别要求..."
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={onSaveJd}
                  disabled={!canSaveJd || savingJd}
                  className="action-primary"
                >
                  {savingJd ? "保存中..." : "保存 JD"}
                </button>
              </div>
            </section>

            {/* JD library */}
            <section className="tool-section">
              <h2 className="tool-section-title">JD 库</h2>
              {loadingJd ? (
                <div className="tool-empty">加载中...</div>
              ) : !isSignedIn ? (
                <div className="tool-empty">登录后可查看 JD 库与当前活跃 JD。</div>
              ) : !jdLibrary?.files.length ? (
                <div className="tool-empty">还没有 JD，添加后会显示在这里。</div>
              ) : (
                <div className="space-y-3">
                  {jdLibrary.files.map((file) => {
                    const isActive = file.name === jdLibrary.profile?.active_jd_file;
                    return (
                      <div
                        key={file.name}
                        className={`tool-radio-item flex-col items-start gap-2 ${
                          isActive ? "border-primary/40 bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            {isActive && (
                              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                默认
                              </span>
                            )}
                            <span className="truncate text-sm font-medium text-foreground">
                              {file.name}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {!isActive && (
                              <button
                                onClick={() => void onSelectJd(file.name)}
                                disabled={selectingJd === file.name}
                                className="action-secondary py-1.5 text-xs"
                              >
                                {selectingJd === file.name ? "设置中..." : "设为默认"}
                              </button>
                            )}
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
      </div>
    </PageShell>
  );
}
