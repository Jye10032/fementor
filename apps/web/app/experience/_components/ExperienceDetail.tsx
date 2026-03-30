"use client";

import { Building2, ExternalLink, FileText, Layers, Star, User } from "lucide-react";
import { ExperienceDetail as ExperienceDetailType } from "../_lib/experience.types";

type ExperienceDetailProps = {
  item: ExperienceDetailType;
};

function qualityColor(score: number) {
  if (score >= 80) return "text-[oklch(0.55_0.16_155)]";
  if (score >= 60) return "text-[oklch(0.65_0.16_85)]";
  return "text-[oklch(0.53_0.19_25)]";
}

function difficultyStyle(d: string) {
  const lower = d.toLowerCase();
  if (lower === "easy" || lower === "简单") return "border-[oklch(0.55_0.16_155)]/30 bg-[oklch(0.55_0.16_155)]/8 text-[oklch(0.45_0.16_155)]";
  if (lower === "medium" || lower === "中等") return "border-[oklch(0.65_0.16_85)]/30 bg-[oklch(0.65_0.16_85)]/8 text-[oklch(0.5_0.16_85)]";
  if (lower === "hard" || lower === "困难") return "border-[oklch(0.53_0.19_25)]/30 bg-[oklch(0.53_0.19_25)]/8 text-[oklch(0.45_0.19_25)]";
  return "border-border/80 bg-background text-muted-foreground";
}

function roleStyle(role: string) {
  const lower = role.toLowerCase();
  if (lower === "main" || lower === "主问") return "border-primary/30 bg-primary/8 text-primary";
  if (lower === "follow_up" || lower === "追问") return "border-accent/30 bg-accent/8 text-accent";
  return "border-border/80 bg-background text-muted-foreground";
}

export function ExperienceDetail({ item }: ExperienceDetailProps) {
  return (
    <div className="space-y-6">
      <section className="panel-surface">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="eyebrow-chip">{item.source_platform}</p>
            <h1 className="text-3xl font-semibold text-foreground">{item.title}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {item.company_name ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-2.5 py-0.5 text-xs text-muted-foreground">
                  <Building2 className="h-3 w-3" />
                  {item.company_name}
                </span>
              ) : null}
              {item.role_name ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-2.5 py-0.5 text-xs text-muted-foreground">
                  <User className="h-3 w-3" />
                  {item.role_name}
                </span>
              ) : null}
              {item.interview_stage ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-2.5 py-0.5 text-xs text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  {item.interview_stage}
                </span>
              ) : null}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <User className="mr-1 inline h-3 w-3" />作者
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">{item.author_name || "未知作者"}</p>
            </div>
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <Star className="mr-1 inline h-3 w-3" />质量分
              </p>
              <p className={`mt-2 text-lg font-semibold ${qualityColor(item.quality_score)}`}>{item.quality_score}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={item.source_url} target="_blank" rel="noreferrer" className="action-secondary cursor-pointer">
            打开原帖
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="panel-surface">
          <div className="mb-3 flex items-center gap-2 border-b border-border/60 pb-3">
            <FileText className="h-4 w-4 text-primary" />
            <p className="text-sm font-semibold text-foreground">清洗版</p>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{item.content_cleaned || "暂无清洗内容"}</p>
        </article>

        <article className="panel-surface">
          <div className="mb-3 flex items-center gap-2 border-b border-border/60 pb-3">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">原文</p>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{item.content_raw || "暂无原文"}</p>
        </article>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-lg font-semibold text-foreground">问题簇</p>
          <p className="mt-1 text-sm text-muted-foreground">用于后续检索召回、模拟面试题源和追问链恢复。</p>
        </div>

        {item.groups.length === 0 ? (
          <div className="panel-surface text-sm text-muted-foreground">当前没有抽取到问题簇。</div>
        ) : (
          item.groups.map((group) => (
            <article key={group.id} className="panel-surface">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow-chip">{group.topic_cluster || "未分类主题"}</p>
                  <h2 className="mt-3 text-xl font-semibold text-foreground">{group.canonical_question || "未命名问题簇"}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    类型：{group.group_type} · 置信度：{group.confidence.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {group.items.map((question) => (
                  <div key={question.id} className="rounded-[1.25rem] border border-border/70 bg-secondary/45 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] ${roleStyle(question.question_role)}`}>
                        {question.question_role}
                      </span>
                      <span className="rounded-full border border-border/80 bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {question.category}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] ${difficultyStyle(question.difficulty)}`}>
                        {question.difficulty}
                      </span>
                    </div>
                    <p className="mt-3 text-base font-medium text-foreground">{question.question_text_normalized || question.question_text_raw}</p>
                    {question.knowledge_points.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {question.knowledge_points.map((kp) => (
                          <span key={kp} className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
                            {kp}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
