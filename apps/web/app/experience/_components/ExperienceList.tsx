"use client";

import { useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { AlertCircle, ArrowRight, BookOpen, Building2, Calendar, ExternalLink, Flame, Layers, Trash2, User } from "lucide-react";
import { ExperienceListItem } from "../_lib/experience.types";

type ExperienceListProps = {
  items: ExperienceListItem[];
  loading: boolean;
  error: string | null;
  onDelete?: (id: string) => Promise<void>;
  onDeleteBatch?: (ids: string[]) => Promise<void>;
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

function formatPopularity(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function SkeletonCard() {
  return (
    <div className="animate-pulse space-y-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="h-4 w-12 rounded-full bg-secondary" />
        <div className="h-4 w-2/3 rounded bg-secondary" />
      </div>
      <div className="flex gap-2">
        <div className="h-3.5 w-14 rounded bg-secondary" />
        <div className="h-3.5 w-14 rounded bg-secondary" />
        <div className="h-3.5 w-14 rounded bg-secondary" />
      </div>
      <div className="h-3.5 w-full max-w-md rounded bg-secondary" />
    </div>
  );
}

function ExperienceRow({ item, onDelete, deleting, selectable, selected, onToggle }: {
  item: ExperienceListItem;
  onDelete?: (id: string) => void;
  deleting: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle?: (id: string) => void;
}) {
  return (
    <article className="space-y-1.5 px-4 pt-3 pb-5 transition-colors duration-150 hover:bg-secondary/40">
      <div className="flex items-center gap-2">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle?.(item.id)}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-primary"
            aria-label={`选择 ${item.title}`}
          />
        )}
        <span className="eyebrow-chip shrink-0">{item.source_platform}</span>
        <h2 className="truncate text-sm font-semibold text-foreground">{item.title}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Link href={`/experience/${item.id}`} className="inline-flex cursor-pointer items-center rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            详情<ArrowRight className="ml-0.5 h-3 w-3" />
          </Link>
          <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex cursor-pointer items-center rounded-lg border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary">
            原帖<ExternalLink className="ml-0.5 h-3 w-3" />
          </a>
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              disabled={deleting}
              className="cursor-pointer rounded-lg p-1 text-muted-foreground/40 transition-colors duration-200 hover:bg-destructive/10 hover:text-destructive"
              aria-label="删除面经"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {item.company_name ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3" />{item.company_name}
          </span>
        ) : null}
        {item.role_name ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />{item.role_name}
          </span>
        ) : null}
        {item.interview_stage ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Layers className="h-3 w-3" />{item.interview_stage}
          </span>
        ) : null}
        <span className="mx-0.5 text-border">|</span>
        <span className="text-xs font-semibold text-warning">
          <Flame className="mr-0.5 inline h-3 w-3" />{formatPopularity(item.popularity)}
        </span>
        <span className="text-xs text-muted-foreground">{item.question_group_count}组 · {item.question_item_count}题</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          <Calendar className="mr-0.5 inline h-3 w-3" />{formatPublishedAt(item.published_at)}
        </span>
      </div>

      <p className="truncate text-xs text-muted-foreground">{item.summary || "暂无摘要"}</p>
    </article>
  );
}

function LoadingBar() {
  return (
    <div className="divide-y divide-border/40 border-t border-border/40">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

export function ExperienceList({ items, loading, error, onDelete, onDeleteBatch }: ExperienceListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [deletingId, setDeletingId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);

  const selectable = Boolean(onDeleteBatch);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((item) => item.id)));
    }
  };

  const handleBatchDelete = async () => {
    if (!onDeleteBatch || selected.size === 0) return;
    if (!window.confirm(`确认删除选中的 ${selected.size} 条面经？`)) return;
    setBatchDeleting(true);
    try {
      await onDeleteBatch([...selected]);
      setSelected(new Set());
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!onDelete) return;
    if (!window.confirm("确认删除该面经？")) return;
    setDeletingId(id);
    try {
      await onDelete(id);
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } finally {
      setDeletingId("");
    }
  };

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 100,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  if (error) {
    return (
      <div className="panel-surface flex items-center gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[var(--shadow-card)] backdrop-blur">
        <LoadingBar />
      </div>
    );
  }

  if (!loading && items.length === 0) {
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
    <div
      ref={listRef}
      className="overflow-hidden rounded-2xl border border-border/70 bg-card/90 shadow-[var(--shadow-card)] backdrop-blur"
    >
      {selectable && items.length > 0 && (
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2">
          <input
            type="checkbox"
            checked={selected.size === items.length && items.length > 0}
            onChange={toggleSelectAll}
            className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
            aria-label="全选"
          />
          <span className="text-xs text-muted-foreground">
            {selected.size > 0 ? `已选 ${selected.size} 条` : "全选"}
          </span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => void handleBatchDelete()}
              disabled={batchDeleting}
              className="cursor-pointer rounded-lg bg-destructive px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
            >
              {batchDeleting ? "删除中..." : `删除 ${selected.size} 条`}
            </button>
          )}
        </div>
      )}
      {loading ? <LoadingBar /> : null}
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={item.id}
              className="absolute left-0 top-0 w-full border-b border-border/40 last:border-b-0"
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
              }}
            >
              <ExperienceRow
                item={item}
                onDelete={onDelete ? handleDelete : undefined}
                deleting={deletingId === item.id}
                selectable={selectable}
                selected={selected.has(item.id)}
                onToggle={toggleSelect}
              />
            </div>
          );
        })}
      </div>
      {loading ? <LoadingBar /> : null}
    </div>
  );
}
