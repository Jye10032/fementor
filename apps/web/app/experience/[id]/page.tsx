"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../../components/auth-provider";
import { PagePanel, PageShell } from "../../../components/page-shell";
import { useRuntimeConfig } from "../../../components/runtime-config";
import { apiRequest } from "../../../lib/api";
import { ExperienceDetail } from "../_components/ExperienceDetail";
import { ExperienceDetailResponse, ExperienceRecleanResponse } from "../_lib/experience.types";

export default function ExperienceDetailPage() {
  const params = useParams<{ id: string }>();
  const { apiBase } = useRuntimeConfig();
  const { authReady, isLoaded, isSignedIn, viewer } = useAuthState();
  const [item, setItem] = useState<ExperienceDetailResponse["item"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const response = await apiRequest<ExperienceRecleanResponse>(apiBase, `/v1/experiences/${params.id}/reclean`, {
        method: "POST",
        auth: "required",
      });
      setItem(response.item);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重清洗失败");
    } finally {
      setRecleaning(false);
    }
  };

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">面经详情</h1>
        </div>
        <Link href="/experience" className="action-secondary cursor-pointer">
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          返回面经库
        </Link>
      </div>

      {!isLoaded ? (
        <PagePanel>正在同步登录态...</PagePanel>
      ) : !isSignedIn && !item ? (
        <PagePanel className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-foreground">查看详情前可以先直接浏览，登录管理员账号后可执行重清洗。</p>
            <p className="mt-1 text-sm text-muted-foreground">当前页面支持公开查看；只有管理员可以重清洗并纠正题组。</p>
          </div>
          <SignInButton mode="modal">
            <button type="button" className="action-primary">立即登录</button>
          </SignInButton>
        </PagePanel>
      ) : loading ? (
        <PagePanel>正在加载面经详情...</PagePanel>
      ) : error ? (
        <PagePanel className="text-[oklch(0.53_0.19_25)]">{error}</PagePanel>
      ) : item ? (
        <div className="space-y-4">
          {canManagePublicSources ? (
            <PagePanel className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">管理员操作</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">如果当前题组分类不正确，可以对这条面经重新清洗。</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleReclean()}
                disabled={!authReady || !isSignedIn || recleaning}
                className="action-primary"
              >
                {recleaning ? "重清洗中..." : "重新清洗这条面经"}
              </button>
            </PagePanel>
          ) : null}
          <ExperienceDetail item={item} />
        </div>
      ) : (
        <PagePanel>未找到该条面经。</PagePanel>
      )}
    </PageShell>
  );
}
