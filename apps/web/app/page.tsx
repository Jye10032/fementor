"use client";

import Link from "next/link";
import { BookOpen, FileText, MessageSquare, Sparkles } from "lucide-react";
import { RuntimeConfig, useRuntimeConfig } from "../components/runtime-config";
import { apiRequest } from "../lib/api";
import { useState } from "react";

type HealthResponse = {
  ok: boolean;
  service: string;
  date: string;
  db_path: string;
};

export default function HomePage() {
  const { apiBase, setApiBase, userId, setUserId } = useRuntimeConfig();
  const [health, setHealth] = useState<string>("");
  const [checking, setChecking] = useState(false);

  const checkHealth = async () => {
    try {
      setChecking(true);
      const result = await apiRequest<HealthResponse>(apiBase, "/health");
      setHealth(JSON.stringify(result, null, 2));
    } catch (error) {
      setHealth(String(error));
    } finally {
      setChecking(false);
    }
  };

  const cards = [
    {
      href: "/resume",
      title: "简历解析",
      desc: "先解析简历并建立用户画像。",
      icon: FileText,
    },
    {
      href: "/interview",
      title: "模拟面试",
      desc: "逐轮问答，结束后复盘沉淀题单。",
      icon: MessageSquare,
    },
    {
      href: "/bank",
      title: "题单管理",
      desc: "查看复盘回流题目与章节分布。",
      icon: BookOpen,
    },
    {
      href: "/practice",
      title: "章节练习",
      desc: "按待复习题单拉题进行训练。",
      icon: Sparkles,
    },
  ] as const;

  return (
    <section className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-3xl border border-border bg-card">
          <div className="grid gap-6 px-6 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Interview Driven Practice</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                把模拟面试、复盘与题单训练收成一条闭环
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
                先解析用户资料，再在模拟面试中沉淀正式题目，最终回流到章节练习。检索、评分、复盘共用同一套用户文档证据。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/resume" className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  上传并解析资料
                </Link>
                <Link href="/interview" className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary">
                  开始模拟面试
                </Link>
              </div>
            </div>

            <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {[
                { title: "Step 1", label: "简历解析", desc: "上传原始资料，生成用户画像与本地文档库。" },
                { title: "Step 2", label: "模拟面试", desc: "面试官追问、正式作答、按轮评分。" },
                { title: "Step 3", label: "章节练习", desc: "把复盘结果回流到题单并安排复习。" },
              ].map((step) => (
                <article key={step.title} className="rounded-2xl border border-border bg-background/80 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{step.title}</p>
                  <h2 className="mt-2 text-base font-semibold text-foreground">{step.label}</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.desc}</p>
                </article>
              ))}
            </section>
          </div>
        </header>

        <RuntimeConfig
          apiBase={apiBase}
          onApiBaseChange={setApiBase}
          userId={userId}
          onUserIdChange={setUserId}
        />

        <section className="rounded-3xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">服务状态</h2>
              <p className="mt-1 text-sm text-muted-foreground">确认 API、数据库和当前模型配置是否可用。</p>
            </div>
            <button
              onClick={checkHealth}
              disabled={checking}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {checking ? "检查中..." : "检查 Health"}
            </button>
          </div>
          <div className="mt-4 rounded-2xl bg-secondary p-4">
            <pre className="max-h-56 overflow-auto text-xs">{health || "尚未检查"}</pre>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <card.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-semibold text-card-foreground group-hover:text-primary">{card.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{card.desc}</p>
            </Link>
          ))}
        </section>
      </div>
    </section>
  );
}
