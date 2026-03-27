"use client";

type ExperienceSearchBarProps = {
  keyword: string;
  onKeywordChange: (value: string) => void;
  syncing: boolean;
  onSync: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  disabled?: boolean;
};

export function ExperienceSearchBar({
  keyword,
  onKeywordChange,
  syncing,
  onSync,
  searchQuery,
  onSearchQueryChange,
  disabled = false,
}: ExperienceSearchBarProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <section className="panel-muted space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">获取近 7 日面经</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            输入关键词后系统会自动抓取牛客近 7 日未入库内容，最多新增 10 条。
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="例如：前端实习 / React 面经 / 腾讯 前端"
            className="field-shell w-full"
            disabled={disabled || syncing}
          />
          <button
            type="button"
            onClick={onSync}
            disabled={disabled || syncing || !keyword.trim()}
            className="action-primary whitespace-nowrap"
          >
            {syncing ? "同步中..." : "获取近 7 日面经"}
          </button>
        </div>
      </section>

      <section className="panel-muted space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">搜索本地面经库</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            搜索标题、摘要和规范问题，优先命中已经完成清洗的内容。
          </p>
        </div>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="搜索：虚拟列表 / Promise / 前端实习"
          className="field-shell w-full"
          disabled={disabled}
        />
      </section>
    </div>
  );
}
