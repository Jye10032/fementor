"use client";

import { Building2, ExternalLink, FileText, Flame, Layers, User } from "lucide-react";
import { ExperienceDetail as ExperienceDetailType } from "../_lib/experience.types";

type ExperienceDetailProps = {
  item: ExperienceDetailType;
};

function formatPopularity(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function difficultyStyle(d: string) {
  const lower = d.toLowerCase();
  if (lower === "easy" || lower === "简单") return "border-success/30 bg-success/8 text-success";
  if (lower === "medium" || lower === "中等") return "border-warning/30 bg-warning/8 text-warning";
  if (lower === "hard" || lower === "困难") return "border-destructive/30 bg-destructive/8 text-destructive";
  return "border-border/70 bg-background text-muted-foreground";
}

function roleStyle(role: string) {
  const lower = role.toLowerCase();
  if (lower === "main" || lower === "主问") return "border-primary/30 bg-primary/8 text-primary";
  if (lower === "follow_up" || lower === "追问") return "border-accent/30 bg-accent/8 text-accent";
  return "border-border/70 bg-background text-muted-foreground";
}

export function ExperienceDetail({ item }: ExperienceDetailProps) {
  return (
    <div className="space-y-4">
      {/* Header: title + meta inline */}
      <section className="panel-surface space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow-chip">{item.source_platform}</span>
          <h1 className="text-xl font-semibold text-foreground">{item.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.company_name ? <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{item.company_name}</span> : null}
          {item.role_name ? <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{item.role_name}</span> : null}
          {item.interview_stage ? <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{item.interview_stage}</span> : null}
          <span className="inline-flex items-center gap-1"><User className="h-3 w-3" />{item.author_name || "未知作者"}</span>
          <span className="font-semibold text-warning">
            <Flame className="mr-0.5 inline h-3 w-3" />{formatPopularity(item.popularity)}
          </span>
          <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex cursor-pointer items-center gap-1 text-primary transition-colors hover:text-primary/80">
            原帖<ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </section>

      {/* Question groups + raw content side by side */}
      <section className="grid gap-3 xl:grid-cols-2">
        <div className="space-y-3">
          <p className="text-base font-semibold text-foreground">问题簇</p>
          {item.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前没有抽取到问题簇。</p>
          ) : (
            item.groups.map((group) => (
              <article key={group.id} className="overflow-hidden rounded-xl border border-border/70 bg-card/90 backdrop-blur">
                <div className="border-b border-border/70 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="eyebrow-chip">{group.topic_cluster || "未分类"}</span>
                    <h2 className="text-base font-semibold text-foreground">{group.canonical_question || "未命名问题簇"}</h2>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {group.group_type} · 置信度 {group.confidence.toFixed(2)}
                  </p>
                </div>
                <div className="divide-y divide-border/50">
                  {group.items.map((question) => (
                    <div key={question.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] tracking-wide ${roleStyle(question.question_role)}`}>
                          {question.question_role}
                        </span>
                        <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] tracking-wide text-muted-foreground">
                          {question.category}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] tracking-wide ${difficultyStyle(question.difficulty)}`}>
                          {question.difficulty}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm font-medium text-foreground">{question.question_text_normalized || question.question_text_raw}</p>
                      {question.knowledge_points.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {question.knowledge_points.map((kp) => (
                            <span key={kp} className="rounded-md bg-secondary/60 px-1.5 py-0.5 text-xs text-muted-foreground">
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
        </div>
        <article className="panel-surface xl:sticky xl:top-22 xl:self-start">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />原文
          </p>
          <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{item.content_raw || "暂无原文"}</p>
        </article>
      </section>
    </div>
  );
}
