"use client";

import { useDeferredValue, useState } from "react";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../components/auth-provider";
import { PageHero, PagePanel, PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { ExperienceList } from "./_components/ExperienceList";
import { ExperienceSearchBar } from "./_components/ExperienceSearchBar";
import { ExperienceSyncStatus } from "./_components/ExperienceSyncStatus";
import { useExperienceList } from "./_hooks/use-experience-list";
import { useExperienceSync } from "./_hooks/use-experience-sync";

export default function ExperiencePage() {
  const { apiBase } = useRuntimeConfig();
  const { isLoaded, isSignedIn, viewer } = useAuthState();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const experienceList = useExperienceList({
    apiBase,
    enabled: isSignedIn,
    query: deferredQuery,
  });
  const experienceSync = useExperienceSync({
    apiBase,
    enabled: isSignedIn,
    onCompleted: () => {
      void experienceList.refresh();
    },
  });

  return (
    <PageShell>
      <PageHero
        eyebrow="Experience Library"
        title="把近期真实面经转成可检索、可联动、可训练的结构化题源"
        description="这里不是单纯的抓帖页。系统会抓取牛客近 7 日未入库面经，做结构化清洗，并把结果沉淀成面经库、问题簇和问题项，供后续搜索、练习和模拟面试使用。"
        aside={(
          <>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">当前用户</p>
              <p className="mt-3 text-lg font-semibold text-foreground">
                {isSignedIn ? viewer?.name || viewer?.email || "已登录用户" : "未登录"}
              </p>
            </article>
            <article className="panel-muted">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">本地面经数</p>
              <p className="mt-3 text-lg font-semibold text-foreground">{experienceList.total}</p>
            </article>
          </>
        )}
      />

      {!isLoaded ? (
        <PagePanel>正在同步登录态...</PagePanel>
      ) : !isSignedIn ? (
        <PagePanel className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-foreground">查看和同步面经前需要先登录。</p>
            <p className="mt-1 text-sm text-muted-foreground">面经同步任务和结构化结果会绑定到当前用户。</p>
          </div>
          <SignInButton mode="modal">
            <button type="button" className="action-primary">立即登录</button>
          </SignInButton>
        </PagePanel>
      ) : null}

      <ExperienceSearchBar
        keyword={experienceSync.keyword}
        onKeywordChange={experienceSync.setKeyword}
        syncing={experienceSync.syncing}
        onSync={() => void experienceSync.startSync()}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        disabled={!isSignedIn}
      />

      <ExperienceSyncStatus job={experienceSync.job} error={experienceSync.error} />

      <ExperienceList
        items={experienceList.items}
        loading={experienceList.loading}
        error={experienceList.error}
      />
    </PageShell>
  );
}
