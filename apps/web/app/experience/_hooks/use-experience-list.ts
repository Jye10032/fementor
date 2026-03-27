"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { ExperienceListResponse } from "../_lib/experience.types";

type UseExperienceListParams = {
  apiBase: string;
  enabled: boolean;
  query: string;
};

export function useExperienceList({ apiBase, enabled, query }: UseExperienceListParams) {
  const [items, setItems] = useState<ExperienceListResponse["items"]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!enabled) {
      setItems([]);
      setTotal(0);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const path = `/v1/experiences?only_valid=1&page=1&page_size=20${query ? `&query=${encodeURIComponent(query)}` : ""}`;
      const response = await apiRequest<ExperienceListResponse>(apiBase, path, {
        auth: "required",
      });
      setItems(response.items || []);
      setTotal(response.total || 0);
    } catch (requestError) {
      setItems([]);
      setTotal(0);
      setError(requestError instanceof Error ? requestError.message : "加载面经失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [apiBase, enabled, query]);

  return {
    items,
    total,
    loading,
    error,
    refresh,
  };
}
