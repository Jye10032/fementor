"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { InterviewSession, SessionListResponse } from "../_lib/interview-page.types";

type UseInterviewHistoryParams = {
  apiBase: string;
  userId: string;
};

export function useInterviewHistory({ apiBase, userId }: UseInterviewHistoryParams) {
  const [sessionHistory, setSessionHistory] = useState<InterviewSession[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const refreshSessionHistory = async () => {
    if (!userId) return;
    setLoadingHistory(true);
    try {
      const data = await apiRequest<SessionListResponse>(
        apiBase,
        `/v1/interview/sessions?user_id=${encodeURIComponent(userId)}`,
      );
      setSessionHistory(data.items);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    void refreshSessionHistory();
  }, [apiBase, userId]);

  return {
    sessionHistory,
    loadingHistory,
    refreshSessionHistory,
  };
}
