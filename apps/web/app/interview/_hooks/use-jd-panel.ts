"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { JdLibraryResponse } from "../_lib/interview-page.types";

type UseJdPanelParams = {
  apiBase: string;
  userId: string;
};

export function useJdPanel({ apiBase, userId }: UseJdPanelParams) {
  const [jdLibrary, setJdLibrary] = useState<JdLibraryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [switchingJd, setSwitchingJd] = useState("");
  const [jdPickerOpen, setJdPickerOpen] = useState(false);

  const activeJd = useMemo(
    () =>
      jdLibrary?.profile?.active_jd_file
        ? jdLibrary.files.find((file) => file.name === jdLibrary.profile?.active_jd_file) ?? null
        : null,
    [jdLibrary],
  );

  const refreshJdLibrary = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const jdData = await apiRequest<JdLibraryResponse>(
        apiBase,
        `/v1/jd/library?user_id=${encodeURIComponent(userId)}`,
      );
      setJdLibrary(jdData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshJdLibrary();
  }, [apiBase, userId]);

  const onSelectJd = async (fileName: string) => {
    setSwitchingJd(fileName);
    try {
      await apiRequest(apiBase, "/v1/jd/select", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, file_name: fileName }),
      });
      await refreshJdLibrary();
      setJdPickerOpen(false);
    } catch {
      // ignore
    } finally {
      setSwitchingJd("");
    }
  };

  return {
    jdLibrary,
    loadingJdLibrary: loading,
    switchingJd,
    jdPickerOpen,
    activeJd,
    setJdPickerOpen,
    refreshJdLibrary,
    onSelectJd,
  };
}
