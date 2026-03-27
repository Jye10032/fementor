"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, FileText, MessageSquare, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthState } from "../components/auth-provider";
import { PageShell } from "../components/page-shell";
import { apiRequest } from "../lib/api";
import { useRuntimeConfig } from "../components/runtime-config";

function useHomeStats(apiBase: string, isSignedIn: boolean) {
  const [stats, setStats] = useState({ resumes: 0, sessions: 0, bank: 0, loaded: false });

  useEffect(() => {
    if (!isSignedIn || !apiBase) return;
    Promise.all([
      apiRequest<{ files: unknown[] }>(apiBase, "/v1/resume/library", { auth: "required" }).catch(() => ({ files: [] })),
      apiRequest<{ items: unknown[] }>(apiBase, "/v1/interview/sessions", { auth: "required" }).catch(() => ({ items: [] })),
      apiRequest<{ items: unknown[] }>(apiBase, "/v1/question-bank", { auth: "required" }).catch(() => ({ items: [] })),
    ]).then(([r, s, b]) => {
      setStats({ resumes: r.files?.length ?? 0, sessions: s.items?.length ?? 0, bank: b.items?.length ?? 0, loaded: true });
    });
  }, [apiBase, isSignedIn]);

  return stats;
}

export default function HomePage() {
  const { isSignedIn } = useAuthState();
  const { apiBase } = useRuntimeConfig();
  const stats = useHomeStats(apiBase, !!isSignedIn);
  const cards = [
    {
      type: "static" as const,
      title: "运行配置",
      desc: "在顶部导航配置 API Base 和 LLM 参数，确认 AI 已就绪。",
      icon: Settings2,
      hint: "顶部完成配置",
    },
    {
      type: "link" as const,
      href: "/resume",
      title: "简历解析",
      desc: "上传简历，AI 帮你梳理项目经历和技术重点。",
      icon: FileText,
      hint: "开始上传",
    },
    {
      type: "link" as const,
      href: "/interview",
      title: "模拟面试",
      desc: "基于简历和 JD，逐轮追问，像真实面试一样。",
      icon: MessageSquare,
      hint: "开始面试",
    },
    {
      type: "link" as const,
      href: "/bank",
      title: "题单回流",
      desc: "弱项自动进入复习清单，形成下一轮训练输入。",
      icon: BookOpen,
      hint: "查看题单",
    },
  ] as const;

  return (
    <PageShell>
      {/* Compact header */}
      <header className="flex flex-col gap-4 rounded-[1.5rem] border border-border/80 bg-card/90 p-5 sm:flex-row sm:items-center sm:justify-between">
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => {
          const isStatic = card.type === "static";
          const CardContent = (
            <>
              <div className={`absolute inset-x-0 top-0 h-1 ${isStatic ? "bg-muted-foreground/20" : "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--primary)_80%,white),color-mix(in_oklab,var(--accent)_75%,white))]"}`} />
              <div className="mb-6 flex items-center justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isStatic ? "bg-muted" : "bg-primary/10"}`}>
                  <card.icon className={`h-4 w-4 ${isStatic ? "text-muted-foreground" : "text-primary"}`} />
                </div>
                <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">0{index + 1}</span>
              </div>
              <h3 className={`text-lg font-semibold ${isStatic ? "text-muted-foreground" : "text-card-foreground"}`}>{card.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{card.desc}</p>
              <div className={`mt-5 inline-flex items-center gap-2 text-sm ${isStatic ? "font-medium text-muted-foreground" : "font-semibold text-foreground"}`}>
                {card.hint}
                {!isStatic && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
              </div>
            </>
          );

          if (isStatic) {
            return (
              <div key={card.title} className="panel-surface relative overflow-hidden">
                {CardContent}
              </div>
            );
          }

          return (
            <Link
              key={card.href}
              href={card.href}
              className="group panel-surface relative overflow-hidden transition-all hover:-translate-y-1 hover:border-primary/35"
            >
              {CardContent}
            </Link>
          );
        })}
      </section>
    </PageShell>
  );
}
