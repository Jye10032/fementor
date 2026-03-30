"use client";

import { useDeferredValue, useState } from "react";
import { BookOpen, Database, LogIn, User } from "lucide-react";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../components/auth-provider";
import { PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { ExperienceList } from "./_components/ExperienceList";
import { ExperienceSearchBar } from "./_components/ExperienceSearchBar";
import { ExperienceSyncStatus } from "./_components/ExperienceSyncStatus";
import { useExperienceList } from "./_hooks/use-experience-list";
import { useExperienceSync } from "./_hooks/use-experience-sync";

export default function ExperiencePage() {
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, authReady, isLoaded, isSignedIn, viewer } = useAuthState();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const experienceList = useExperienceList({
    apiBase,
    enabled: true,
    query: deferredQuery,
  });
  const experienceSync = useExperienceSync({
    apiBase,
    enabled: authReady && isSignedIn,
    onCompleted: () => {
      void experienceList.refresh();
    },
  });

  return (
    <PageShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">面经库</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              抓取牛客近 7 日面经，结构化清洗后供搜索、练习和模拟面试使用
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3.5 py-1.5 text-sm">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">{experienceList.total}</span>
            <span className="text-muted-foreground">条</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border/80 bg-background/80 px-3.5 py-1.5 text-sm">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-semibold text-foreground">
              {isSignedIn ? viewer?.name || viewer?.email || "已登录" : "未登录"}
            </span>
          </div>
        </div>
      </div>

      {!isLoaded ? (
        <p className="text-sm text-muted-foreground">正在同步登录态...</p>
      ) : !isSignedIn ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200/80 bg-amber-50/50 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <LogIn className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">未登录时可查看面经，登录管理员账号后才能同步最新内容。</p>
          </div>
          {authEnabled ? (
            <SignInButton mode="modal">
              <button type="button" className="cursor-pointer rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-amber-700">登录</button>
            </SignInButton>
          ) : (
            <span className="text-sm text-amber-800">登录未启用</span>
          )}
        </div>
      ) : null}

      <ExperienceSearchBar
        keyword={experienceSync.keyword}
        onKeywordChange={experienceSync.setKeyword}
        syncing={experienceSync.syncing}
        onSync={() => void experienceSync.startSync()}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        syncDisabled={!authReady || !isSignedIn}
        searchDisabled={false}
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
