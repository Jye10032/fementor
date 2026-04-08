"use client";

import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api";
import {
  BINARY_RESUME_EXTENSIONS,
  getFileExtension,
  RESUME_FILE_EXTENSIONS,
  ResumeLibraryResponse,
  TEXT_FILE_EXTENSIONS,
} from "../_lib/resume.types";

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

export function useResumeLibrary(apiBase: string, isSignedIn: boolean, refreshViewer: () => Promise<unknown>) {
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
  const [resumeDragOver, setResumeDragOver] = useState(false);
  const [deletingResume, setDeletingResume] = useState("");

  const canParseResume = useMemo(
    () => resumeText.trim().length > 0 || Boolean(resumeUploadFile),
    [resumeText, resumeUploadFile]
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

  const handleResumeDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setResumeDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const fakeEvent = { target: { files: [file], value: "" } } as unknown as ChangeEvent<HTMLInputElement>;
    onResumeFileChange(fakeEvent);
  }, []);

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

  const onDeleteResume = async (fileName: string) => {
    if (!window.confirm("确认删除该简历？")) return;
    setDeletingResume(fileName);
    try {
      await apiRequest(apiBase, "/v1/resume/delete", {
        method: "DELETE",
        body: JSON.stringify({ file_name: fileName }),
        auth: "required",
      });
      await refreshResumeLibrary();
    } catch {
      // ignore
    } finally {
      setDeletingResume("");
    }
  };

  return {
    resumeLibrary, loadingResume, selectingResume, deletingResume,
    name, setName, resumeFilename, setResumeFilename,
    resumeText, setResumeText, resumeUploadFile,
    resumeFileStatus, uploadingResumeFile, parsingResume,
    resumeDragOver, setResumeDragOver,
    canParseResume,
    refreshResumeLibrary, onResumeFileChange, handleResumeDrop,
    onParseResume, onSelectResume, onDeleteResume,
  };
}
