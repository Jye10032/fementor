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
  const { authEnabled, authReady, isLoaded, isSignedIn, viewer } = useAuthState();
  const [item, setItem] = useState<ExperienceDetailResponse["item"] | null>(null);
  const [loading, setLoading] = useState(false);
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
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">面经详情</h1>
        <Link href="/experience" className="action-secondary cursor-pointer text-sm">
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />返回
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
          {authEnabled ? (
            <SignInButton mode="modal">
              <button type="button" className="action-primary">立即登录</button>
            </SignInButton>
          ) : (
            <span className="text-sm text-muted-foreground">登录未启用</span>
          )}
        </PagePanel>
      ) : loading ? (
        <PagePanel>正在加载面经详情...</PagePanel>
      ) : error && !item ? (
        <PagePanel className="text-destructive">{error}</PagePanel>
      ) : item ? (
        <div className="space-y-3">
          {canManagePublicSources ? (
            <div className="space-y-2 rounded-xl border border-border/70 bg-secondary/40 px-4 py-2.5">
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
          {error ? <PagePanel className="text-destructive">{error}</PagePanel> : null}
          <ExperienceDetail item={item} />
        </div>
      ) : (
        <PagePanel>未找到该条面经。</PagePanel>
      )}
    </PageShell>
  );
}
