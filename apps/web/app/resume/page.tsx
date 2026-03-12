"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { RuntimeConfig, useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";

type ResumeParseResponse = {
  user_id: string;
  resume_summary: string;
  saved_path: string;
};

const TEXT_FILE_EXTENSIONS = ["txt", "md", "markdown", "json", "html", "htm", "csv"];
const BINARY_RESUME_EXTENSIONS = ["pdf", "docx"];
const RESUME_FILE_EXTENSIONS = [...TEXT_FILE_EXTENSIONS, ...BINARY_RESUME_EXTENSIONS];

function getFileExtension(filename: string) {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

export default function ResumePage() {
  const { apiBase, setApiBase, userId, setUserId } = useRuntimeConfig();
  const [name, setName] = useState("Alice");
  const [filename, setFilename] = useState("resume.md");
  const [resumeText, setResumeText] = useState("");
  const [resumeUploadFile, setResumeUploadFile] = useState<File | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [fileStatus, setFileStatus] = useState("支持上传 txt / md / json / html / pdf / docx。");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ResumeParseResponse | null>(null);
  const [result, setResult] = useState("");

  const canParse = useMemo(() => resumeText.trim().length > 0 || Boolean(resumeUploadFile), [resumeText, resumeUploadFile]);

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = getFileExtension(file.name);
    setSelectedFileName(file.name);
    setFilename(file.name);

    if (!RESUME_FILE_EXTENSIONS.includes(ext)) {
      setFileStatus(`暂不支持直接读取 .${ext || "unknown"} 文件。当前支持 txt / md / json / html / pdf / docx。`);
      return;
    }

    if (BINARY_RESUME_EXTENSIONS.includes(ext)) {
      try {
        setUploadingFile(true);
        setResumeUploadFile(file);
        setResumeText("");
        setFileStatus(`已读取 ${file.name} 二进制内容，将在解析时自动抽取文本。`);
      } catch (error) {
        setFileStatus(`文件读取失败：${String(error)}`);
      } finally {
        setUploadingFile(false);
        event.target.value = "";
      }
      return;
    }

    try {
      setUploadingFile(true);
      const text = await file.text();
      setResumeText(text);
      setResumeUploadFile(null);
      setFileStatus(`已读取 ${file.name}，共 ${text.length} 字符。你可以继续编辑后再解析。`);
    } catch (error) {
      setFileStatus(`文件读取失败：${String(error)}`);
    } finally {
      setUploadingFile(false);
      event.target.value = "";
    }
  };

  const onParse = async () => {
    try {
      setParsing(true);
      const formData = new FormData();
      formData.append("user_id", userId);
      formData.append("name", name);
      formData.append("filename", filename);
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
      setParsed(data);
      setFileStatus(`已保存到 ${data.saved_path}`);
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(String(error));
    } finally {
      setParsing(false);
    }
  };

  return (
    <section className="p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <RuntimeConfig apiBase={apiBase} onApiBaseChange={setApiBase} userId={userId} onUserIdChange={setUserId} />
        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">简历解析</h1>
              <p className="text-sm text-muted-foreground">上传文本资料，生成用户画像并同步进入本地检索库。</p>
            </div>
            <div className="rounded-2xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
              当前用户：<span className="font-medium text-foreground">{userId}</span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">姓名</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">文件名</span>
              <input value={filename} onChange={(e) => setFilename(e.target.value)} className="w-full rounded-xl border border-input bg-background px-3 py-2" />
            </label>
          </div>
          <section className="mt-4 rounded-2xl border border-dashed border-border bg-background p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">上传简历文件</h2>
                <p className="mt-2 text-sm text-muted-foreground">{fileStatus}</p>
                {selectedFileName ? <p className="mt-1 text-xs text-muted-foreground">当前文件：{selectedFileName}</p> : null}
              </div>
              <label className="inline-flex cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                {uploadingFile ? "读取中..." : "选择文件"}
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.json,.html,.htm,.csv,.pdf,.docx,text/plain,text/markdown,text/html,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={onFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </section>
          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-muted-foreground">简历文本（上传后可继续修改）</span>
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              rows={14}
              className="w-full rounded-xl border border-input bg-background px-3 py-2"
              placeholder="可直接粘贴简历，或上传 txt / md / pdf / docx 文件。"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={onParse} disabled={!canParse || parsing} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60">
              {parsing ? "解析中..." : "解析并保存"}
            </button>
            <button
              onClick={() => {
                setResumeText("");
                setResumeUploadFile(null);
                setParsed(null);
                setResult("");
                setSelectedFileName("");
                setFileStatus("支持上传 txt / md / json / html / pdf / docx。");
              }}
              className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
            >
              清空本页
            </button>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">解析结果</p>
              {parsed ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">用户画像摘要</p>
                    <p className="mt-2 text-sm leading-6 text-foreground">{parsed.resume_summary}</p>
                  </div>
                  <div className="rounded-xl bg-secondary p-4">
                    <p className="text-xs text-muted-foreground">保存路径</p>
                    <p className="mt-2 break-all text-sm text-foreground">{parsed.saved_path}</p>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded-xl bg-secondary p-4 text-sm text-muted-foreground">
                  解析成功后，这里会展示简历摘要和文档落盘位置。
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">调试输出</p>
              <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-secondary p-3 text-xs">{result || "暂无结果"}</pre>
            </section>
          </div>
        </section>
      </div>
    </section>
  );
}
