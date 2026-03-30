"use client";

import { Loader2, RefreshCw, Search } from "lucide-react";

type ExperienceSearchBarProps = {
  keyword: string;
  onKeywordChange: (value: string) => void;
  syncing: boolean;
  onSync: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  syncDisabled?: boolean;
  searchDisabled?: boolean;
};

export function ExperienceSearchBar({
  keyword,
  onKeywordChange,
  syncing,
  onSync,
  searchQuery,
  onSearchQueryChange,
  syncDisabled = false,
  searchDisabled = false,
}: ExperienceSearchBarProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="panel-muted space-y-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">获取近 7 日面经</p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          输入关键词后系统会自动抓取牛客近 7 日未入库内容，最多新增 10 条。
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
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
              "获取近 7 日面经"
            )}
          </button>
        </div>
      </section>

      <section className="panel-muted space-y-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">搜索本地面经库</p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          搜索标题、摘要和规范问题，优先命中已经完成清洗的内容。
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
