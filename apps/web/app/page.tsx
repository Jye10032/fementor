"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, FileText, MessageSquare, Sparkles } from "lucide-react";
import { useState } from "react";
import { PageHero, PagePanel, PageShell } from "../components/page-shell";
import { useRuntimeConfig } from "../components/runtime-config";
import { apiRequest } from "../lib/api";

type HealthResponse = {
  ok: boolean;
  service: string;
  date: string;
  db_path: string;
};

export default function HomePage() {
  const { apiBase } = useRuntimeConfig();
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
    <PageShell>
      <PageHero
        eyebrow="Interview Driven Practice"
        title="把前端求职训练做成一条会沉淀的工作流"
        description="FEMentor 不只是在问答，而是在把简历、JD、模拟面试、评分反馈和复习节奏串成一个闭环。每一场练习都应该让下一场更精准。"
        actions={(
          <>
            <Link href="/resume" className="action-primary">
              上传并解析资料
            </Link>
            <Link href="/interview" className="action-secondary">
              开始模拟面试
            </Link>
          </>
        )}
        aside={(
          <>
            {[
              { title: "Step 1", label: "简历解析", desc: "先把候选人画像和文档证据库建立起来。" },
              { title: "Step 2", label: "模拟面试", desc: "围绕项目经历、基础能力和岗位要求逐轮追问。" },
              { title: "Step 3", label: "题单回流", desc: "把薄弱点压回复习系统，而不是停在一份报告。" },
            ].map((step) => (
              <article key={step.title} className="panel-muted">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{step.title}</p>
                <h2 className="mt-2 text-base font-semibold text-foreground">{step.label}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.desc}</p>
              </article>
            ))}
          </>
        )}
      />

      <section>
        <PagePanel>
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="eyebrow-chip">System Health</span>
              <h2 className="mt-3 text-2xl font-semibold text-foreground">服务状态</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">快速确认 API、数据库和当前模型链路是否正常，减少联调时的环境噪声。</p>
            </div>
            <button onClick={checkHealth} disabled={checking} className="action-primary">
              {checking ? "检查中..." : "检查 Health"}
            </button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "资料入库", value: "Resume + JD" },
              { label: "对话模式", value: "SSE Streaming" },
              { label: "记忆沉淀", value: "Review Loop" },
            ].map((item) => (
              <article key={item.label} className="metric-tile">
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                <p className="mt-3 text-lg font-semibold text-foreground">{item.value}</p>
              </article>
            ))}
          </div>
          <div className="mt-5 rounded-[1.4rem] border border-border/70 bg-secondary/65 p-4">
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs leading-6 text-foreground">{health || "尚未检查"}</pre>
          </div>
        </PagePanel>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <Link
            key={card.href}
            href={card.href}
            className="group panel-surface relative overflow-hidden transition-all hover:-translate-y-1 hover:border-primary/35"
          >
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,color-mix(in_oklab,var(--primary)_80%,white),color-mix(in_oklab,var(--accent)_75%,white))]" />
            <div className="mb-8 flex items-center justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] bg-primary/10">
                <card.icon className="h-5 w-5 text-primary" />
              </div>
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">0{index + 1}</span>
            </div>
            <h3 className="text-xl font-semibold text-card-foreground group-hover:text-primary">{card.title}</h3>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{card.desc}</p>
            <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              进入模块
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </section>
    </PageShell>
  );
}
