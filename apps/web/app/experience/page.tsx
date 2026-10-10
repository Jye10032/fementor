"use client";

import { Suspense, useDeferredValue } from "react";
import { useSearchParams } from "next/navigation";
import { useAuthState } from "../../components/auth-provider";
import { BankNavigation } from "../../components/bank-navigation";
import { PageShell } from "../../components/page-shell";
import { useRuntimeConfig } from "../../components/runtime-config";
import { ExperienceList } from "./_components/ExperienceList";
import { ExperienceSearchBar } from "./_components/ExperienceSearchBar";
import { ExperienceSyncStatus } from "./_components/ExperienceSyncStatus";
import { useExperienceList } from "./_hooks/use-experience-list";
import { useExperienceSync } from "./_hooks/use-experience-sync";

function ExperienceContent() {
  const { apiBase, runtimeMode } = useRuntimeConfig();
  const { authReady, isLoaded, isSignedIn, viewer, viewerLoading } = useAuthState();
  const canManage = viewer?.capabilities?.can_manage_public_sources === true;
  const canSync = authReady && isLoaded && isSignedIn && !viewerLoading && canManage;
  const params = useSearchParams();
  const company = params.get("company") || "";
  const role = params.get("role") || "";
  const query = params.get("query") || "";
  const deferredQuery = useDeferredValue(query);
  const updateFilters = (values: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    window.history.replaceState(null, "", next.size ? `/experience?${next}` : "/experience");
  };
  const experiences = useExperienceList({ apiBase, enabled: true, query: deferredQuery, company, role });
  const sync = useExperienceSync({
    apiBase, enabled: canSync, authRequired: runtimeMode !== "local",
    onCompleted: () => { void experiences.refresh(); void experiences.refreshFilters(); },
  });

  return (
    <>
      <ExperienceSearchBar company={company} role={role} filters={experiences.filters}
        filtersLoading={experiences.filtersLoading} filtersError={experiences.filtersError}
        onRetryFilters={() => void experiences.refreshFilters()}
        onCompanyChange={(value) => updateFilters({ company: value })}
        onRoleChange={(value) => updateFilters({ role: value })}
        onClear={() => updateFilters({ company: "", role: "", query: "" })}
        searchQuery={query} onSearchQueryChange={(value) => updateFilters({ query: value })}
        keyword={sync.keyword} onKeywordChange={sync.setKeyword} limit={sync.limit} onLimitChange={sync.setLimit}
        syncing={sync.syncing} onSync={() => void sync.startSync()} syncAllowed={canSync} />
      {canManage ? <ExperienceSyncStatus job={sync.job} error={sync.error} /> : null}
      <div className="flex items-center justify-between text-sm text-muted-foreground" aria-live="polite">
        <p>{experiences.loading ? "正在加载面经..." : experiences.error ? "面经加载失败" : `共 ${experiences.total} 篇面经`}</p>
        {experiences.error ? <button type="button" onClick={() => void experiences.refresh()} className="text-primary hover:underline">重试</button> : null}
      </div>
      <ExperienceList key={JSON.stringify([company, role, deferredQuery])}
        items={experiences.items} loading={experiences.loading} error={experiences.error}
        filtered={Boolean(company || role || query)} listQuery={params.toString()}
        onDelete={canManage ? experiences.deleteItem : undefined}
        onDeleteBatch={canManage ? experiences.deleteItems : undefined} />
      {!experiences.loading && experiences.items.length < experiences.total ? (
        <div className="flex flex-col items-center gap-2">
          {experiences.loadMoreError ? <p role="alert" className="text-sm text-warning">{experiences.loadMoreError}</p> : null}
          <button type="button" className="action-secondary" disabled={experiences.loadingMore} onClick={() => void experiences.loadMore()}>
            {experiences.loadingMore ? "正在加载..." : experiences.loadMoreError ? "重试加载更多" : `加载更多（${experiences.items.length} / ${experiences.total}）`}
          </button>
        </div>
      ) : null}
    </>
  );
}

export default function ExperiencePage() {
  return (
    <PageShell>
      <BankNavigation />
      <Suspense fallback={<p className="text-sm text-muted-foreground">正在加载面经...</p>}><ExperienceContent /></Suspense>
    </PageShell>
  );
}
