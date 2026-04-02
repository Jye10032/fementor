"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { JdLibraryResponse } from "../_lib/interview-page.types";

type UseJdPanelParams = {
  apiBase: string;
  enabled: boolean;
};

export function useJdPanel({ apiBase, enabled }: UseJdPanelParams) {
  const [jdLibrary, setJdLibrary] = useState<JdLibraryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [switchingJd, setSwitchingJd] = useState("");
  const [jdPickerOpen, setJdPickerOpen] = useState(false);
  const hasFetched = useRef(false);

  const activeJd = useMemo(
    () =>
      jdLibrary?.profile?.active_jd_file
        ? jdLibrary.files.find((file) => file.name === jdLibrary.profile?.active_jd_file) ?? null
        : null,
    [jdLibrary],
  );

  const refreshJdLibrary = async () => {
    if (!enabled) {
      if (!hasFetched.current) setJdLibrary(null);
      return;
    }
    if (!hasFetched.current) setLoading(true);
    try {
      const jdData = await apiRequest<JdLibraryResponse>(apiBase, "/v1/jd/library", {
        auth: "required",
      });
      setJdLibrary(jdData);
      hasFetched.current = true;
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
