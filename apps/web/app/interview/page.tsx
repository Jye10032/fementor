"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ClipboardCheck, FileText, FileUp, MessageSquareMore } from "lucide-react";
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

export default function InterviewPage() {
  const router = useRouter();
  const { apiBase, userId } = useRuntimeConfig();
  const [resumeMode, setResumeMode] = useState<"existing" | "upload">("existing");
  const [jdMode, setJdMode] = useState<"existing" | "upload">("existing");
  const [resumeLibrary, setResumeLibrary] = useState<ResumeLibraryResponse | null>(null);
  const [jdLibrary, setJdLibrary] = useState<JdLibraryResponse | null>(null);
  const [loadingResumeLibrary, setLoadingResumeLibrary] = useState(false);
  const [loadingJdLibrary, setLoadingJdLibrary] = useState(false);
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

  const canUseExistingResume = Boolean(resumeLibrary?.profile?.resume_summary);
  const canUseExistingJd = Boolean(jdLibrary?.files.length || jdLibrary?.profile?.active_jd_file);
  const hasReadyResume = resumeMode === "existing"
    ? canUseExistingResume && Boolean(selectedExistingResumeFile || resumeLibrary?.profile?.active_resume_file)
    : Boolean(parsedResume?.resume_summary);
  const hasReadyJd = jdMode === "existing"
    ? canUseExistingJd && Boolean(selectedExistingJdFile || jdLibrary?.profile?.active_jd_file)
    : Boolean(jdText.trim());
  const canStart = hasReadyResume && hasReadyJd;

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
    <section className="p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="grid gap-6 px-6 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Interview Entry</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                先选简历，再选 JD，最后进入模拟面试
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                系统会先同步你本场使用的简历与岗位 JD，再生成一组更接近真实面试顺序的问题队列。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={onStart}
                  disabled={starting || savingJd || !canStart}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {starting ? "启动中..." : savingJd ? "同步 JD 中..." : "开始模拟面试"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {[
                { title: "1. 选择简历", desc: "已有简历直接选择，没有就现场上传并解析。", icon: FileUp },
                { title: "2. 选择 JD", desc: "已保存 JD 可直接复用，也可以这次临时上传。", icon: FileText },
                { title: "3. 进入面试", desc: "从自我介绍开始，再按 JD 和项目经历逐步深挖。", icon: ClipboardCheck },
              ].map((item) => (
                <article key={item.title} className="rounded-2xl border border-border bg-background/80 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
                    <item.icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.desc}</p>
                </article>
              ))}
            </section>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="space-y-6 rounded-3xl border border-border bg-card p-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">面试准备</h2>
              <p className="mt-1 text-sm text-muted-foreground">本场只需要两份输入：候选人简历和目标岗位 JD。</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-4 rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center gap-2">
                  <FileUp className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">简历</p>
                    <p className="text-xs text-muted-foreground">选择已有简历，或本页上传一份新的。</p>
                  </div>
                </div>

                <article className={`rounded-2xl border p-4 ${resumeMode === "existing" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">使用已有简历</p>
                      <p className="mt-1 text-sm text-muted-foreground">直接复用已经解析过的候选人画像。</p>
                    </div>
                    <input type="radio" checked={resumeMode === "existing"} onChange={() => setResumeMode("existing")} disabled={!canUseExistingResume} />
                  </div>
                  <div className="mt-4 rounded-xl bg-secondary p-4 text-sm">
                    {loadingResumeLibrary ? (
                      <p className="text-muted-foreground">简历信息加载中...</p>
                    ) : canUseExistingResume ? (
                      <>
                        <p className="text-xs text-muted-foreground">当前活跃简历</p>
                        <p className="mt-2 text-sm font-medium text-foreground">{resumeLibrary?.profile?.active_resume_file || "未设置"}</p>
                        <p className="mt-3 text-xs text-muted-foreground">当前画像摘要</p>
                        <p className="mt-2 leading-6 text-foreground">{resumeLibrary?.profile?.resume_summary}</p>
                        <div className="mt-3 space-y-2">
                          {resumeLibrary?.files.map((file) => (
                            <label key={file.name} className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                              <input type="radio" checked={selectedExistingResumeFile === file.name} onChange={() => setSelectedExistingResumeFile(file.name)} />
                              <span className="flex-1 text-sm text-foreground">{file.name}</span>
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

                <article className={`rounded-2xl border p-4 ${resumeMode === "upload" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">现在上传简历</p>
                      <p className="mt-1 text-sm text-muted-foreground">上传后立即解析，并作为本场简历。</p>
                    </div>
                    <input type="radio" checked={resumeMode === "upload"} onChange={() => setResumeMode("upload")} />
                  </div>
                  <div className="mt-4 grid gap-3">
                    <label className="text-sm">
                      <span className="mb-1 block text-muted-foreground">姓名</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
                    </label>
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80">
                      {uploadingResumeFile ? "读取中..." : "选择简历文件"}
                      <input type="file" accept=".txt,.md,.markdown,.json,.html,.htm,.csv,.pdf,.docx,text/plain,text/markdown,text/html,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={onResumeFileChange} className="hidden" />
                    </label>
                    <p className="text-xs text-muted-foreground">{resumeFileStatus}</p>
                    {selectedResumeFileName ? <p className="text-xs text-muted-foreground">当前文件：{selectedResumeFileName}</p> : null}
                    <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} rows={8} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" placeholder="可直接粘贴简历，或先上传文本文件。" />
                    <button onClick={onParseResume} disabled={parsingResume || !resumeText.trim()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
                      {parsingResume ? "解析中..." : "解析并作为本场简历"}
                    </button>
                    {parsedResume ? <p className="text-xs text-emerald-700">已解析成功：{parsedResume.resume_summary}</p> : null}
                  </div>
                </article>
              </section>

              <section className="space-y-4 rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center gap-2">
                  <MessageSquareMore className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">岗位 JD</p>
                    <p className="text-xs text-muted-foreground">选择已有 JD，或本页上传一份新的。</p>
                  </div>
                </div>

                <article className={`rounded-2xl border p-4 ${jdMode === "existing" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">使用已有 JD</p>
                      <p className="mt-1 text-sm text-muted-foreground">复用之前保存过的岗位描述。</p>
                    </div>
                    <input type="radio" checked={jdMode === "existing"} onChange={() => setJdMode("existing")} disabled={!canUseExistingJd} />
                  </div>
                  <div className="mt-4 rounded-xl bg-secondary p-4 text-sm">
                    {loadingJdLibrary ? (
                      <p className="text-muted-foreground">JD 信息加载中...</p>
                    ) : canUseExistingJd ? (
                      <>
                        <p className="text-xs text-muted-foreground">当前活跃 JD</p>
                        <p className="mt-2 text-sm font-medium text-foreground">{jdLibrary?.profile?.active_jd_file || "未设置"}</p>
                        <div className="mt-3 space-y-2">
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

                <article className={`rounded-2xl border p-4 ${jdMode === "upload" ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">现在上传 JD</p>
                      <p className="mt-1 text-sm text-muted-foreground">上传后会保存到本地库，并作为本场 JD。</p>
                    </div>
                    <input type="radio" checked={jdMode === "upload"} onChange={() => setJdMode("upload")} />
                  </div>
                  <div className="mt-4 grid gap-3">
                    <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80">
                      {uploadingJdFile ? "读取中..." : "选择 JD 文件"}
                      <input type="file" accept=".txt,.md,.markdown,.json,.html,.htm,.csv,text/plain,text/markdown,text/html,application/json" onChange={onJdFileChange} className="hidden" />
                    </label>
                    <p className="text-xs text-muted-foreground">{jdFileStatus}</p>
                    {jdFileName ? <p className="text-xs text-muted-foreground">当前 JD 文件：{jdFileName}</p> : null}
                    <input value={jdFilename} onChange={(event) => setJdFilename(event.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" placeholder="JD 文件名，例如 jd-fe-senior.md" />
                    <textarea value={jdText} onChange={(event) => setJdText(event.target.value)} rows={10} className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" placeholder="粘贴岗位描述，例如岗位职责、技术要求、业务方向、级别要求等。" />
                  </div>
                </article>
              </section>
            </div>

            <div className="rounded-2xl bg-background p-4 text-sm text-muted-foreground">
              当前用户 <span className="font-medium text-foreground">{userId}</span> 将进入一场基于
              <span className="font-medium text-foreground"> 简历 + JD </span>
              的综合模拟面试。系统会先让你做开场自我介绍，再根据 JD 要求和项目经历逐步深入提问。
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card p-6">
            <p className="text-sm font-semibold text-foreground">启动预览</p>
            <pre className="mt-4 max-h-72 overflow-auto rounded-2xl bg-secondary p-4 text-xs text-foreground">{output || "开始会话后，这里会短暂显示同步结果，然后立即跳转。"}</pre>
          </section>
        </section>
      </div>
    </section>
  );
}
