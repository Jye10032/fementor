"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";
import { useAuthState } from "../../../components/auth-provider";
import { PageShell } from "../../../components/page-shell";
import { useRuntimeConfig } from "../../../components/runtime-config";
import { apiRequest } from "../../../lib/api";
import { ExperienceDetail } from "../_components/ExperienceDetail";
import { ExperienceDetailResponse, ExperienceRecleanResponse } from "../_lib/experience.types";

function ExperienceDetailContent() {
  const params = useParams<{ id: string }>();
  const { apiBase } = useRuntimeConfig();
  const { authReady, isSignedIn, viewer } = useAuthState();
  const searchParams = useSearchParams();
  const returnParams = new URLSearchParams();
  for (const key of ["company", "role", "query"]) {
    const value = searchParams.get(key);
    if (value) returnParams.set(key, value);
  }
  const returnHref = returnParams.size ? `/experience?${returnParams}` : "/experience";
  const [item, setItem] = useState<ExperienceDetailResponse["item"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recleaning, setRecleaning] = useState(false);
  const canManagePublicSources = viewer?.capabilities?.can_manage_public_sources === true;

  useEffect(() => {
    if (!params?.id) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await apiRequest<ExperienceDetailResponse>(apiBase, `/v1/experiences/${params.id}`, {
          auth: "optional",
        });
        if (!cancelled) {
          setItem(response.item);
          setNotice(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "加载详情失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiBase, params?.id]);

  const handleReclean = async () => {
    if (!params?.id || !authReady || !isSignedIn || !canManagePublicSources) {
      return;
    }

    try {
      setRecleaning(true);
      setError(null);
      setNotice(null);
      const response = await apiRequest<ExperienceRecleanResponse>(apiBase, `/v1/experiences/${params.id}/reclean`, {
        method: "POST",
        auth: "required",
      });
      setItem(response.item);
      setNotice(`重新清洗完成，共抽取 ${response.item.groups.length} 个问题簇。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重清洗失败");
    } finally {
      setRecleaning(false);
    }
  };

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
        <nav aria-label="面包屑" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/bank" className="hover:text-primary">题库</Link><span>/</span>
          <Link href={returnHref} className="hover:text-primary">面经</Link><span>/</span><span>详情</span>
        </nav>
        <Link href={returnHref} className="action-secondary cursor-pointer rounded-md px-3 py-2 text-sm">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />返回面经
        </Link>
      </div>

      {loading ? (
        <div className="border-y border-border/70 py-4 text-sm text-muted-foreground">正在加载面经详情...</div>
      ) : error && !item ? (
        <div className="border-l-2 border-destructive/60 py-3 pl-3 text-sm text-destructive">{error}</div>
      ) : item ? (
        <div className="space-y-3">
          {canManagePublicSources ? (
            <div className="space-y-2 border-y border-border/70 bg-secondary/30 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  抽取结果有误？可重新清洗
                </p>
                <button
                  type="button"
                  onClick={() => void handleReclean()}
                  disabled={!authReady || !isSignedIn || recleaning}
                  className="action-primary text-sm"
                >
                  {recleaning ? "重清洗中..." : "重新清洗"}
                </button>
              </div>
              {notice ? <p className="text-sm text-success">{notice}</p> : null}
            </div>
          ) : null}
          {error ? <div className="border-l-2 border-destructive/60 py-3 pl-3 text-sm text-destructive">{error}</div> : null}
          <ExperienceDetail item={item} />
        </div>
      ) : (
        <div className="border-y border-border/70 py-4 text-sm text-muted-foreground">未找到该条面经。</div>
      )}
    </PageShell>
  );
}

export default function ExperienceDetailPage() {
  return <Suspense fallback={<PageShell>正在加载面经详情...</PageShell>}><ExperienceDetailContent /></Suspense>;
}
