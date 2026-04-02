"use client";

import { useEffect, useRef, useState } from "react";
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
  const hasFetched = useRef(false);

  const refresh = async () => {
    if (!enabled) {
      if (!hasFetched.current) {
        setItems([]);
        setTotal(0);
      }
      return;
    }

    try {
      if (!hasFetched.current) setLoading(true);
      setError(null);
      const path = `/v1/experiences?only_valid=1&page=1&page_size=200${query ? `&query=${encodeURIComponent(query)}` : ""}`;
      const response = await apiRequest<ExperienceListResponse>(apiBase, path, {
        auth: "optional",
      });
      setItems(response.items || []);
      setTotal(response.total || 0);
      hasFetched.current = true;
    } catch (requestError) {
      if (!hasFetched.current) {
        setItems([]);
        setTotal(0);
      }
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
