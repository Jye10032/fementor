"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { InterviewSession, SessionListResponse } from "../_lib/interview-page.types";

type UseInterviewHistoryParams = {
  apiBase: string;
  enabled: boolean;
};

export function useInterviewHistory({ apiBase, enabled }: UseInterviewHistoryParams) {
  const [sessionHistory, setSessionHistory] = useState<InterviewSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const refreshSessionHistory = async () => {
    if (!enabled) {
      setSessionHistory([]);
      return;
    }
    setLoadingHistory(true);
    try {
      const data = await apiRequest<SessionListResponse>(apiBase, "/v1/interview/sessions", {
        auth: "required",
      });
      setSessionHistory(data.items);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void refreshSessionHistory();
  }, [apiBase, enabled]);

  return {
    sessionHistory,
    loadingHistory,
    refreshSessionHistory,
  };
}
