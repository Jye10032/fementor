"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, BookOpen, Building2, Calendar, ExternalLink, Layers, Star, User } from "lucide-react";
import { ExperienceListItem } from "../_lib/experience.types";

type ExperienceListProps = {
  items: ExperienceListItem[];
  loading: boolean;
  error: string | null;
};

function formatPublishedAt(value: string) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function qualityColor(score: number) {
  if (score >= 80) return "text-[oklch(0.55_0.16_155)]";
  if (score >= 60) return "text-[oklch(0.65_0.16_85)]";
  return "text-[oklch(0.53_0.19_25)]";
}

function SkeletonCard() {
  return (
    <div className="panel-surface animate-pulse space-y-2.5 py-4">
      <div className="flex items-center gap-2">
        <div className="h-5 w-14 rounded-full bg-secondary" />
        <div className="h-5 w-2/3 rounded bg-secondary" />
      </div>
      <div className="flex gap-2">
        <div className="h-4 w-14 rounded-full bg-secondary" />
        <div className="h-4 w-14 rounded-full bg-secondary" />
        <div className="h-4 w-14 rounded-full bg-secondary" />
      </div>
      <div className="h-4 w-full max-w-lg rounded bg-secondary" />
      <div className="flex items-center justify-between">
        <div className="h-4 w-40 rounded bg-secondary" />
        <div className="flex gap-2">
          <div className="h-7 w-20 rounded-lg bg-secondary" />
          <div className="h-7 w-16 rounded-lg bg-secondary" />
        </div>
      </div>
    </div>
  );
}

export function ExperienceList({ items, loading, error }: ExperienceListProps) {
  if (loading) {
    return (
      <div className="grid gap-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-surface flex items-center gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-[oklch(0.53_0.19_25)]" />
        <p className="text-sm text-[oklch(0.53_0.19_25)]">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="panel-surface flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary">
          <BookOpen className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          当前没有可展示的面经。先同步一次近 7 日内容，再回来查看列表。
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item, index) => (
        <article
          key={item.id}
          className="panel-surface space-y-2.5 py-4 fade-in-up"
          style={{ animationDelay: `${Math.min(index * 50, 250)}ms` }}
        >
          <div className="flex items-center gap-2">
            <span className="eyebrow-chip shrink-0">{item.source_platform}</span>
            <h2 className="truncate text-base font-semibold text-foreground">{item.title}</h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {item.company_name ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {item.company_name}
              </span>
            ) : null}
            {item.role_name ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {item.role_name}
              </span>
            ) : null}
            {item.interview_stage ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
                <Layers className="h-3 w-3" />
                {item.interview_stage}
              </span>
            ) : null}
          </div>

          <p className="truncate text-sm text-muted-foreground">{item.summary || "暂无摘要"}</p>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className={`font-semibold ${qualityColor(item.quality_score)}`}>
                <Star className="mr-0.5 inline h-3 w-3" />{item.quality_score}
              </span>
              <span>{item.question_group_count}组 · {item.question_item_count}题</span>
              <span className="hidden sm:inline">
                <Calendar className="mr-0.5 inline h-3 w-3" />{formatPublishedAt(item.published_at)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/experience/${item.id}`} className="inline-flex cursor-pointer items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                详情
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
              <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex cursor-pointer items-center rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
                原帖
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
