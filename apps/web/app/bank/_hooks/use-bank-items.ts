"use client";

import { useState } from "react";
import { apiRequest } from "../../../lib/api";
import type { BankItem, BankResponse } from "../_lib/bank.types";

export function useBankItems(apiBase: string) {
  const [chapter, setChapter] = useState("状态管理");
  const [items, setItems] = useState<BankItem[]>([]);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const filteredItems = items.filter((item) => {
    const sourceMatch = sourceFilter === "all" || (item.source_question_source || "unknown") === sourceFilter;
    const typeMatch = typeFilter === "all" || (item.source_question_type || "unknown") === typeFilter;
    return sourceMatch && typeMatch;
  });

  const pendingCount = filteredItems.filter((item) => item.review_status === "pending").length;
  const doneCount = filteredItems.filter((item) => item.review_status === "done").length;
  const weaknessCount = filteredItems.filter((item) => Boolean(item.weakness_tag)).length;

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await apiRequest<BankResponse>(
        apiBase,
        `/v1/question-bank?chapter=${encodeURIComponent(chapter)}&limit=50`,
        { auth: "required" },
      );
      setItems(data.items || []);
      setOutput(JSON.stringify({ count: data.items.length }, null, 2));
    } catch (error) {
      setOutput(String(error));
    } finally {
      setLoading(false);
    }
  };

  const markDone = async (id: string) => {
    try {
      const now = new Date(Date.now() + 7 * 86400000).toISOString();
      await apiRequest(apiBase, `/v1/question-bank/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ review_status: "done", next_review_at: now }),
        auth: "required",
      });
      await refresh();
    } catch (error) {
      setOutput(String(error));
    }
  };

  return {
    chapter, setChapter, items, filteredItems,
    sourceFilter, setSourceFilter, typeFilter, setTypeFilter,
    loading, output,
    pendingCount, doneCount, weaknessCount,
    refresh, markDone,
  };
}
