"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { PageHero, PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
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
    <PageShell className="max-w-none">
      <PageHero
        eyebrow="Resume Parse"
        title="把原始简历转成可检索、可评分、可复用的候选人画像"
        description="上传 PDF、DOCX 或文本版简历后，系统会生成摘要并落入本地知识库，为后续 JD 对齐、面试提问和评分证据提供统一上下文。"
        aside={(
          <>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">当前用户</p>
              <p className="mt-3 text-lg font-semibold text-foreground">{userId}</p>
            </article>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">支持格式</p>
              <p className="mt-3 text-sm leading-6 text-foreground">txt / md / json / html / pdf / docx</p>
            </article>
          </>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <PagePanel className="space-y-5">
          <div>
            <span className="eyebrow-chip">Resume Input</span>
            <h2 className="mt-3 text-2xl font-semibold text-foreground">上传原始资料并整理成可解析文本</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">左侧是本次解析的输入区。先确定候选人姓名和文件名，再上传文件或直接粘贴文本，最后执行解析并保存。</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">姓名</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="field-shell w-full" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">文件名</span>
              <input value={filename} onChange={(e) => setFilename(e.target.value)} className="field-shell w-full" />
            </label>
          </div>

          <section className="rounded-[1.4rem] border border-dashed border-border bg-background/80 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">上传简历文件</h2>
                <p className="mt-2 text-sm text-muted-foreground">{fileStatus}</p>
                {selectedFileName ? <p className="mt-1 text-xs text-muted-foreground">当前文件：{selectedFileName}</p> : null}
              </div>
              <label className="action-primary cursor-pointer">
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

          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">简历文本（上传后可继续修改）</span>
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              rows={16}
              className="field-shell w-full"
              placeholder="可直接粘贴简历，或上传 txt / md / pdf / docx 文件。"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button onClick={onParse} disabled={!canParse || parsing} className="action-primary">
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
              className="action-secondary"
            >
              清空本页
            </button>
          </div>

          <section className="rounded-[1.4rem] border border-border bg-background/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">调试输出</p>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-secondary p-3 text-xs leading-6">
              {result || "暂无结果"}
            </pre>
          </section>
        </PagePanel>

        <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          <PagePanel>
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="eyebrow-chip">Parse Status</span>
                <h3 className="mt-3 text-xl font-semibold text-foreground">本次解析状态</h3>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${parsed ? "bg-emerald-500/12 text-emerald-700" : "bg-amber-500/12 text-amber-700"}`}>
                {parsed ? "已完成" : "待解析"}
              </span>
            </div>

            {parsed ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">用户画像摘要</p>
                  <p className="mt-2 text-sm leading-6 text-foreground">{parsed.resume_summary}</p>
                </div>
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-xs text-muted-foreground">保存路径</p>
                  <p className="mt-2 break-all text-sm leading-6 text-foreground">{parsed.saved_path}</p>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-secondary p-4 text-sm leading-6 text-muted-foreground">
                解析成功后，这里会展示画像摘要与落盘位置，方便你继续进入 JD 对齐和模拟面试。
              </div>
            )}
          </PagePanel>

          <PagePanel>
            <span className="eyebrow-chip">Guidance</span>
            <h3 className="mt-3 text-xl font-semibold text-foreground">排版与资料建议</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <div className="rounded-xl bg-background/80 p-4">
                优先上传结构清晰的 PDF 或 DOCX，项目经历、职责范围、技术栈和结果指标越明确，后续问答越稳定。
              </div>
              <div className="rounded-xl bg-background/80 p-4">
                如果需要微调内容，建议先上传文件，再在左侧文本区补充项目背景、权衡和结果。
              </div>
            </div>
          </PagePanel>
        </div>
      </div>
    </PageShell>
  );
}
