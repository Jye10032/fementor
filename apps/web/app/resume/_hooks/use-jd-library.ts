"use client";

import { ChangeEvent, useCallback, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { getFileExtension, JD_FILE_EXTENSIONS, JdLibraryResponse } from "../_lib/resume.types";

export function useJdLibrary(apiBase: string, isSignedIn: boolean) {
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
  const [jdDragOver, setJdDragOver] = useState(false);
  const [deletingJd, setDeletingJd] = useState("");

  const canSaveJd = useMemo(() => jdText.trim().length > 0, [jdText]);

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

  const handleJdDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setJdDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const fakeEvent = { target: { files: [file], value: "" } } as unknown as ChangeEvent<HTMLInputElement>;
    onJdFileChange(fakeEvent);
  }, []);

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

  const onDeleteJd = async (fileName: string) => {
    if (!window.confirm("确认删除该 JD？")) return;
    setDeletingJd(fileName);
    try {
      await apiRequest(apiBase, "/v1/jd/delete", {
        method: "DELETE",
        body: JSON.stringify({ file_name: fileName }),
        auth: "required",
      });
      await refreshJdLibrary();
    } catch {
      // ignore
    } finally {
      setDeletingJd("");
    }
  };

  return {
    jdLibrary, loadingJd, selectingJd, deletingJd,
    jdFilename, setJdFilename, jdText, setJdText,
    jdFileStatus, uploadingJdFile, savingJd,
    jdDragOver, setJdDragOver,
    canSaveJd,
    refreshJdLibrary, onJdFileChange, handleJdDrop,
    onSaveJd, onSelectJd, onDeleteJd,
  };
}
