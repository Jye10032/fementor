"use client";

import { SignInButton } from "@clerk/nextjs";
import { Globe2, LibraryBig } from "lucide-react";
import { useState } from "react";
import { useAuthState } from "../../components/auth-provider";
import { PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { useBankItems } from "./_hooks/use-bank-items";
import { useOfficialQuestionBank } from "./_hooks/use-official-question-bank";
import { BankFilterControls } from "./_components/BankFilterControls";
import { BankStatsTiles } from "./_components/BankStatsTiles";
import { BankItemList } from "./_components/BankItemList";
import { BankSidebar } from "./_components/BankSidebar";
import { OfficialQuestionBank } from "./_components/OfficialQuestionBank";

type BankView = "mine" | "official";

export default function BankPage() {
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, authReady, authUser, isLoaded, isSignedIn, viewer } = useAuthState();
  const identityKey = authUser?.clerkUserId || viewer?.id || (isSignedIn ? "authenticated" : "anonymous");
  const dataReady = authReady && isLoaded;
  const bank = useBankItems(apiBase, {
    enabled: dataReady && isSignedIn,
    identityKey,
  });
  const officialBank = useOfficialQuestionBank(apiBase, {
    enabled: dataReady,
    identityKey,
    onImported: bank.refresh,
  });
  const [activeView, setActiveView] = useState<BankView>("mine");
  const viewerLabel = viewer?.name || viewer?.email || (isSignedIn ? "本地用户" : "未登录");

  return (
    <PageShell>
      <header className="flex min-w-0 flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 max-w-2xl">
          <p className="text-xs font-semibold text-primary">题库</p>
          <h1 className="mt-2 break-words text-2xl font-semibold text-foreground sm:text-3xl">选择题目，安排下一轮训练</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            从官方题库导入题目，或继续复习模拟面试沉淀到个人题库的薄弱项。
          </p>
        </div>
        <dl className="grid min-w-0 grid-cols-2 gap-5 text-sm md:min-w-72">
          <div className="border-l border-border pl-4">
            <dt className="text-xs text-muted-foreground">当前用户</dt>
            <dd className="mt-1 truncate font-semibold text-foreground">{viewerLabel}</dd>
          </div>
          <div className="border-l border-border pl-4">
            <dt className="text-xs text-muted-foreground">章节焦点</dt>
            <dd className="mt-1 truncate font-semibold text-foreground">{bank.chapter || "全部章节"}</dd>
          </div>
        </dl>
      </header>

      <PagePanel className="p-2">
        <div className="grid min-w-0 gap-1 sm:grid-cols-2" role="tablist" aria-label="题库来源">
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "mine"}
            onClick={() => setActiveView("mine")}
            className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${activeView === "mine" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
          >
            <LibraryBig className="size-4" />
            我的题库
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeView === "official"}
            onClick={() => setActiveView("official")}
            className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${activeView === "official" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
          >
            <Globe2 className="size-4" />
            官方题库
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${activeView === "official" ? "bg-primary-foreground/15 text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>只读</span>
          </button>
        </div>
      </PagePanel>

      {activeView === "mine" && !isLoaded ? (
        <PagePanel>正在同步登录态...</PagePanel>
      ) : activeView === "mine" && !isSignedIn ? (
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

      {activeView === "official" ? (
        <PagePanel>
          <OfficialQuestionBank
            bank={officialBank}
            authEnabled={authEnabled}
            isSignedIn={isLoaded && isSignedIn}
          />
        </PagePanel>
      ) : (
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
              {bank.error ? (
                <p className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
                  {bank.error}
                </p>
              ) : null}
              <BankItemList items={bank.filteredItems} markDone={bank.markDone} />
            </PagePanel>

            <BankSidebar
              chapter={bank.chapter}
              sourceFilter={bank.sourceFilter}
              typeFilter={bank.typeFilter}
            />
          </section>
        </div>
      )}
    </PageShell>
  );
}
