"use client";

import { useState } from "react";
import { RuntimeConfig, useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";

type BankItem = {
  id: string;
  chapter: string;
  question: string;
  difficulty: string;
  weakness_tag: string;
  review_status: string;
  next_review_at: string | null;
  source_question_type?: string;
  source_question_source?: string;
  tags: string[];
};

type BankResponse = {
  user_id: string;
  chapter: string | null;
  items: BankItem[];
};

export default function BankPage() {
  const { apiBase, setApiBase, userId, setUserId } = useRuntimeConfig();
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

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await apiRequest<BankResponse>(
        apiBase,
        `/v1/question-bank?user_id=${encodeURIComponent(userId)}&chapter=${encodeURIComponent(chapter)}&limit=50`,
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
      });
      await refresh();
    } catch (error) {
      setOutput(String(error));
    }
  };

  return (
    <section className="p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <RuntimeConfig apiBase={apiBase} onApiBaseChange={setApiBase} userId={userId} onUserIdChange={setUserId} />

        <section className="rounded-3xl border border-border bg-card p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">题单管理</h1>
              <p className="text-sm text-muted-foreground">查看模拟面试回流的题目，并安排下一次复习。</p>
            </div>
            <div className="rounded-2xl bg-secondary px-4 py-3 text-sm text-muted-foreground">
              当前用户：<span className="font-medium text-foreground">{userId}</span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">章节</span>
              <input value={chapter} onChange={(e) => setChapter(e.target.value)} className="w-56 rounded-xl border border-input bg-background px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">出题来源</span>
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-40 rounded-xl border border-input bg-background px-3 py-2">
                <option value="all">全部</option>
                <option value="resume">resume</option>
                <option value="doc">doc</option>
                <option value="llm">llm</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">题型</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-40 rounded-xl border border-input bg-background px-3 py-2">
                <option value="all">全部</option>
                <option value="basic">basic</option>
                <option value="project">project</option>
                <option value="scenario">scenario</option>
                <option value="follow_up">follow_up</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
            <button onClick={refresh} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60" disabled={loading}>
              {loading ? "刷新中..." : "刷新题单"}
            </button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
              {[
              { label: "总题数", value: filteredItems.length },
              { label: "待复习", value: pendingCount },
              { label: "已完成", value: doneCount },
            ].map((stat) => (
              <article key={stat.label} className="rounded-2xl border border-border bg-background p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</p>
                <p className="mt-3 text-3xl font-bold text-foreground">{stat.value}</p>
              </article>
            ))}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_280px]">
            <section className="space-y-3">
              {filteredItems.map((item) => (
                <article key={item.id} className="rounded-2xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{item.question}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.chapter} · {item.difficulty} · {item.next_review_at ?? "无复习时间"}
                      </p>
                    </div>
                    <span className={item.review_status === "done" ? "rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700" : "rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700"}>
                      {item.review_status}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-sky-500/10 px-3 py-1 text-xs text-sky-700">
                      来源 {item.source_question_source || "unknown"}
                    </span>
                    <span className="rounded-full bg-violet-500/10 px-3 py-1 text-xs text-violet-700">
                      题型 {item.source_question_type || "unknown"}
                    </span>
                    {item.weakness_tag ? (
                      <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-700">
                        薄弱项 {item.weakness_tag}
                      </span>
                    ) : null}
                    {item.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{tag}</span>
                    ))}
                  </div>
                  <button onClick={() => markDone(item.id)} className="mt-4 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-secondary">标记 done</button>
                </article>
              ))}
              {filteredItems.length === 0 ? <p className="rounded-2xl bg-secondary p-4 text-sm text-muted-foreground">当前筛选条件下暂无题目，先去模拟面试完成复盘或调整筛选。</p> : null}
            </section>

            <section className="rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">调试输出</p>
              <pre className="mt-3 rounded-xl bg-secondary p-3 text-xs">{output || "暂无输出"}</pre>
            </section>
          </div>
        </section>
      </div>
    </section>
  );
}
