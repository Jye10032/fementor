"use client";

import { useEffect, useMemo, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../components/auth-provider";
import { PageHero, PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { apiRequest } from "../../lib/api";
import { ChapterSidebar } from "./_components/ChapterSidebar";
import { PracticeControls } from "./_components/PracticeControls";
import { QuestionQueue } from "./_components/QuestionQueue";
import { ActiveQuestion } from "./_components/ActiveQuestion";
import { ScoreResult } from "./_components/ScoreResult";

type PracticeItem = {
  id: string;
  chapter: string;
  question: string;
  difficulty: string;
  weakness_tag: string;
  next_review_at: string | null;
};

type PracticeResponse = {
  user_id?: string;
  chapter: string | null;
  include_future: boolean;
  items: PracticeItem[];
};

type QuestionBankItem = {
  id: string;
  chapter: string;
};

type QuestionBankResponse = {
  user_id?: string;
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
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, isLoaded, isSignedIn, viewer } = useAuthState();
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
      const data = await apiRequest<QuestionBankResponse>(apiBase, "/v1/question-bank?limit=200", {
        auth: "required",
      });
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
  // PRACTICE_PAGE_REST

  const load = async (targetChapter = chapter) => {
    if (!targetChapter) return;
    try {
      setLoading(true);
      const data = await apiRequest<PracticeResponse>(
        apiBase,
        `/v1/practice/next?chapter=${encodeURIComponent(targetChapter)}&limit=20&include_future=${includeFuture ? "1" : "0"}`,
        { auth: "required" },
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
    if (!isSignedIn) return;
    void loadChapters();
  }, [apiBase, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn || !chapter) return;
    void load(chapter);
  }, [chapter, includeFuture, isSignedIn]);

  const submitAnswer = async () => {
    if (!currentItem || !answer.trim()) return;
    try {
      setSubmitting(true);
      const data = await apiRequest<ScoreResponse>(apiBase, "/v1/scoring/evaluate", {
        method: "POST",
        body: JSON.stringify({ mode: "practice", question: currentItem.question, answer }),
        auth: "required",
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
        body: JSON.stringify({ review_status: reviewStatus, next_review_at: nextReviewAt }),
        auth: "required",
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

  const handleSelectQuestion = (index: number) => {
    setCurrentIndex(index);
    setAnswer("");
    setScoreResult(null);
  };

  // PRACTICE_PAGE_JSX

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

      {!isLoaded ? (
        <PagePanel>正在同步登录态...</PagePanel>
      ) : !isSignedIn ? (
        <PagePanel className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-foreground">章节练习需要先登录。</p>
            <p className="mt-1 text-sm text-muted-foreground">题单、评分记录和复习状态会绑定到当前用户。</p>
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
        <section className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <PagePanel className="p-5">
            <ChapterSidebar
              chapters={chapters} chapter={chapter} setChapter={setChapter}
              chaptersLoading={chaptersLoading} loadChapters={() => void loadChapters()}
            />
          </PagePanel>

          <PagePanel>
            <PracticeControls
              chapter={chapter}
              viewerName={viewer?.name || viewer?.email || "已登录用户"}
              includeFuture={includeFuture} setIncludeFuture={setIncludeFuture}
              loading={loading} isSignedIn={isSignedIn}
              onLoad={() => void load()}
            />
            {/* Inner two-column: queue + active question */}
            <div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <QuestionQueue
                items={items}
                currentItemId={currentItem?.id ?? null}
                onSelect={handleSelectQuestion}
              />

              <section className="rounded-2xl border border-border bg-background p-4">
                {currentItem ? (
                  <>
                    <ActiveQuestion
                      question={currentItem.question}
                      chapter={currentItem.chapter}
                      difficulty={currentItem.difficulty}
                      nextReviewAt={currentItem.next_review_at}
                      answer={answer} setAnswer={setAnswer}
                      submitting={submitting} onSubmit={submitAnswer}
                    />
                    {scoreResult ? (
                      <div className="mt-4">
                        <ScoreResult scoreResult={scoreResult} onScheduleReview={scheduleReview} />
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                        提交回答后，这里会展示评分、优缺点和检索证据。
                      </div>
                    )}
                  </>
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
