"use client";

import { Loader2, RefreshCw, Search } from "lucide-react";
import { ExperienceFilterOptions } from "../_lib/experience.types";

type ExperienceSearchBarProps = {
  company: string;
  role: string;
  filters: ExperienceFilterOptions;
  filtersLoading: boolean;
  filtersError: string;
  onRetryFilters: () => void;
  onCompanyChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onClear: () => void;
  keyword: string;
  onKeywordChange: (value: string) => void;
  limit: number;
  onLimitChange: (value: number) => void;
  syncing: boolean;
  onSync: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  syncAllowed: boolean;
};

const LIMIT_OPTIONS = [1, 5, 10] as const;

export function ExperienceSearchBar({
  company, role, filters, filtersLoading, filtersError, onRetryFilters,
  onCompanyChange, onRoleChange, onClear,
  keyword, onKeywordChange, limit, onLimitChange, syncing, onSync,
  searchQuery, onSearchQueryChange, syncAllowed,
}: ExperienceSearchBarProps) {
  return (
    <div className="space-y-3">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
        <label className="min-w-0 text-sm">
          <span className="mb-1.5 block font-medium text-foreground">公司</span>
          <select className="field-shell w-full" value={company} onChange={(event) => onCompanyChange(event.target.value)} disabled={filtersLoading || Boolean(filtersError)}>
            <option value="">{filtersLoading ? "正在加载公司..." : "全部公司"}</option>
            {company && !filters.companies.includes(company) ? <option value={company}>{company}</option> : null}
            {filters.companies.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          <span className="mb-1.5 block font-medium text-foreground">岗位</span>
          <select className="field-shell w-full" value={role} onChange={(event) => onRoleChange(event.target.value)} disabled={filtersLoading || Boolean(filtersError)}>
            <option value="">{filtersLoading ? "正在加载岗位..." : "全部岗位"}</option>
            {role && !filters.roles.includes(role) ? <option value={role}>{role}</option> : null}
            {filters.roles.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          <span className="mb-1.5 block text-muted-foreground">关键词（可选）</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={searchQuery} onChange={(event) => onSearchQueryChange(event.target.value)} placeholder="搜索题目或面经内容" className="field-shell w-full pl-9" />
          </div>
        </label>
        <button type="button" onClick={onClear} disabled={!company && !role && !searchQuery} className="action-secondary disabled:opacity-40">清除筛选</button>
      </div>
      {filtersError ? <p role="alert" className="text-sm text-warning">{filtersError}<button type="button" onClick={onRetryFilters} className="ml-2 underline">重新加载</button></p> : null}
      {syncAllowed ? (
        <details className="rounded-lg border border-border/70 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">管理面经{syncing ? " · 正在同步" : ""}</summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-xs text-muted-foreground">
              <span className="mb-1.5 block">采集关键词</span>
              <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="例如：前端实习 / React" className="field-shell w-full" disabled={syncing} />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="mb-1.5 block">同步数量</span>
              <select value={limit} onChange={(event) => onLimitChange(Number(event.target.value))} className="field-shell" disabled={syncing}>
                {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{n} 条</option>)}
              </select>
            </label>
            <button type="button" onClick={onSync} disabled={syncing || !keyword.trim()} className="action-secondary gap-2 disabled:opacity-50">
              {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {syncing ? "同步中..." : "同步面经"}
            </button>
          </div>
        </details>
      ) : null}
    </div>
  );
}
