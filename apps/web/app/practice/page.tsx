"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHero, PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";

type PracticeItem = {
  id: string;
  chapter: string;
  question: string;
  difficulty: string;
  weakness_tag: string;
  next_review_at: string | null;
};

type PracticeResponse = {
  user_id: string;
  chapter: string | null;
  include_future: boolean;
  items: PracticeItem[];
};

type QuestionBankItem = {
  id: string;
  chapter: string;
};

type QuestionBankResponse = {
  user_id: string;
  chapter: string | null;
  items: QuestionBankItem[];
};

type ScoreResponse = {
  attempt_id: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  standard_answer: string;
  evidence_refs_count: number;
  evidence_refs: Array<{
    source_type: string;
    source_uri: string;
    quote: string;
    confidence: number | null;
  }>;
};

export default function PracticePage() {
  const { apiBase, setApiBase, userId, setUserId } = useRuntimeConfig();
  const [chapter, setChapter] = useState("");
  const [chapters, setChapters] = useState<Array<{ name: string; count: number }>>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [includeFuture, setIncludeFuture] = useState(true);
  const [items, setItems] = useState<PracticeItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [scoreResult, setScoreResult] = useState<ScoreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [output, setOutput] = useState("");

  const currentItem = useMemo(() => items[currentIndex] ?? null, [items, currentIndex]);

  const loadChapters = async () => {
    try {
      setChaptersLoading(true);
      const data = await apiRequest<QuestionBankResponse>(
        apiBase,
        `/v1/question-bank?user_id=${encodeURIComponent(userId)}&limit=200`,
      );
      const chapterCountMap = new Map<string, number>();
      for (const item of data.items || []) {
        const name = String(item.chapter || "").trim();
        if (!name) continue;
        chapterCountMap.set(name, (chapterCountMap.get(name) || 0) + 1);
      }
      const nextChapters = Array.from(chapterCountMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
      setChapters(nextChapters);
      setChapter((prev) => prev || nextChapters[0]?.name || "");
    } catch (error) {
      setOutput(String(error));
      setChapters([]);
    } finally {
      setChaptersLoading(false);
    }
  };

  const load = async (targetChapter = chapter) => {
    if (!targetChapter) return;
    try {
      setLoading(true);
      const data = await apiRequest<PracticeResponse>(
        apiBase,
        `/v1/practice/next?user_id=${encodeURIComponent(userId)}&chapter=${encodeURIComponent(targetChapter)}&limit=20&include_future=${includeFuture ? "1" : "0"}`,
      );
      setItems(data.items || []);
      setCurrentIndex(0);
      setAnswer("");
      setScoreResult(null);
      setOutput(JSON.stringify({ chapter: targetChapter, count: data.items.length, include_future: data.include_future }, null, 2));
    } catch (error) {
      setOutput(String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadChapters();
  }, [apiBase, userId]);

  useEffect(() => {
    if (!chapter) return;
    void load(chapter);
  }, [chapter, includeFuture]);

  const submitAnswer = async () => {
    if (!currentItem || !answer.trim()) return;
    try {
      setSubmitting(true);
      const data = await apiRequest<ScoreResponse>(apiBase, "/v1/scoring/evaluate", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          mode: "practice",
          question: currentItem.question,
          answer,
        }),
      });
      setScoreResult(data);
      setOutput(JSON.stringify({ attempt_id: data.attempt_id, score: data.score, evidence_refs_count: data.evidence_refs_count }, null, 2));
    } catch (error) {
      setOutput(String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const scheduleReview = async (reviewStatus: "pending" | "done") => {
    if (!currentItem || !scoreResult) return;
    try {
      const nextReviewAt = reviewStatus === "done"
        ? new Date(Date.now() + 7 * 86400000).toISOString()
        : new Date(Date.now() + 2 * 86400000).toISOString();
      await apiRequest(apiBase, `/v1/question-bank/${currentItem.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          review_status: reviewStatus,
          next_review_at: nextReviewAt,
        }),
      });

      const remaining = items.filter((item) => item.id !== currentItem.id);
      setItems(remaining);
      setCurrentIndex(0);
      setAnswer("");
      setScoreResult(null);
      setOutput(JSON.stringify({ question_id: currentItem.id, review_status: reviewStatus, next_review_at: nextReviewAt }, null, 2));
    } catch (error) {
      setOutput(String(error));
    }
  };

  return (
    <PageShell>
      <PageHero
        eyebrow="Focused Practice"
        title="把回流题目压缩成一轮真正可执行的章节训练"
        description="你不需要每次都从空白开始。系统会从题单里拉出当前章节最该练的题，给出即时评分、标准答案和证据引用，再直接安排下一次复习。"
        aside={(
          <>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">当前章节</p>
              <p className="mt-3 text-lg font-semibold text-foreground">{chapter || "未选择"}</p>
            </article>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">练习题量</p>
              <p className="mt-3 text-lg font-semibold text-foreground">{items.length}</p>
            </article>
          </>
        )}
      />

      <div className="space-y-6">
        <section className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <PagePanel className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">章节列表</h2>
                <p className="mt-1 text-sm text-muted-foreground">从左侧选择一个章节进入练习。</p>
              </div>
              <button
                onClick={() => void loadChapters()}
                disabled={chaptersLoading}
                className="action-secondary px-3 py-2 text-xs disabled:opacity-60"
              >
                {chaptersLoading ? "刷新中..." : "刷新"}
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {chapters.map((item) => (
                <button
                  key={item.name}
                  onClick={() => setChapter(item.name)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    chapter === item.name ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-background/80 hover:bg-secondary"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">{item.count}</span>
                  </div>
                </button>
              ))}
              {chapters.length === 0 ? (
                <div className="rounded-2xl bg-secondary p-4 text-sm text-muted-foreground">
                  {chaptersLoading ? "正在读取章节..." : "当前还没有可练习章节，先去模拟面试完成复盘。"}
                </div>
              ) : null}
            </div>
          </PagePanel>

          <PagePanel>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="rounded-xl bg-secondary px-4 py-2 text-sm text-foreground">
                当前章节：<span className="font-medium">{chapter || "未选择"}</span>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={includeFuture} onChange={(e) => setIncludeFuture(e.target.checked)} />
                include_future
              </label>
              <button onClick={() => void load()} className="action-primary disabled:opacity-60" disabled={loading || !chapter}>
                {loading ? "拉取中..." : "拉取练习题"}
              </button>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <section className="rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">待练题单</h2>
                  <span className="text-xs text-muted-foreground">{items.length} 题</span>
                </div>
                <div className="mt-3 space-y-3">
                  {items.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setCurrentIndex(index);
                        setAnswer("");
                        setScoreResult(null);
                      }}
                      className={`w-full rounded-xl border p-4 text-left transition-colors ${
                        currentItem?.id === item.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-secondary"
                      }`}
                    >
                      <p className="font-medium text-foreground">{item.question}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {item.chapter} · {item.difficulty} · {item.weakness_tag || "无薄弱项标签"}
                      </p>
                    </button>
                  ))}
                  {items.length === 0 ? <p className="text-sm text-muted-foreground">当前章节暂无可练习题</p> : null}
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-background p-4">
                {currentItem ? (
                  <div className="space-y-4">
                    <header className="rounded-xl bg-secondary p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">当前题目</p>
                      <h2 className="mt-2 text-lg font-semibold text-foreground">{currentItem.question}</h2>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {currentItem.chapter} · {currentItem.difficulty} · next_review_at {currentItem.next_review_at ?? "无"}
                      </p>
                    </header>

                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">你的回答</span>
                      <textarea
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        rows={8}
                        placeholder="按项目背景、方案选择、权衡取舍、结果复盘来组织回答。"
                        className="field-shell w-full"
                      />
                    </label>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={submitAnswer}
                        disabled={submitting || !answer.trim()}
                        className="action-primary"
                      >
                        {submitting ? "评分中..." : "提交评分"}
                      </button>
                      <button
                        onClick={() => setAnswer("")}
                        className="action-secondary"
                      >
                        清空回答
                      </button>
                    </div>

                    {scoreResult ? (
                      <section className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                        <article className="rounded-xl border border-border bg-card p-4">
                          <p className="text-xs uppercase tracking-wider text-muted-foreground">评分结果</p>
                          <p className="mt-3 text-4xl font-bold text-foreground">{scoreResult.score}</p>
                          <p className="mt-2 text-sm text-muted-foreground">{scoreResult.feedback}</p>
                          <p className="mt-2 text-xs text-muted-foreground">证据命中 {scoreResult.evidence_refs_count} 条</p>
                          <div className="mt-4 flex flex-col gap-2">
                            <button
                              onClick={() => scheduleReview("done")}
                              className="action-primary"
                            >
                              掌握较好，标记完成
                            </button>
                            <button
                              onClick={() => scheduleReview("pending")}
                              className="action-secondary"
                            >
                              仍需复习，2天后再看
                            </button>
                          </div>
                        </article>

                        <div className="grid gap-4">
                          <article className="rounded-xl border border-border bg-card p-4">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">优点</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {scoreResult.strengths.map((item) => (
                                <span key={item} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{item}</span>
                              ))}
                            </div>
                          </article>
                          <article className="rounded-xl border border-border bg-card p-4">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">待改进</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {scoreResult.weaknesses.map((item) => (
                                <span key={item} className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-700">{item}</span>
                              ))}
                            </div>
                          </article>
                          <article className="rounded-xl border border-border bg-card p-4">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">标准答案</p>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">{scoreResult.standard_answer}</p>
                          </article>
                          <article className="rounded-xl border border-border bg-card p-4">
                            <p className="text-xs uppercase tracking-wider text-muted-foreground">检索证据</p>
                            <div className="mt-3 space-y-3">
                              {scoreResult.evidence_refs.map((item, index) => (
                                <div key={`${item.source_uri}-${index}`} className="rounded-lg bg-secondary p-3">
                                  <p className="text-xs text-muted-foreground">{item.source_type} · {item.source_uri || "无路径"} · confidence {item.confidence ?? "n/a"}</p>
                                  <p className="mt-2 text-sm text-foreground">{item.quote || "无摘要"}</p>
                                </div>
                              ))}
                            </div>
                          </article>
                        </div>
                      </section>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                        提交回答后，这里会展示评分、优缺点和检索证据。
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl bg-secondary p-6 text-sm text-muted-foreground">
                    先从左侧选择章节，系统会自动拉取该章节的练习题。
                  </div>
                )}
              </section>
            </div>

            <section className="mt-4 rounded-2xl border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">调试输出</p>
              <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-secondary p-3 text-xs">{output || "暂无输出"}</pre>
            </section>
          </PagePanel>
        </section>
      </div>
    </PageShell>
  );
}
