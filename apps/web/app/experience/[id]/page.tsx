"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../../components/auth-provider";
import { PagePanel, PageShell } from "../../../components/page-shell";
import { useRuntimeConfig } from "../../../components/runtime-config";
import { apiRequest } from "../../../lib/api";
import { ExperienceDetail } from "../_components/ExperienceDetail";
import { ExperienceDetailResponse } from "../_lib/experience.types";

export default function ExperienceDetailPage() {
  const params = useParams<{ id: string }>();
  const { apiBase } = useRuntimeConfig();
  const { isLoaded, isSignedIn } = useAuthState();
  const [item, setItem] = useState<ExperienceDetailResponse["item"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !params?.id) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await apiRequest<ExperienceDetailResponse>(apiBase, `/v1/experiences/${params.id}`, {
          auth: "required",
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
  }, [apiBase, isSignedIn, params?.id]);

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="page-hero__eyebrow">Experience Detail</p>
          <h1 className="mt-3 text-4xl font-semibold text-foreground">面经详情</h1>
        </div>
        <Link href="/experience" className="action-secondary">
          返回面经库
        </Link>
      </div>

      {!isLoaded ? (
        <PagePanel>正在同步登录态...</PagePanel>
      ) : !isSignedIn ? (
        <PagePanel className="flex items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-foreground">查看详情前需要先登录。</p>
            <p className="mt-1 text-sm text-muted-foreground">面经详情包含原文与结构化结果，只对当前登录用户开放。</p>
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
        <ExperienceDetail item={item} />
      ) : (
        <PagePanel>未找到该条面经。</PagePanel>
      )}
    </PageShell>
  );
}
