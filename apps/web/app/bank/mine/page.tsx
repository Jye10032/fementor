"use client";

import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { Play } from "lucide-react";
import { useAuthState } from "../../../components/auth-provider";
import { BankNavigation } from "../../../components/bank-navigation";
import { PagePanel, PageShell } from "../../../components/page-shell";
import { useRuntimeConfig } from "../../../components/runtime-config";
import { useBankItems } from "../_hooks/use-bank-items";
import { BankFilterControls } from "../_components/BankFilterControls";
import { BankStatsTiles } from "../_components/BankStatsTiles";
import { BankItemList } from "../_components/BankItemList";

export default function MyQuestionBankPage() {
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, authReady, authUser, isLoaded, isSignedIn, viewer } = useAuthState();
  const bank = useBankItems(apiBase, {
    enabled: authReady && isLoaded && isSignedIn,
    identityKey: authUser?.clerkUserId || viewer?.id || (isSignedIn ? "authenticated" : "anonymous"),
  });
  const practiceParams = new URLSearchParams();
  if (bank.chapter) practiceParams.set("chapter", bank.chapter);

  return (
    <PageShell>
      <BankNavigation />
      {!authReady || !isLoaded ? (
        <PagePanel>正在加载我的题单...</PagePanel>
      ) : !isSignedIn ? (
        <PagePanel className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">登录后查看收藏的题目和复习进度。</p>
          {authEnabled ? (
            <SignInButton mode="modal"><button type="button" className="action-primary">立即登录</button></SignInButton>
          ) : <span className="text-sm text-muted-foreground">暂时无法加载用户信息</span>}
        </PagePanel>
      ) : (
        <PagePanel className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" title="题单和复习进度仅对你生效。">收藏题目，复习薄弱项。</p>
            <Link href={`/practice?${practiceParams}`} className="action-primary gap-2"><Play className="size-4" />开始练习</Link>
          </div>
          <BankFilterControls chapter={bank.chapter} setChapter={bank.setChapter}
            sourceFilter={bank.sourceFilter} setSourceFilter={bank.setSourceFilter}
            typeFilter={bank.typeFilter} setTypeFilter={bank.setTypeFilter}
            loading={bank.loading} refresh={bank.refresh} />
          <BankStatsTiles totalCount={bank.filteredItems.length} pendingCount={bank.pendingCount}
            doneCount={bank.doneCount} weaknessCount={bank.weaknessCount} />
          {bank.error ? <p role="alert" className="text-sm text-warning">{bank.error}</p> : null}
          {bank.loading ? <p className="text-sm text-muted-foreground">正在加载题目...</p> : <BankItemList items={bank.filteredItems} markDone={bank.markDone} />}
        </PagePanel>
      )}
    </PageShell>
  );
}
