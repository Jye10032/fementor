"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { ExperienceSyncCreateResponse, ExperienceSyncJob, ExperienceSyncStatusResponse } from "../_lib/experience.types";

const POLL_INTERVAL_MS = 1500;

type UseExperienceSyncParams = {
  apiBase: string;
  enabled: boolean;
  authRequired?: boolean;
  onCompleted?: () => void;
};

export function useExperienceSync({
  apiBase,
  enabled,
  authRequired = true,
  onCompleted,
}: UseExperienceSyncParams) {
  const [keyword, setKeyword] = useState("前端 面经");
  const [limit, setLimit] = useState(5);
  const [job, setJob] = useState<ExperienceSyncJob | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  const clearPolling = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const response = await apiRequest<ExperienceSyncStatusResponse>(apiBase, `/v1/experiences/sync/${jobId}`, {
        auth: authRequired ? "required" : "optional",
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
        onCompletedRef.current?.();
      }
    } catch (requestError) {
      setSyncing(false);
      setError(requestError instanceof Error ? requestError.message : "同步状态获取失败");
    }
  }, [apiBase, authRequired]);

  // On mount, check if there's an active sync job on the server
  useEffect(() => {
    if (!enabled || !apiBase) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await apiRequest<{ job: ExperienceSyncJob | null }>(apiBase, "/v1/experiences/sync/active", {
          auth: authRequired ? "required" : "optional",
        });
        if (cancelled || !response.job) return;
        setJob(response.job);
        setKeyword(response.job.keyword);
        setSyncing(true);
        void pollJob(response.job.id);
      } catch {
        // ignore — no active job
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, apiBase, authRequired, pollJob]);

  const startSync = async () => {
    if (!enabled || !keyword.trim()) return;

    try {
      clearPolling();
      setSyncing(true);
      setError(null);
      const response = await apiRequest<ExperienceSyncCreateResponse>(apiBase, "/v1/experiences/sync", {
        method: "POST",
        body: JSON.stringify({
          keyword,
          limit,
        }),
        auth: authRequired ? "required" : "optional",
      });
      setJob({
        id: response.job_id,
        keyword,
        status: response.status,
        requested_limit: limit,
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
    limit,
    setLimit,
    job,
    syncing,
    error,
    startSync,
  };
}
