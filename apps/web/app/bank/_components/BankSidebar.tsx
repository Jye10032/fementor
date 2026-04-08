"use client";

import { PagePanel } from "../../../components/page-shell";

interface BankSidebarProps {
  chapter: string;
  sourceFilter: string;
  typeFilter: string;
  output: string;
}

export function BankSidebar({ chapter, sourceFilter, typeFilter, output }: BankSidebarProps) {
  return (
    <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
      <PagePanel>
        <span className="eyebrow-chip">Overview</span>
        <h3 className="mt-3 text-xl font-semibold text-foreground">当前筛选快照</h3>
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-xl bg-background/80 p-4">
            <p className="text-xs text-muted-foreground">章节</p>
            <p className="mt-2 font-medium text-foreground">{chapter || "未填写"}</p>
          </div>
          <div className="rounded-xl bg-background/80 p-4">
            <p className="text-xs text-muted-foreground">来源 / 题型</p>
            <p className="mt-2 font-medium text-foreground">{sourceFilter} / {typeFilter}</p>
          </div>
        </div>
      </PagePanel>

      <PagePanel>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">调试输出</p>
        <pre className="mt-3 rounded-xl bg-secondary p-3 text-xs leading-6">{output || "暂无输出"}</pre>
      </PagePanel>
    </div>
  );
}
