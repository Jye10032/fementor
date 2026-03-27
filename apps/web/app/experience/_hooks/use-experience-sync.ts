"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { ExperienceSyncCreateResponse, ExperienceSyncJob, ExperienceSyncStatusResponse } from "../_lib/experience.types";

const POLL_INTERVAL_MS = 1500;

type UseExperienceSyncParams = {
  apiBase: string;
  enabled: boolean;
  onCompleted?: () => void;
};

export function useExperienceSync({ apiBase, enabled, onCompleted }: UseExperienceSyncParams) {
  const [keyword, setKeyword] = useState("前端 面经");
  const [job, setJob] = useState<ExperienceSyncJob | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearPolling = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const pollJob = async (jobId: string) => {
    try {
      const response = await apiRequest<ExperienceSyncStatusResponse>(apiBase, `/v1/experiences/sync/${jobId}`, {
        auth: "required",
      });
      setJob(response.job);

      if (response.job.status === "pending" || response.job.status === "running") {
        timerRef.current = window.setTimeout(() => {
          void pollJob(jobId);
        }, POLL_INTERVAL_MS);
        return;
      }

      setSyncing(false);
      if (response.job.status === "completed") {
        onCompleted?.();
      }
    } catch (requestError) {
      setSyncing(false);
      setError(requestError instanceof Error ? requestError.message : "同步状态获取失败");
    }
  };

  const startSync = async () => {
    if (!enabled || !keyword.trim()) {
      return;
    }

    try {
      clearPolling();
      setSyncing(true);
      setError(null);
      const response = await apiRequest<ExperienceSyncCreateResponse>(apiBase, "/v1/experiences/sync", {
        method: "POST",
        body: JSON.stringify({
          keyword,
          days: 7,
          limit: 10,
        }),
        auth: "required",
      });
      setJob({
        id: response.job_id,
        keyword,
        status: response.status,
        requested_limit: 10,
        created_count: 0,
        skipped_count: 0,
        failed_count: 0,
        started_at: null,
        finished_at: null,
        error_message: "",
      });
      await pollJob(response.job_id);
    } catch (requestError) {
      setSyncing(false);
      setError(requestError instanceof Error ? requestError.message : "启动同步失败");
    }
  };

  useEffect(() => () => clearPolling(), []);

  return {
    keyword,
    setKeyword,
    job,
    syncing,
    error,
    startSync,
  };
}
