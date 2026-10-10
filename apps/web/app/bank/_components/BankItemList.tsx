"use client";

import { Check } from "lucide-react";
import type { BankItem } from "../_lib/bank.types";

interface BankItemListProps {
  items: BankItem[];
  markDone: (id: string) => void;
}

const STATUS_LABELS: Record<string, string> = { pending: "待复习", done: "已完成" };
const DIFFICULTY_LABELS: Record<string, string> = { easy: "简单", medium: "中等", hard: "困难" };
const SOURCE_LABELS: Record<string, string> = {
  resume: "简历",
  doc: "资料文档",
  llm: "AI 追问",
  official_remote: "官方题库",
  experience: "面经",
  unknown: "未分类",
};
const TYPE_LABELS: Record<string, string> = {
  basic: "基础题",
  interview: "综合面试",
  project: "项目深挖",
  scenario: "场景题",
  follow_up: "追问题",
  unknown: "未分类",
};

export function BankItemList({ items, markDone }: BankItemListProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-2xl bg-secondary p-4 text-sm text-muted-foreground">
        当前筛选条件下暂无题目，先去模拟面试完成复盘或调整筛选。
      </p>
    );
  }

  return (
    <section className="space-y-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-border bg-background/85 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={item.review_status === "done"
                  ? "rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
                  : "rounded-full bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
                }>
                  {STATUS_LABELS[item.review_status] || item.review_status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.chapter || "未分类"} · {DIFFICULTY_LABELS[item.difficulty] || item.difficulty || "中等"}
                </span>
              </div>
              <p className="mt-3 text-base font-semibold leading-7 text-foreground">{item.question}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                下次复习时间：{item.next_review_at ?? "暂未安排"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                  来源：{SOURCE_LABELS[item.source_question_source || "unknown"] || item.source_question_source}
                </span>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                  题型：{TYPE_LABELS[item.source_question_type || "unknown"] || item.source_question_type}
                </span>
                {item.weakness_tag ? (
                  <span className="rounded-full bg-warning/10 px-3 py-1 text-xs text-warning">
                    薄弱项 {item.weakness_tag}
                  </span>
                ) : null}
                {item.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{tag}</span>
                ))}
              </div>
            </div>
            <div className="flex min-w-[160px] flex-col gap-3 lg:items-end">
              {item.review_status !== "done" ? (
                <button onClick={() => markDone(item.id)} className="action-secondary gap-2 text-xs">
                  <Check className="size-4" />
                  标记已完成
                </button>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
