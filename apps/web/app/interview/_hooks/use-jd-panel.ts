"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { JdLibraryResponse } from "../_lib/interview-page.types";

type UseJdPanelParams = {
  apiBase: string;
  enabled: boolean;
};

let cachedJdLibrary: JdLibraryResponse | null = null;

export function useJdPanel({ apiBase, enabled }: UseJdPanelParams) {
  const [jdLibrary, setJdLibrary] = useState<JdLibraryResponse | null>(cachedJdLibrary);
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
    if (!enabled) return;
    if (!cachedJdLibrary) setLoading(true);
    try {
      const jdData = await apiRequest<JdLibraryResponse>(apiBase, "/v1/jd/library", {
        auth: "required",
      });
      cachedJdLibrary = jdData;
      setJdLibrary(jdData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshJdLibrary();
  }, [apiBase, enabled]);

  const onSelectJd = async (fileName: string) => {
    setSwitchingJd(fileName);
    try {
      await apiRequest(apiBase, "/v1/jd/select", {
        method: "POST",
        body: JSON.stringify({ file_name: fileName }),
        auth: "required",
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
