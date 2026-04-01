"use client";

import { Loader2, RefreshCw, Search } from "lucide-react";

type ExperienceSearchBarProps = {
  keyword: string;
  onKeywordChange: (value: string) => void;
  limit: number;
  onLimitChange: (value: number) => void;
  syncing: boolean;
  onSync: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  syncDisabled?: boolean;
  searchDisabled?: boolean;
};

const LIMIT_OPTIONS = [1, 5, 10] as const;

export function ExperienceSearchBar({
  keyword,
  onKeywordChange,
  limit,
  onLimitChange,
  syncing,
  onSync,
  searchQuery,
  onSearchQueryChange,
  syncDisabled = false,
  searchDisabled = false,
}: ExperienceSearchBarProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="panel-muted space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <RefreshCw className="h-3.5 w-3.5 text-primary" />获取面经
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full">
            <RefreshCw className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(event) => onKeywordChange(event.target.value)}
              placeholder="例如：前端实习 / React 面经 / 腾讯 前端"
              className="field-shell w-full pl-9"
              disabled={syncDisabled || syncing}
            />
          </div>
          <div className="flex shrink-0 gap-1 rounded-xl border border-border/70 bg-background/80 p-0.5">
            {LIMIT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onLimitChange(n)}
                disabled={syncDisabled || syncing}
                className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  limit === n
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                }`}
              >
                {n}条
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onSync}
            disabled={syncDisabled || syncing || !keyword.trim()}
            className="action-primary cursor-pointer whitespace-nowrap"
          >
            {syncing ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                同步中...
              </>
            ) : (
              "同步"
            )}
          </button>
        </div>
      </section>

      <section className="panel-muted space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Search className="h-3.5 w-3.5 text-primary" />搜索面经库
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="搜索：虚拟列表 / Promise / 前端实习"
            className="field-shell w-full pl-9"
            disabled={searchDisabled}
          />
        </div>
      </section>
    </div>
  );
}
