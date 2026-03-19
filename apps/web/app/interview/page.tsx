"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ClipboardCheck, FileText, FileUp, MessageSquareMore, Sparkles } from "lucide-react";
import { PageHero, PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";

type StartSessionResponse = { id: string; user_id: string; status: string; started_at: string };
type ResumeLibraryResponse = {
  user_id: string;
  has_resume: boolean;
  profile: {
    id: string;
    name: string;
    resume_summary: string;
    active_resume_file: string;
    active_jd_file?: string;
    updated_at: string;
  } | null;
  files: Array<{
    name: string;
    path: string;
    size: number;
    updated_at: string;
    summary: string;
    original_filename: string;
  }>;
};
type JdLibraryResponse = {
  user_id: string;
  has_jd: boolean;
  profile: {
    id: string;
    name: string;
    active_jd_file: string;
    updated_at: string;
  } | null;
  files: Array<{
    name: string;
    path: string;
    size: number;
    updated_at: string;
  }>;
};
type ResumeParseResponse = {
  user_id: string;
  resume_summary: string;
  saved_path: string;
  parse_meta?: {
    parser?: string;
    used_ocr?: boolean;
    fallback_used?: boolean;
    quality?: string;
    original_filename?: string;
    fallback_reason?: string;
    docling_stdout_preview?: string;
    docling_stderr_preview?: string;
  } | null;
};
type JdUploadResponse = {
  user_id: string;
  active_jd_file: string;
  saved_path: string;
};

const TEXT_FILE_EXTENSIONS = ["txt", "md", "markdown", "json", "html", "htm", "csv"];
const BINARY_RESUME_EXTENSIONS = ["pdf", "docx"];
const RESUME_FILE_EXTENSIONS = [...TEXT_FILE_EXTENSIONS, ...BINARY_RESUME_EXTENSIONS];
const JD_FILE_EXTENSIONS = TEXT_FILE_EXTENSIONS;

function getFileExtension(filename: string) {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

function ModeSwitch({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="inline-flex rounded-2xl border border-border bg-background/90 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          className={
            value === option.value
              ? "rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm"
              : "rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function InterviewPage() {
  const router = useRouter();
  const { apiBase, userId } = useRuntimeConfig();
  const [resumeMode, setResumeMode] = useState<"existing" | "upload">("existing");
  const [jdMode, setJdMode] = useState<"existing" | "upload">("existing");
  const [resumeLibrary, setResumeLibrary] = useState<ResumeLibraryResponse | null>(null);
  const [jdLibrary, setJdLibrary] = useState<JdLibraryResponse | null>(null);
  const [loadingResumeLibrary, setLoadingResumeLibrary] = useState(false);
  const [loadingJdLibrary, setLoadingJdLibrary] = useState(false);
  const [switchingResumeFile, setSwitchingResumeFile] = useState(false);
  const [name, setName] = useState("Alice");
  const [resumeFilename, setResumeFilename] = useState("resume.md");
  const [resumeText, setResumeText] = useState("");
  const [resumeUploadFile, setResumeUploadFile] = useState<File | null>(null);
  const [selectedResumeFileName, setSelectedResumeFileName] = useState("");
  const [resumeFileStatus, setResumeFileStatus] = useState("支持上传 txt / md / json / html / pdf / docx。");
  const [uploadingResumeFile, setUploadingResumeFile] = useState(false);
  const [parsingResume, setParsingResume] = useState(false);
  const [parsedResume, setParsedResume] = useState<ResumeParseResponse | null>(null);
  const [selectedExistingResumeFile, setSelectedExistingResumeFile] = useState("");
  const [jdText, setJdText] = useState("");
  const [jdFilename, setJdFilename] = useState("jd.md");
  const [jdFileName, setJdFileName] = useState("");
  const [jdFileStatus, setJdFileStatus] = useState("支持上传 txt / md / json / html 等文本文件，或直接粘贴 JD 文本。");
  const [uploadingJdFile, setUploadingJdFile] = useState(false);
  const [savingJd, setSavingJd] = useState(false);
  const [selectedExistingJdFile, setSelectedExistingJdFile] = useState("");
  const [starting, setStarting] = useState(false);
  const [output, setOutput] = useState("");

  const canUseExistingResume = Boolean(resumeLibrary?.files.length);
  const canUseExistingJd = Boolean(jdLibrary?.files.length || jdLibrary?.profile?.active_jd_file);
  // Binary resumes are parsed server-side, so a selected file is enough to enable parsing.
  const canParseUploadedResume = Boolean(resumeText.trim() || resumeUploadFile);
  const hasReadyResume = resumeMode === "existing"
    ? canUseExistingResume && Boolean(selectedExistingResumeFile || resumeLibrary?.profile?.active_resume_file)
    : Boolean(parsedResume?.resume_summary);
  const hasReadyJd = jdMode === "existing"
    ? canUseExistingJd && Boolean(selectedExistingJdFile || jdLibrary?.profile?.active_jd_file)
    : Boolean(jdText.trim());
  const canStart = hasReadyResume && hasReadyJd;
  const selectedResumeSummary = resumeLibrary?.files.find(
    (file) => file.name === (selectedExistingResumeFile || resumeLibrary?.profile?.active_resume_file),
  )?.summary || resumeLibrary?.profile?.resume_summary || "";
  const activeResumeFileName = selectedExistingResumeFile || resumeLibrary?.profile?.active_resume_file || "未选择";
  const activeJdFileName = selectedExistingJdFile || jdLibrary?.profile?.active_jd_file || "未选择";

  const refreshResumeLibrary = async () => {
    try {
      setLoadingResumeLibrary(true);
      const data = await apiRequest<ResumeLibraryResponse>(apiBase, `/v1/resume/library?user_id=${encodeURIComponent(userId)}`);
      setResumeLibrary(data);
      if (data.profile?.name) setName(data.profile.name);
      setSelectedExistingResumeFile(data.profile?.active_resume_file || data.files[0]?.name || "");
    } catch (error) {
      setOutput(String(error));
      setResumeLibrary(null);
    } finally {
      setLoadingResumeLibrary(false);
    }
  };

  const refreshJdLibrary = async () => {
    try {
      setLoadingJdLibrary(true);
      const data = await apiRequest<JdLibraryResponse>(apiBase, `/v1/jd/library?user_id=${encodeURIComponent(userId)}`);
      setJdLibrary(data);
      setSelectedExistingJdFile(data.profile?.active_jd_file || data.files[0]?.name || "");
    } catch (error) {
      setOutput(String(error));
      setJdLibrary(null);
    } finally {
      setLoadingJdLibrary(false);
    }
  };

  const onSelectExistingResumeFile = async (fileName: string) => {
    try {
      setSwitchingResumeFile(true);
      setSelectedExistingResumeFile(fileName);
      const data = await apiRequest<{ active_resume_file: string; resume_summary: string }>(apiBase, "/v1/resume/select", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          file_name: fileName,
        }),
      });
      setResumeLibrary((previous) => previous ? {
        ...previous,
        profile: previous.profile ? {
          ...previous.profile,
          active_resume_file: data.active_resume_file,
          resume_summary: data.resume_summary,
        } : previous.profile,
      } : previous);
    } catch (error) {
      setOutput(String(error));
      await refreshResumeLibrary();
    } finally {
      setSwitchingResumeFile(false);
    }
  };

  useEffect(() => {
    void refreshResumeLibrary();
    void refreshJdLibrary();
  }, [apiBase, userId]);

  useEffect(() => {
    if (!canUseExistingResume) setResumeMode("upload");
  }, [canUseExistingResume]);

  useEffect(() => {
    if (!canUseExistingJd) setJdMode("upload");
  }, [canUseExistingJd]);

  const readTextFile = async (file: File, allowedExtensions: string[], setStatus: (value: string) => void, setLoading: (value: boolean) => void) => {
    const ext = getFileExtension(file.name);
    if (!allowedExtensions.includes(ext)) {
      setStatus(`暂不支持直接读取 .${ext || "unknown"} 文件。请先导出为 txt / md 后再上传，或直接粘贴文本。`);
      return null;
    }

    try {
      setLoading(true);
      const text = await file.text();
      setStatus(`已读取 ${file.name}，共 ${text.length} 字符。`);
      return text;
    } catch (error) {
      setStatus(`文件读取失败：${String(error)}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const onResumeFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedResumeFileName(file.name);
    setResumeFilename(file.name);
    const ext = getFileExtension(file.name);

    if (!RESUME_FILE_EXTENSIONS.includes(ext)) {
      setResumeFileStatus(`暂不支持直接读取 .${ext || "unknown"} 文件。当前支持 txt / md / json / html / pdf / docx。`);
      event.target.value = "";
      return;
    }

    if (BINARY_RESUME_EXTENSIONS.includes(ext)) {
      try {
        setUploadingResumeFile(true);
        setResumeUploadFile(file);
        setResumeText("");
        setResumeFileStatus(`已读取 ${file.name} 二进制内容，将在解析时自动抽取文本。`);
      } catch (error) {
        setResumeFileStatus(`文件读取失败：${String(error)}`);
      } finally {
        setUploadingResumeFile(false);
        event.target.value = "";
      }
      return;
    }

    const text = await readTextFile(file, TEXT_FILE_EXTENSIONS, setResumeFileStatus, setUploadingResumeFile);
    if (text !== null) {
      setResumeText(text);
      setResumeUploadFile(null);
    }
    event.target.value = "";
  };

  const onJdFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setJdFileName(file.name);
    setJdFilename(file.name);
    const text = await readTextFile(file, JD_FILE_EXTENSIONS, setJdFileStatus, setUploadingJdFile);
    if (text !== null) setJdText(text);
    event.target.value = "";
  };

  const onParseResume = async () => {
    try {
      setParsingResume(true);
      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("name", name);
      formData.append("filename", resumeFilename);
      if (resumeText.trim()) {
        formData.append("resume_text", resumeText);
      }
      if (resumeUploadFile) {
        formData.append("resume_file", resumeUploadFile, resumeUploadFile.name);
      }
      const data = await apiRequest<ResumeParseResponse>(apiBase, "/v1/resume/parse", {
        method: "POST",
        body: formData,
      });
      setParsedResume(data);
      setResumeMode("upload");
      setOutput(JSON.stringify(data, null, 2));
      await refreshResumeLibrary();
    } catch (error) {
      setOutput(String(error));
    } finally {
      setParsingResume(false);
    }
  };

  const syncInterviewAssets = async () => {
    if (resumeMode === "existing") {
      await apiRequest(apiBase, "/v1/resume/select", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          file_name: selectedExistingResumeFile || resumeLibrary?.profile?.active_resume_file,
        }),
      });
    }

    if (jdMode === "existing") {
      await apiRequest(apiBase, "/v1/jd/select", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          file_name: selectedExistingJdFile || jdLibrary?.profile?.active_jd_file,
        }),
      });
      return;
    }

    setSavingJd(true);
    try {
      const jdSaved = await apiRequest<JdUploadResponse>(apiBase, "/v1/jd/upload", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          filename: jdFilename,
          jd_text: jdText,
        }),
      });
      setOutput(JSON.stringify(jdSaved, null, 2));
      await refreshJdLibrary();
    } finally {
      setSavingJd(false);
    }
  };

  const onStart = async () => {
    if (!canStart) return;
    try {
      setStarting(true);
      await syncInterviewAssets();
      const interview = await apiRequest<StartSessionResponse>(apiBase, "/v1/interview/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          target_level: "mid",
        }),
      });

      setOutput(JSON.stringify({ interview, resumeMode, jdMode }, null, 2));
      const query = new URLSearchParams({ session_id: interview.id });
      router.push(`/interview/session?${query.toString()}`);
    } catch (error) {
      setOutput(String(error));
    } finally {
      setStarting(false);
    }
  };

  return (
    <PageShell>
      <PageHero
        eyebrow="Interview Entry"
        title="先锁定候选人画像，再对准岗位 JD，最后进入一场像真的面试"
        description="这一页负责把本场会话需要的上下文准备干净。系统会同步你选择的简历与岗位信息，再生成更贴近真实节奏的问题队列。"
        actions={(
          <>
            <button
              onClick={onStart}
              disabled={starting || savingJd || !canStart}
              className="action-primary"
            >
              {starting ? "启动中..." : savingJd ? "同步 JD 中..." : "开始模拟面试"}
              <ArrowRight className="h-4 w-4" />
            </button>
            <div className="eyebrow-chip">
              当前用户 {userId}
            </div>
          </>
        )}
        aside={(
          <>
            {[
              { title: "1. 选择简历", desc: "已有简历直接复用，没有就现场上传并解析。", icon: FileUp },
              { title: "2. 选择 JD", desc: "支持复用已保存岗位，也支持本场临时上传。", icon: FileText },
              { title: "3. 进入面试", desc: "从开场自我介绍开始，再按经历和岗位要求深入。", icon: ClipboardCheck },
            ].map((item) => (
              <article key={item.title} className="panel-muted">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <item.icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.desc}</p>
              </article>
            ))}
          </>
        )}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PagePanel className="space-y-6">
          <div>
            <span className="eyebrow-chip">Interview Setup</span>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">面试准备</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">本场只需要两份输入：候选人简历和目标岗位 JD。准备完成后就可以直接进入会话。</p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-[1.5rem] border border-border bg-background/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">简历</p>
                    <p className="text-xs text-muted-foreground">选择已有简历，或本页上传一份新的。</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {resumeMode === "existing" ? "当前：已有简历" : "当前：现在上传"}
                  </span>
                  <ModeSwitch
                    value={resumeMode}
                    onChange={(value) => setResumeMode(value as "existing" | "upload")}
                    options={[
                      { value: "existing", label: "已有简历", disabled: !canUseExistingResume },
                      { value: "upload", label: "现在上传" },
                    ]}
                  />
                </div>
              </div>

              {resumeMode === "existing" ? (
                <article className="rounded-[1.25rem] border border-primary bg-primary/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">使用已有简历</p>
                      <p className="mt-1 text-sm text-muted-foreground">直接复用已经解析过的候选人画像。</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                      {resumeLibrary?.files.length || 0} 份可选
                    </span>
                  </div>
                  <div className="mt-4 rounded-[1rem] bg-secondary/70 p-4 text-sm">
                    {loadingResumeLibrary || switchingResumeFile ? (
                      <p className="text-muted-foreground">简历信息加载中...</p>
                    ) : canUseExistingResume ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">当前活跃简历</p>
                            <p className="mt-2 text-sm font-medium text-foreground">{resumeLibrary?.profile?.active_resume_file || "未设置"}</p>
                          </div>
                          <div className="rounded-full bg-background px-3 py-1 text-[11px] text-muted-foreground">
                            已解析画像
                          </div>
                        </div>
                        <p className="mt-4 text-xs text-muted-foreground">当前画像摘要</p>
                        <p className="mt-2 leading-6 text-foreground">{selectedResumeSummary || "该简历暂未生成摘要"}</p>
                        <div className="mt-4 max-h-72 space-y-2 overflow-auto pr-1">
                          {resumeLibrary?.files.map((file) => (
                            <label key={file.name} className="flex cursor-pointer items-start gap-2 rounded-xl border border-border bg-background px-3 py-2">
                              <input
                                type="radio"
                                checked={selectedExistingResumeFile === file.name}
                                onChange={() => {
                                  void onSelectExistingResumeFile(file.name);
                                }}
                                className="mt-1"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm text-foreground">{file.name}</span>
                                {file.summary ? (
                                  <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                                    {file.summary}
                                  </span>
                                ) : null}
                              </span>
                              {resumeLibrary.profile?.active_resume_file === file.name ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">当前活跃</span> : null}
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground">当前用户还没有可用简历，请切换到“现在上传简历”。</p>
                    )}
                  </div>
                </article>
              ) : (
                <article className="rounded-[1.25rem] border border-primary bg-primary/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">现在上传简历</p>
                      <p className="mt-1 text-sm text-muted-foreground">上传后立即解析，并作为本场简历。</p>
                    </div>
                    <span className="rounded-full bg-background px-3 py-1 text-[11px] text-muted-foreground">现场解析</span>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1 block text-muted-foreground">姓名</span>
                        <input value={name} onChange={(e) => setName(e.target.value)} className="field-shell w-full" />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-muted-foreground">简历文件名</span>
                        <input value={resumeFilename} onChange={(e) => setResumeFilename(e.target.value)} className="field-shell w-full" />
                      </label>
                    </div>
                    <label className="action-secondary cursor-pointer">
                      {uploadingResumeFile ? "读取中..." : "选择简历文件"}
                      <input type="file" accept=".txt,.md,.markdown,.json,.html,.htm,.csv,.pdf,.docx,text/plain,text/markdown,text/html,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onResumeFileChange} className="hidden" />
                    </label>
                    <p className="text-xs text-muted-foreground">{resumeFileStatus}</p>
                    {selectedResumeFileName ? <p className="text-xs text-muted-foreground">当前文件：{selectedResumeFileName}</p> : null}
                    <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={10} className="field-shell w-full text-sm" placeholder="可直接粘贴简历，或先上传文本文件。" />
                    <button onClick={onParseResume} disabled={parsingResume || !canParseUploadedResume} className="action-primary">
                      {parsingResume ? "解析中..." : "解析并作为本场简历"}
                    </button>
                    {parsedResume ? (
                      <div className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700">
                        已解析成功：{parsedResume.resume_summary}
                        {parsedResume.parse_meta?.parser ? `（解析器：${parsedResume.parse_meta.parser}）` : ""}
                      </div>
                    ) : null}
                  </div>
                </article>
              )}
            </section>

            <section className="space-y-4 rounded-[1.5rem] border border-border bg-background/80 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <MessageSquareMore className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">岗位 JD</p>
                    <p className="text-xs text-muted-foreground">选择已有 JD，或本页上传一份新的。</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium text-muted-foreground">
                    {jdMode === "existing" ? "当前：已有 JD" : "当前：现在上传"}
                  </span>
                  <ModeSwitch
                    value={jdMode}
                    onChange={(value) => setJdMode(value as "existing" | "upload")}
                    options={[
                      { value: "existing", label: "已有 JD", disabled: !canUseExistingJd },
                      { value: "upload", label: "现在上传" },
                    ]}
                  />
                </div>
              </div>

              {jdMode === "existing" ? (
                <article className="rounded-[1.25rem] border border-primary bg-primary/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">使用已有 JD</p>
                      <p className="mt-1 text-sm text-muted-foreground">复用之前保存过的岗位描述。</p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary">
                      {jdLibrary?.files.length || 0} 份可选
                    </span>
                  </div>
                  <div className="mt-4 rounded-[1rem] bg-secondary/70 p-4 text-sm">
                    {loadingJdLibrary ? (
                      <p className="text-muted-foreground">JD 信息加载中...</p>
                    ) : canUseExistingJd ? (
                      <>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">当前活跃 JD</p>
                            <p className="mt-2 text-sm font-medium text-foreground">{jdLibrary?.profile?.active_jd_file || "未设置"}</p>
                          </div>
                          <div className="rounded-full bg-background px-3 py-1 text-[11px] text-muted-foreground">
                            已保存岗位
                          </div>
                        </div>
                        <div className="mt-4 max-h-72 space-y-2 overflow-auto pr-1">
                          {jdLibrary?.files.map((file) => (
                            <label key={file.name} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                              <input type="radio" checked={selectedExistingJdFile === file.name} onChange={() => setSelectedExistingJdFile(file.name)} />
                              <span className="flex-1 text-sm text-foreground">{file.name}</span>
                              {jdLibrary?.profile?.active_jd_file === file.name ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">当前活跃</span> : null}
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-muted-foreground">当前还没有已保存 JD，请切换到“现在上传 JD”。</p>
                    )}
                  </div>
                </article>
              ) : (
                <article className="rounded-[1.25rem] border border-primary bg-primary/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">现在上传 JD</p>
                      <p className="mt-1 text-sm text-muted-foreground">上传后会保存到本地库，并作为本场 JD。</p>
                    </div>
                    <span className="rounded-full bg-background px-3 py-1 text-[11px] text-muted-foreground">本场上传</span>
                  </div>
                  <div className="mt-4 grid gap-3">
                    <label className="action-secondary cursor-pointer">
                      {uploadingJdFile ? "读取中..." : "选择 JD 文件"}
                      <input type="file" accept=".txt,.md,.markdown,.json,.html,.htm,.csv,text/plain,text/markdown,text/html,application/json" onChange={onJdFileChange} className="hidden" />
                    </label>
                    <p className="text-xs text-muted-foreground">{jdFileStatus}</p>
                    {jdFileName ? <p className="text-xs text-muted-foreground">当前 JD 文件：{jdFileName}</p> : null}
                    <input value={jdFilename} onChange={(event) => setJdFilename(event.target.value)} className="field-shell w-full text-sm" placeholder="JD 文件名，例如 jd-fe-senior.md" />
                    <textarea value={jdText} onChange={(event) => setJdText(event.target.value)} rows={10} className="field-shell w-full text-sm" placeholder="粘贴岗位描述，例如岗位职责、技术要求、业务方向、级别要求等。" />
                  </div>
                </article>
              )}
            </section>
          </div>

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="rounded-[1.4rem] bg-background/85 p-4 text-sm leading-6 text-muted-foreground">
              当前用户 <span className="font-medium text-foreground">{userId}</span> 将进入一场基于
              <span className="font-medium text-foreground"> 简历 + JD </span>
              的综合模拟面试。系统会先让你做开场自我介绍，再根据 JD 要求和项目经历逐步深入提问。
            </div>
            <div className="rounded-[1.4rem] bg-secondary/70 p-4 text-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前选择</p>
              <p className="mt-3 text-sm font-medium text-foreground">简历：{activeResumeFileName}</p>
              <p className="mt-2 text-sm font-medium text-foreground">JD：{activeJdFileName}</p>
            </div>
          </div>
        </PagePanel>

        <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          <PagePanel>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="text-base font-semibold text-foreground">启动前检查</h3>
            </div>

            <div className="mt-4 grid gap-3">
              {[
                { label: "当前用户", ready: true, detail: userId },
                { label: "简历已准备", ready: hasReadyResume, detail: activeResumeFileName },
                { label: "JD 已准备", ready: hasReadyJd, detail: activeJdFileName },
                { label: "可启动会话", ready: canStart, detail: canStart ? "上下文已齐备" : "仍需补齐资料" },
              ].map((item) => (
                <article key={item.label} className="rounded-[1.1rem] border border-border bg-background/80 p-4">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${item.ready ? "bg-emerald-500/12 text-emerald-700" : "bg-amber-500/12 text-amber-700"}`}>
                      <CheckCircle2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <button
              onClick={onStart}
              disabled={starting || savingJd || !canStart}
              className="action-primary mt-5 w-full"
            >
              {starting ? "启动中..." : savingJd ? "同步 JD 中..." : "开始模拟面试"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </PagePanel>

          <PagePanel>
            <p className="text-sm font-semibold text-foreground">启动预览</p>
            <pre className="mt-4 max-h-72 overflow-auto rounded-[1.2rem] bg-secondary/75 p-4 text-xs leading-6 text-foreground">{output || "开始会话后，这里会短暂显示同步结果，然后立即跳转。"}</pre>
          </PagePanel>
        </div>
      </section>
    </PageShell>
  );
}
