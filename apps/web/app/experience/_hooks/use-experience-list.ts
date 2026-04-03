"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { ExperienceListResponse } from "../_lib/experience.types";

type UseExperienceListParams = {
  apiBase: string;
  enabled: boolean;
  query: string;
};

// Module-level cache: survives component unmount / page navigation
let cachedItems: ExperienceListResponse["items"] = [];
let cachedTotal = 0;

export function useExperienceList({ apiBase, enabled, query }: UseExperienceListParams) {
  const [items, setItems] = useState(cachedItems);
  const [total, setTotal] = useState(cachedTotal);
  const [loading, setLoading] = useState(cachedItems.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!enabled) return;

    try {
      if (cachedItems.length === 0) setLoading(true);
      setError(null);
      const path = `/v1/experiences?only_valid=1&page=1&page_size=200${query ? `&query=${encodeURIComponent(query)}` : ""}`;
      const response = await apiRequest<ExperienceListResponse>(apiBase, path, {
        auth: "optional",
      });
      cachedItems = response.items || [];
      cachedTotal = response.total || 0;
      setItems(cachedItems);
      setTotal(cachedTotal);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载面经失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [apiBase, enabled, query]);

  const deleteItem = async (id: string) => {
    await apiRequest(apiBase, `/v1/experiences/${id}`, {
      method: "DELETE",
      auth: "required",
    });
    setItems((prev) => prev.filter((item) => item.id !== id));
    setTotal((prev) => Math.max(0, prev - 1));
  };

  const deleteItems = async (ids: string[]) => {
    await Promise.all(
      ids.map((id) =>
        apiRequest(apiBase, `/v1/experiences/${id}`, {
          method: "DELETE",
          auth: "required",
        }),
      ),
    );
    const idSet = new Set(ids);
    setItems((prev) => prev.filter((item) => !idSet.has(item.id)));
    setTotal((prev) => Math.max(0, prev - ids.length));
  };

  return {
    items,
    total,
    loading,
    error,
    refresh,
    deleteItem,
    deleteItems,
  };
}
