"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, FileText, MessageSquare, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthState } from "../components/auth-provider";
import { PageShell } from "../components/page-shell";
import { apiRequest } from "../lib/api";
import { useRuntimeConfig } from "../components/runtime-config";

function useHomeStats(apiBase: string, isSignedIn: boolean) {
  const [stats, setStats] = useState({ resumes: 0, sessions: 0, experiences: 0, loaded: false });

  useEffect(() => {
    if (!isSignedIn || !apiBase) return;
    Promise.all([
      apiRequest<{ files: unknown[] }>(apiBase, "/v1/resume/library", { auth: "required" }).catch(() => ({ files: [] })),
      apiRequest<{ items: unknown[] }>(apiBase, "/v1/interview/sessions", { auth: "required" }).catch(() => ({ items: [] })),
      apiRequest<{ total: number }>(apiBase, "/v1/experiences", { auth: "required" }).catch(() => ({ total: 0 })),
    ]).then(([r, s, e]) => {
      setStats({
        resumes: r.files?.length ?? 0,
        sessions: s.items?.length ?? 0,
        experiences: e.total ?? 0,
        loaded: true,
      });
    });
  }, [apiBase, isSignedIn]);

  return stats;
}

export default function HomePage() {
  const { isSignedIn } = useAuthState();
  const { apiBase, llmSyncState } = useRuntimeConfig();
  const stats = useHomeStats(apiBase, !!isSignedIn);

  const configReady = llmSyncState === "ready";

  return (
    <PageShell>
      {/* Compact header */}
      <header className="fade-in-up flex flex-col gap-4 rounded-[1.5rem] border border-border/80 bg-card/90 p-5 shadow-[var(--shadow-card)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Frontend Interview Studio</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground">面试训练工作流</h1>
          <p className="mt-1 text-sm text-muted-foreground">状态灯变绿后，按顺序完成四步即可开始训练。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/resume" className="action-primary">
            上传简历
          </Link>
          <Link href="/interview" className="action-secondary">
            开始面试
          </Link>
        </div>
      </header>

      {/* Zigzag Timeline */}
      <section className="zigzag-timeline fade-in-up-delay-1">
        {/* Step 1: 运行配置 */}
        <article className="zigzag-timeline__step zigzag-timeline__step--left fade-in-up-delay-1">
          <div className="zigzag-timeline__content panel-surface">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Settings2 className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-muted-foreground">运行配置</h3>
                <p className="mt-2 text-2xl font-bold tabular-nums text-card-foreground">
                  {configReady ? (
                    <span className="text-green-500">已就绪</span>
                  ) : (
                    <span className="text-amber-500">未配置</span>
                  )}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  在顶部导航配置 API 和 LLM 参数
                </p>
              </div>
            </div>
          </div>
          <span className="zigzag-timeline__marker" aria-hidden="true">1</span>
        </article>

        {/* Step 2: 简历解析 */}
        <article className="zigzag-timeline__step zigzag-timeline__step--right fade-in-up-delay-2">
          <div className="zigzag-timeline__content panel-surface">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileText className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-card-foreground">简历解析</h3>
                <p className="mt-2 text-2xl font-bold tabular-nums text-card-foreground">
                  {stats.resumes} <span className="text-sm font-normal text-muted-foreground">份简历</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">上传简历，AI 梳理项目经历和技术重点</p>
                <Link href="/resume" className="action-primary mt-3 inline-flex items-center gap-2 text-sm">
                  开始上传 <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
          <span className="zigzag-timeline__marker" aria-hidden="true">2</span>
        </article>

        {/* Step 3: 模拟面试 */}
        <article className="zigzag-timeline__step zigzag-timeline__step--left fade-in-up-delay-3">
          <div className="zigzag-timeline__content panel-surface">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-card-foreground">模拟面试</h3>
                <p className="mt-2 text-2xl font-bold tabular-nums text-card-foreground">
                  {stats.sessions} <span className="text-sm font-normal text-muted-foreground">场完成</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">基于简历和 JD，逐轮追问模拟真实面试</p>
                <Link href="/interview" className="action-primary mt-3 inline-flex items-center gap-2 text-sm">
                  开始面试 <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
          <span className="zigzag-timeline__marker" aria-hidden="true">3</span>
        </article>

        {/* Step 4: 面经库 */}
        <article className="zigzag-timeline__step zigzag-timeline__step--right fade-in-up-delay-4">
          <div className="zigzag-timeline__content panel-surface">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-card-foreground">面经库</h3>
                <p className="mt-2 text-2xl font-bold tabular-nums text-card-foreground">
                  {stats.experiences} <span className="text-sm font-normal text-muted-foreground">条面经</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">收录真实面经，辅助训练和复习</p>
                <Link href="/experience" className="action-primary mt-3 inline-flex items-center gap-2 text-sm">
                  查看面经 <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
          <span className="zigzag-timeline__marker" aria-hidden="true">4</span>
        </article>
      </section>
    </PageShell>
  );
}
