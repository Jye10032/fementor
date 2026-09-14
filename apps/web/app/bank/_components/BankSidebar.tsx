"use client";

import { PagePanel } from "../../../components/page-shell";

interface BankSidebarProps {
  chapter: string;
  sourceFilter: string;
  typeFilter: string;
}

const SOURCE_LABELS: Record<string, string> = {
  all: "全部来源",
  resume: "简历",
  doc: "资料文档",
  llm: "AI 追问",
  official_remote: "官方题库",
  unknown: "未分类",
};

const TYPE_LABELS: Record<string, string> = {
  all: "全部题型",
  basic: "基础题",
  interview: "综合面试",
  project: "项目深挖",
  scenario: "场景题",
  follow_up: "追问题",
  unknown: "未分类",
};

export function BankSidebar({ chapter, sourceFilter, typeFilter }: BankSidebarProps) {
  return (
    <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
      <PagePanel>
        <h3 className="text-base font-semibold text-foreground">当前范围</h3>
        <dl className="mt-4 divide-y divide-border text-sm">
          <div className="flex items-center justify-between gap-4 py-3">
            <p className="text-xs text-muted-foreground">章节</p>
            <p className="truncate font-medium text-foreground">{chapter || "全部章节"}</p>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <p className="text-xs text-muted-foreground">来源</p>
            <p className="truncate font-medium text-foreground">{SOURCE_LABELS[sourceFilter] || sourceFilter}</p>
          </div>
          <div className="flex items-center justify-between gap-4 py-3">
            <p className="text-xs text-muted-foreground">题型</p>
            <p className="truncate font-medium text-foreground">{TYPE_LABELS[typeFilter] || typeFilter}</p>
          </div>
        </dl>
      </PagePanel>

      <PagePanel>
        <h3 className="text-base font-semibold text-foreground">数据归属</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          这里仅展示当前用户导入或面试沉淀的题目，复习状态不会影响其他用户和远端官方题库。
        </p>
      </PagePanel>
    </div>
  );
}
