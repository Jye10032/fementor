"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Circle, FileText, MessageSquare, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthState } from "../components/auth-provider";
import { PageShell } from "../components/page-shell";
import { apiRequest } from "../lib/api";
import { useRuntimeConfig } from "../components/runtime-config";

function useHomeStats(apiBase: string, isSignedIn: boolean) {
  const [stats, setStats] = useState({ resumes: 0, jds: 0, sessions: 0, experiences: 0 });

  useEffect(() => {
    if (!isSignedIn || !apiBase) {
      setStats({ resumes: 0, jds: 0, sessions: 0, experiences: 0 });
      return;
    }
    Promise.all([
      apiRequest<{ files: unknown[] }>(apiBase, "/v1/resume/library", { auth: "required" }).catch(() => ({ files: [] })),
      apiRequest<{ files: unknown[] }>(apiBase, "/v1/jd/library", { auth: "required" }).catch(() => ({ files: [] })),
      apiRequest<{ items: unknown[] }>(apiBase, "/v1/interview/sessions", { auth: "required" }).catch(() => ({ items: [] })),
      apiRequest<{ total: number }>(apiBase, "/v1/experiences", { auth: "required" }).catch(() => ({ total: 0 })),
    ]).then(([resume, jd, sessions, experiences]) => {
      setStats({
        resumes: resume.files?.length ?? 0,
        jds: jd.files?.length ?? 0,
        sessions: sessions.items?.length ?? 0,
        experiences: experiences.total ?? 0,
      });
    });
  }, [apiBase, isSignedIn]);

  return stats;
}

export default function HomePage() {
  const { isSignedIn } = useAuthState();
  const { apiBase } = useRuntimeConfig();
  const stats = useHomeStats(apiBase, !!isSignedIn);
  const hasMaterials = stats.resumes > 0 && stats.jds > 0;
  const nextTaskTitle = hasMaterials ? "资料已经准备好" : "先准备一份简历和目标 JD";
  const nextTaskDescription = hasMaterials
    ? "现在可以直接开始一次针对性模拟面试。"
    : "面试题目会围绕你的项目经历和岗位要求生成。";
  const nextTaskHref = hasMaterials ? "/interview" : "/resume";
  const nextTaskLabel = hasMaterials ? "开始模拟面试" : "去准备资料";

  return (
    <PageShell>
      <section className="fade-in-up border-b border-border/70 pb-8 md:pb-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-muted-foreground">面试训练工作台</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">从资料开始，完成一场针对性面试</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              围绕你的项目经历和目标岗位逐轮提问，结束后整理成下一步可执行的训练重点。
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground lg:pt-2">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span>{hasMaterials ? "已完成资料准备" : "当前在资料准备阶段"}</span>
          </div>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
          <div className="border-l-2 border-primary/35 pl-4 sm:pl-5">
            <p className="text-xs font-semibold text-primary">下一步</p>
            <div className="mt-2 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-foreground sm:text-2xl">{nextTaskTitle}</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{nextTaskDescription}</p>
              </div>
              <Link href={nextTaskHref} className="action-primary shrink-0 gap-2 self-start sm:self-auto">
                {hasMaterials ? <MessageSquare className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
                {nextTaskLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="border-t border-border/70 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <p className="text-xs font-semibold text-foreground">训练流程</p>
            <ol className="mt-3 space-y-2.5 text-sm">
              <li className={`flex items-center gap-2 ${hasMaterials ? "text-accent" : "text-foreground"}`}>
                {hasMaterials ? <CheckCircle2 className="h-4 w-4" /> : <UploadCloud className="h-4 w-4 text-primary" />}
                <span>准备资料</span>
                <span className="ml-auto text-xs text-muted-foreground">{hasMaterials ? "完成" : "现在"}</span>
              </li>
              <li className={`flex items-center gap-2 ${stats.sessions > 0 ? "text-accent" : "text-muted-foreground"}`}>
                {stats.sessions > 0 ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                <span>开始面试</span>
                <span className="ml-auto text-xs text-muted-foreground">{stats.sessions > 0 ? `${stats.sessions} 场` : "下一步"}</span>
              </li>
              <li className="flex items-center gap-2 text-muted-foreground">
                <Circle className="h-4 w-4" />
                <span>查看结果</span>
                <span className="ml-auto text-xs">完成后</span>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section className="fade-in-up-delay-1 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]" aria-label="训练记录">
        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-foreground">你的训练记录</p>
              <p className="mt-1 text-sm text-muted-foreground">完成一场面试后，结果会自动保存在这里。</p>
            </div>
            <Link href="/interview" className="hidden items-center gap-1 text-sm font-semibold text-primary hover:underline sm:inline-flex">
              查看记录 <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-4 divide-y border-y border-border/70">
            <div className="flex items-center justify-between gap-4 py-3.5 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><FileText className="h-4 w-4" />资料</span>
              <span className="text-foreground">{stats.resumes} 份简历 · {stats.jds} 个 JD</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-3.5 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><MessageSquare className="h-4 w-4" />模拟面试</span>
              <span className="text-foreground">{stats.sessions > 0 ? `${stats.sessions} 场已完成` : "还没有开始"}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-3.5 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><BookOpen className="h-4 w-4" />面经参考</span>
              <span className="text-foreground">{stats.experiences} 条公开资料</span>
            </div>
          </div>
        </div>
        <aside className="border-t border-border/70 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <p className="text-xs font-semibold text-foreground">训练闭环</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">每次面试都会沉淀反馈，下一次可以继续从薄弱项开始练习。</p>
          <Link href="/experience" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            浏览面经库 <BookOpen className="h-3.5 w-3.5" />
          </Link>
        </aside>
      </section>
    </PageShell>
  );
}
