"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { ResumeLibraryResponse } from "../_lib/interview-page.types";

type UseResumePanelParams = {
  apiBase: string;
  enabled: boolean;
};

let cachedResumeLibrary: ResumeLibraryResponse | null = null;

export function useResumePanel({ apiBase, enabled }: UseResumePanelParams) {
  const [resumeLibrary, setResumeLibrary] = useState<ResumeLibraryResponse | null>(cachedResumeLibrary);
  const [loading, setLoading] = useState(false);
  const [switchingResume, setSwitchingResume] = useState("");
  const [resumePickerOpen, setResumePickerOpen] = useState(false);

  const activeResume = useMemo(
    () =>
      resumeLibrary?.files.find((file) => file.name === resumeLibrary.profile?.active_resume_file) ?? null,
    [resumeLibrary],
  );

  const refreshResumeLibrary = async () => {
    if (!enabled) return;
    if (!cachedResumeLibrary) setLoading(true);
    try {
      const resumeData = await apiRequest<ResumeLibraryResponse>(apiBase, "/v1/resume/library", {
        auth: "required",
      });
      cachedResumeLibrary = resumeData;
      setResumeLibrary(resumeData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshResumeLibrary();
  }, [apiBase, enabled]);

  const onSelectResume = async (fileName: string) => {
    setSwitchingResume(fileName);
    try {
      await apiRequest(apiBase, "/v1/resume/select", {
        method: "POST",
        body: JSON.stringify({ file_name: fileName }),
        auth: "required",
      });
      await refreshResumeLibrary();
      setResumePickerOpen(false);
    } catch {
      // ignore
    } finally {
      setSwitchingResume("");
    }
  };

  return {
    resumeLibrary,
    loadingResumeLibrary: loading,
    switchingResume,
    resumePickerOpen,
    activeResume,
    setResumePickerOpen,
    refreshResumeLibrary,
    onSelectResume,
  };
}
