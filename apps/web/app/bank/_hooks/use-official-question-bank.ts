"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";
import type {
  OfficialQuestion,
  OfficialQuestionBankResponse,
  OfficialQuestionBankStatus,
} from "../_lib/bank.types";

const getMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("official_source_not_configured")) return "官方题库尚未配置";
  if (message.includes("official_source_unavailable")) return "暂时无法连接官方题库";
  if (message.includes("official_import_requires_identity")) return "登录后才能导入到我的题库";
  return message;
};

const PAGE_SIZE = 20;

type OfficialQuestionBankOptions = {
  enabled?: boolean;
  identityKey?: string;
  onImported?: () => void | Promise<void>;
};

export function useOfficialQuestionBank(
  apiBase: string,
  { enabled = true, identityKey = "anonymous", onImported }: OfficialQuestionBankOptions = {},
) {
  const [items, setItems] = useState<OfficialQuestion[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [chapter, setChapter] = useState("");
  const [category, setCategory] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OfficialQuestionBankStatus | null>(null);

  const requestPage = async (offset = 0) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (query.trim()) params.set("query", query.trim());
    if (chapter.trim()) params.set("chapter", chapter.trim());
    if (category.trim()) params.set("category", category.trim());
    if (difficulty) params.set("difficulty", difficulty);
    try {
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      const data = await apiRequest<OfficialQuestionBankResponse>(
        apiBase,
        `/v1/official-question-bank?${params.toString()}`,
        { auth: "optional" },
      );
      setItems((current) => offset === 0 ? (data.items || []) : [...current, ...(data.items || [])]);
      setTotal(data.total || 0);
    } catch (nextError) {
      if (offset === 0) {
        setItems([]);
        setTotal(0);
      }
      setError(getMessage(nextError));
    } finally {
      if (offset === 0) setLoading(false);
      else setLoadingMore(false);
    }
  };

  const refresh = async () => requestPage(0);

  const loadMore = async () => {
    if (loading || loadingMore || items.length >= total) return;
    await requestPage(items.length);
  };

  const loadStatus = async () => {
    try {
      setStatus(await apiRequest<OfficialQuestionBankStatus>(
        apiBase,
        "/v1/official-question-bank/status",
        { auth: "none" },
      ));
    } catch {
      setStatus({ configured: true, reachable: false, total: 0 });
    }
  };

  useEffect(() => {
    if (!enabled) return;
    void Promise.all([refresh(), loadStatus()]);
  }, [apiBase, enabled, identityKey]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void refresh();
  };

  const importQuestion = async (id: string) => {
    try {
      setImportingId(id);
      setError(null);
      await apiRequest(apiBase, `/v1/official-question-bank/${encodeURIComponent(id)}/import`, {
        method: "POST",
        auth: "required",
      });
      setItems((current) => current.map((item) => (
        item.id === id ? { ...item, is_imported: true } : item
      )));
      await onImported?.();
    } catch (nextError) {
      setError(getMessage(nextError));
    } finally {
      setImportingId(null);
    }
  };

  return {
    chapter,
    category,
    difficulty,
    error,
    importingId,
    items,
    loading,
    loadingMore,
    query,
    status,
    total,
    importQuestion,
    loadMore,
    refresh,
    setChapter,
    setCategory,
    setDifficulty,
    setQuery,
    submitSearch,
  };
}
