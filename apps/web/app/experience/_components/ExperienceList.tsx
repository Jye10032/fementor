"use client";

import Link from "next/link";
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

export function ExperienceList({ items, loading, error }: ExperienceListProps) {
  if (loading) {
    return <div className="panel-surface text-sm text-muted-foreground">正在加载面经列表...</div>;
  }

  if (error) {
    return <div className="panel-surface text-sm text-[oklch(0.53_0.19_25)]">{error}</div>;
  }

  if (items.length === 0) {
    return (
      <div className="panel-surface text-sm text-muted-foreground">
        当前没有可展示的面经。先同步一次近 7 日内容，再回来查看列表。
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {items.map((item) => (
        <article key={item.id} className="panel-surface">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <p className="eyebrow-chip">{item.source_platform}</p>
                <h2 className="text-2xl font-semibold text-foreground">{item.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {item.company_name || "未知公司"} · {item.role_name || "未知岗位"} · {item.interview_stage || "未知轮次"}
                </p>
              </div>
              <p className="max-w-3xl text-sm leading-7 text-muted-foreground">{item.summary || "暂无摘要"}</p>
            </div>

            <div className="grid min-w-[260px] gap-3 sm:grid-cols-2">
              <div className="metric-tile">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">发布时间</p>
                <p className="mt-2 text-sm font-medium text-foreground">{formatPublishedAt(item.published_at)}</p>
              </div>
              <div className="metric-tile">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">质量分</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{item.quality_score}</p>
              </div>
              <div className="metric-tile">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">问题组</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{item.question_group_count}</p>
              </div>
              <div className="metric-tile">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">问题项</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{item.question_item_count}</p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={`/experience/${item.id}`} className="action-primary">
              查看详情
            </Link>
            <a href={item.source_url} target="_blank" rel="noreferrer" className="action-secondary">
              查看原帖
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
