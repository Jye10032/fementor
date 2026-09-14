"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { BookOpen, Check, Download, LoaderCircle, LockKeyhole, LogIn, Play, Search } from "lucide-react";
import type { ReturnTypeOfOfficialBank } from "../_lib/official-bank-view.types";

type OfficialQuestionBankProps = {
  bank: ReturnTypeOfOfficialBank;
  authEnabled: boolean;
  isSignedIn: boolean;
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: "简单",
  medium: "中等",
  hard: "困难",
};

const CATEGORY_LABELS: Record<string, string> = {
  interview: "综合面试",
  framework: "框架原理",
  language: "编程语言",
  browser: "浏览器",
  engineering: "工程化",
  scenario: "场景实战",
};

export function OfficialQuestionBank({ bank, authEnabled, isSignedIn }: OfficialQuestionBankProps) {
  const available = bank.status?.configured && bank.status?.reachable;
  const statusLabel = !bank.status
    ? "正在检查远端题库"
    : available
      ? "远端题库已连接"
      : "远端题库暂不可用";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 border-b border-border pb-5 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className={`size-2 rounded-full ${!bank.status ? "animate-pulse bg-muted-foreground" : available ? "bg-accent" : "bg-warning"}`} />
            {statusLabel}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            官方内容只读，导入后会成为你的本地副本。
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LockKeyhole className="size-4" />
          数据库级只读
          {bank.status?.total !== undefined ? <span>· {bank.status.total} 道题</span> : null}
        </div>
      </div>

      <form onSubmit={bank.submitSearch} className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_150px_140px_auto]">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={bank.query}
            onChange={(event) => bank.setQuery(event.target.value)}
            className="field-shell w-full pl-10"
            placeholder="搜索题目或知识点"
          />
        </label>
        <input
          value={bank.chapter}
          onChange={(event) => bank.setChapter(event.target.value)}
          className="field-shell w-full"
          placeholder="章节，例如 React"
        />
        <select
          value={bank.category}
          onChange={(event) => bank.setCategory(event.target.value)}
          className="field-shell w-full"
          aria-label="题目类别"
        >
          <option value="">全部类别</option>
          <option value="interview">综合面试</option>
          <option value="framework">框架原理</option>
          <option value="language">编程语言</option>
          <option value="browser">浏览器</option>
          <option value="engineering">工程化</option>
          <option value="scenario">场景实战</option>
        </select>
        <select
          value={bank.difficulty}
          onChange={(event) => bank.setDifficulty(event.target.value)}
          className="field-shell w-full"
          aria-label="难度"
        >
          <option value="">全部难度</option>
          <option value="easy">简单</option>
          <option value="medium">中等</option>
          <option value="hard">困难</option>
        </select>
        <button type="submit" className="action-secondary gap-2" disabled={bank.loading}>
          {bank.loading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
          筛选
        </button>
      </form>

      {bank.error ? (
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          {bank.error}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm">
            <p className="font-medium text-foreground">找到 {bank.total} 道题</p>
            <p className="text-muted-foreground">导入操作不会修改远端内容</p>
          </div>

          {bank.loading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在读取官方题库
            </div>
          ) : bank.items.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center border-y border-border text-center">
              <BookOpen className="size-6 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium text-foreground">当前条件下没有题目</p>
              <p className="mt-1 text-sm text-muted-foreground">可以清空章节、类别和难度后重新筛选。</p>
            </div>
          ) : (
            <div className="divide-y divide-border border-y border-border">
              {bank.items.map((item) => (
                <article key={item.id} className="py-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">官方</span>
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-muted-foreground">{item.chapter || "未分类"}</span>
                        {item.category ? (
                          <span className="text-muted-foreground">{CATEGORY_LABELS[item.category] || item.category}</span>
                        ) : null}
                        <span className="text-muted-foreground">{DIFFICULTY_LABELS[item.difficulty] || item.difficulty || "中等"}</span>
                      </div>
                      <h3 className="mt-3 text-base font-semibold leading-7 text-foreground">
                        {item.question_text || item.canonical_question}
                      </h3>
                      {item.knowledge_points.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {item.knowledge_points.slice(0, 4).map((point) => (
                            <span key={point} className="text-xs text-muted-foreground">#{point}</span>
                          ))}
                        </div>
                      ) : null}
                      {item.expected_points.length ? (
                        <details className="mt-3 text-sm text-muted-foreground">
                          <summary className="cursor-pointer select-none font-medium text-foreground">查看详情</summary>
                          <ul className="mt-2 space-y-1 pl-5">
                            {item.expected_points.map((point) => <li key={point} className="list-disc">{point}</li>)}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                    <div className="flex min-w-36 flex-col gap-2">
                      {!isSignedIn && authEnabled ? (
                        <SignInButton mode="modal">
                          <button type="button" className="action-secondary gap-2">
                            <LogIn className="size-4" />
                            登录后导入
                          </button>
                        </SignInButton>
                      ) : (
                        <button
                          type="button"
                          onClick={() => bank.importQuestion(item.id)}
                          disabled={!isSignedIn || item.is_imported || bank.importingId === item.id}
                          className="action-secondary gap-2 disabled:cursor-default disabled:opacity-65"
                        >
                          {bank.importingId === item.id ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : item.is_imported ? (
                            <Check className="size-4" />
                          ) : (
                            <Download className="size-4" />
                          )}
                          {item.is_imported ? "已在我的题库" : isSignedIn ? "导入我的题库" : "正在初始化"}
                        </button>
                      )}
                      {item.is_imported ? (
                        <Link href={`/practice?chapter=${encodeURIComponent(item.chapter || "")}`} className="action-secondary gap-2">
                          <Play className="size-4" />
                          开始练习
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {bank.items.length < bank.total ? (
            <div className="flex justify-center">
              <button type="button" className="action-secondary gap-2" onClick={bank.loadMore} disabled={bank.loadingMore}>
                {bank.loadingMore ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                {bank.loadingMore ? "加载中..." : "加载更多"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
