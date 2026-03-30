"use client";

import { useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../components/auth-provider";
import { PageHero, PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
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
  user_id?: string;
  chapter: string | null;
  items: BankItem[];
};

export default function BankPage() {
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, isLoaded, isSignedIn, viewer } = useAuthState();
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

  return (
    <PageShell>
      <PageHero
        eyebrow="Question Bank"
        title="把模拟面试的反馈压成一套真正会追踪的复习题单"
        description="这里不是静态列表，而是把题目来源、薄弱点和复习状态组织成训练面板，方便你决定下一轮练什么、先补哪里。"
        aside={(
          <>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">当前用户</p>
              <p className="mt-3 text-lg font-semibold text-foreground">{viewer?.name || viewer?.email || "未登录"}</p>
            </article>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">章节焦点</p>
              <p className="mt-3 text-sm leading-6 text-foreground">{chapter || "未选择章节"}</p>
            </article>
          </>
        )}
      />

      {!isLoaded ? (
        <PagePanel>正在同步登录态...</PagePanel>
      ) : !isSignedIn ? (
        <PagePanel className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-foreground">题单页面需要先登录。</p>
            <p className="mt-1 text-sm text-muted-foreground">题目来源、复习状态和薄弱项趋势都绑定在当前 viewer 下。</p>
          </div>
          {authEnabled ? (
            <SignInButton mode="modal">
              <button type="button" className="action-primary">立即登录</button>
            </SignInButton>
          ) : (
            <span className="text-sm text-muted-foreground">登录未启用</span>
          )}
        </PagePanel>
      ) : null}

      <div className="space-y-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <PagePanel className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <span className="eyebrow-chip">Filter & Review</span>
                <h2 className="mt-3 text-2xl font-semibold text-foreground">筛选题单并安排下一轮复习</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">先按章节、来源和题型缩小范围，再决定哪些题需要继续保留，哪些已经可以标记完成。</p>
              </div>
              <button onClick={refresh} className="action-primary disabled:opacity-60" disabled={loading}>
                {loading ? "刷新中..." : "刷新题单"}
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">章节</span>
                <input value={chapter} onChange={(e) => setChapter(e.target.value)} className="field-shell w-full" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">出题来源</span>
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="field-shell w-full">
                  <option value="all">全部</option>
                  <option value="resume">resume</option>
                  <option value="doc">doc</option>
                  <option value="llm">llm</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">题型</span>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="field-shell w-full">
                  <option value="all">全部</option>
                  <option value="basic">basic</option>
                  <option value="project">project</option>
                  <option value="scenario">scenario</option>
                  <option value="follow_up">follow_up</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              {[
                { label: "总题数", value: filteredItems.length },
                { label: "待复习", value: pendingCount },
                { label: "已完成", value: doneCount },
                { label: "薄弱项题目", value: weaknessCount },
              ].map((stat) => (
                <article key={stat.label} className="metric-tile">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</p>
                  <p className="mt-3 text-3xl font-bold text-foreground">{stat.value}</p>
                </article>
              ))}
            </div>

            <section className="space-y-3">
              {filteredItems.map((item) => (
                <article key={item.id} className="rounded-[1.4rem] border border-border bg-background/85 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={item.review_status === "done" ? "rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700" : "rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700"}>
                          {item.review_status}
                        </span>
                        <span className="text-xs text-muted-foreground">{item.chapter} · {item.difficulty}</span>
                      </div>
                      <p className="mt-3 text-base font-semibold leading-7 text-foreground">{item.question}</p>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        下次复习时间：{item.next_review_at ?? "暂未安排"}
                      </p>
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
                    </div>

                    <div className="flex min-w-[160px] flex-col gap-3 lg:items-end">
                      <div className="rounded-xl bg-secondary/80 px-3 py-2 text-xs text-muted-foreground">
                        适合在本轮复盘后决定是否出队
                      </div>
                      <button onClick={() => markDone(item.id)} className="action-secondary text-xs">
                        标记 done
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {filteredItems.length === 0 ? <p className="rounded-2xl bg-secondary p-4 text-sm text-muted-foreground">当前筛选条件下暂无题目，先去模拟面试完成复盘或调整筛选。</p> : null}
            </section>
          </PagePanel>

          <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
            <PagePanel>
              <span className="eyebrow-chip">Overview</span>
              <h3 className="mt-3 text-xl font-semibold text-foreground">当前筛选快照</h3>
              <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-xl bg-background/80 p-4">
                  <p className="text-xs text-muted-foreground">章节</p>
                  <p className="mt-2 font-medium text-foreground">{chapter || "未填写"}</p>
                </div>
                <div className="rounded-xl bg-background/80 p-4">
                  <p className="text-xs text-muted-foreground">来源 / 题型</p>
                  <p className="mt-2 font-medium text-foreground">{sourceFilter} / {typeFilter}</p>
                </div>
              </div>
            </PagePanel>

            <PagePanel>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">调试输出</p>
              <pre className="mt-3 rounded-xl bg-secondary p-3 text-xs leading-6">{output || "暂无输出"}</pre>
            </PagePanel>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
