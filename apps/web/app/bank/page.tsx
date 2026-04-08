"use client";

import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../components/auth-provider";
import { PageHero, PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { useBankItems } from "./_hooks/use-bank-items";
import { BankFilterControls } from "./_components/BankFilterControls";
import { BankStatsTiles } from "./_components/BankStatsTiles";
import { BankItemList } from "./_components/BankItemList";
import { BankSidebar } from "./_components/BankSidebar";

export default function BankPage() {
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, isLoaded, isSignedIn, viewer } = useAuthState();
  const bank = useBankItems(apiBase);

  return (
    <PageShell>
      <PageHero
        eyebrow="Question Bank"
        title="把模拟面试的反馈压成一套真正会追踪的复习题单"
        description="这里不是静态列表，而是把题目来源、薄弱点和复习状态组织成训练面板，方便你决定下一轮练什么、先补哪里。"
        aside={(
          <>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">当前用户</p>
              <p className="mt-3 text-lg font-semibold text-foreground">{viewer?.name || viewer?.email || "未登录"}</p>
            </article>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">章节焦点</p>
              <p className="mt-3 text-sm leading-6 text-foreground">{bank.chapter || "未选择章节"}</p>
            </article>
          </>
        )}
      />

      {!isLoaded ? (
        <PagePanel>正在同步登录态...</PagePanel>
      ) : !isSignedIn ? (
        <PagePanel className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-foreground">题单页面需要先登录。</p>
            <p className="mt-1 text-sm text-muted-foreground">题目来源、复习状态和薄弱项趋势都绑定在当前 viewer 下。</p>
          </div>
          {authEnabled ? (
            <SignInButton mode="modal">
              <button type="button" className="action-primary">立即登录</button>
            </SignInButton>
          ) : (
            <span className="text-sm text-muted-foreground">登录未启用</span>
          )}
        </PagePanel>
      ) : null}

      <div className="space-y-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <PagePanel className="space-y-5">
            <BankFilterControls
              chapter={bank.chapter} setChapter={bank.setChapter}
              sourceFilter={bank.sourceFilter} setSourceFilter={bank.setSourceFilter}
              typeFilter={bank.typeFilter} setTypeFilter={bank.setTypeFilter}
              loading={bank.loading} refresh={bank.refresh}
            />
            <BankStatsTiles
              totalCount={bank.filteredItems.length}
              pendingCount={bank.pendingCount}
              doneCount={bank.doneCount}
              weaknessCount={bank.weaknessCount}
            />
            <BankItemList items={bank.filteredItems} markDone={bank.markDone} />
          </PagePanel>

          <BankSidebar
            chapter={bank.chapter}
            sourceFilter={bank.sourceFilter}
            typeFilter={bank.typeFilter}
            output={bank.output}
          />
        </section>
      </div>
    </PageShell>
  );
}