"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { ExperienceFilterOptions, ExperienceListResponse } from "../_lib/experience.types";

type UseExperienceListParams = {
  apiBase: string;
  enabled: boolean;
  query: string;
  company: string;
  role: string;
};

type ListState = {
  key: string;
  items: ExperienceListResponse["items"];
  total: number;
  page: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
};

const EMPTY_FILTERS: ExperienceFilterOptions = { companies: [], roles: [] };
const PAGE_SIZE = 50;

export function useExperienceList({ apiBase, enabled, query, company, role }: UseExperienceListParams) {
  const key = JSON.stringify([apiBase, query, company, role]);
  const [state, setState] = useState<ListState>({ key: "", items: [], total: 0, page: 0, loading: true, loadingMore: false, error: null, loadMoreError: null });
  const [filterState, setFilterState] = useState({ apiBase: "", options: EMPTY_FILTERS, loading: true, error: "" });
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const filterRequestId = useRef(0);
  const current = state.key === key ? state : { ...state, items: [], total: 0, page: 0, loading: true, loadingMore: false, error: null, loadMoreError: null };

  const refreshFilters = useCallback(async () => {
    const id = ++filterRequestId.current;
    setFilterState({ apiBase, options: EMPTY_FILTERS, loading: true, error: "" });
    try {
      const options = await apiRequest<ExperienceFilterOptions>(apiBase, "/v1/experiences/filters", { auth: "optional", cache: "no-store" });
      if (id === filterRequestId.current) setFilterState({ apiBase, options, loading: false, error: "" });
    } catch {
      if (id === filterRequestId.current) setFilterState({ apiBase, options: EMPTY_FILTERS, loading: false, error: "筛选选项加载失败，请重试。" });
    }
  }, [apiBase]);

  const requestPage = useCallback(async (page = 1) => {
    if (!enabled) return;
    const id = ++requestId.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState((previous) => ({
      key, items: page === 1 || previous.key !== key ? [] : previous.items,
      total: previous.key === key ? previous.total : 0,
      page: page === 1 ? 0 : previous.page,
      loading: page === 1, loadingMore: page > 1, error: null, loadMoreError: null,
    }));
    const params = new URLSearchParams({ only_valid: "1", exact_filters: "1", page: String(page), page_size: String(PAGE_SIZE) });
    if (query) params.set("query", query);
    if (company) params.set("company", company);
    if (role) params.set("role", role);
    try {
      const response = await apiRequest<ExperienceListResponse>(apiBase, `/v1/experiences?${params}`, {
        auth: "optional", signal: abort.signal, cache: "no-store",
      });
      if (id !== requestId.current) return;
      setState((previous) => ({
        key,
        items: page === 1 ? response.items || [] : Array.from(new Map([...previous.items, ...(response.items || [])].map((item) => [item.id, item])).values()),
        total: response.total || 0, page, loading: false, loadingMore: false, error: null, loadMoreError: null,
      }));
    } catch (error) {
      if (id !== requestId.current || abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : "加载面经失败";
      setState((previous) => ({ ...previous, loading: false, loadingMore: false,
        error: page === 1 ? message : null,
        loadMoreError: page > 1 ? "更多面经加载失败，请重试。" : null,
      }));
    }
  }, [apiBase, enabled, key, query, company, role]);

  useEffect(() => {
    void requestPage();
    return () => { ++requestId.current; controller.current?.abort(); };
  }, [requestPage]);

  useEffect(() => {
    if (enabled) void refreshFilters();
    return () => { ++filterRequestId.current; };
  }, [enabled, refreshFilters]);

  const refresh = useCallback(() => requestPage(1), [requestPage]);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;

  const deleteItems = async (ids: string[]) => {
    const results = await Promise.allSettled(ids.map((id) => apiRequest(apiBase, `/v1/experiences/${id}`, { method: "DELETE", auth: "required" })));
    await Promise.all([latestRefresh.current(), refreshFilters()]);
    if (results.some((result) => result.status === "rejected")) throw new Error("部分面经删除失败");
  };

  return {
    ...current,
    filters: filterState.apiBase === apiBase ? filterState.options : EMPTY_FILTERS,
    filtersLoading: filterState.apiBase !== apiBase || filterState.loading,
    filtersError: filterState.apiBase === apiBase ? filterState.error : "",
    refreshFilters,
    refresh,
    loadMore: () => {
      if (!current.loading && !current.loadingMore && current.items.length < current.total) return requestPage(current.page + 1);
    },
    deleteItem: (id: string) => deleteItems([id]),
    deleteItems,
  };
}
