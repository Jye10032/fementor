"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SignInButton } from "@clerk/nextjs";
import { useAuthState } from "../../../../components/auth-provider";
import { PageShell } from "../../../../components/page-shell";
import { useRuntimeConfig } from "../../../../components/runtime-config";
import { apiRequest } from "../../../../lib/api";

type JdReadResponse = {
  user_id?: string;
  name: string;
  content: string;
};

export default function JdDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { apiBase } = useRuntimeConfig();
  const { authEnabled, isLoaded, isSignedIn } = useAuthState();
  const fileName = decodeURIComponent(String(params.filename ?? ""));

  const [doc, setDoc] = useState<JdReadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingDefault, setSettingDefault] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (!isSignedIn || !fileName) return;
    const load = async () => {
      setLoading(true);
      try {
        const [docData, libraryData] = await Promise.all([
          apiRequest<JdReadResponse>(
            apiBase,
            `/v1/jd/read?file_name=${encodeURIComponent(fileName)}`,
            { auth: "required" },
          ),
          apiRequest<{ profile: { active_jd_file: string } | null }>(
            apiBase,
            "/v1/jd/library",
            { auth: "required" },
          ),
        ]);
        setDoc(docData);
        setIsDefault(libraryData.profile?.active_jd_file === fileName);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [apiBase, fileName, isSignedIn]);

  const onSetDefault = async () => {
    setSettingDefault(true);
    try {
      await apiRequest(apiBase, "/v1/jd/select", {
        method: "POST",
        body: JSON.stringify({ file_name: fileName }),
        auth: "required",
      });
      setIsDefault(true);
    } catch {
      // ignore
    } finally {
      setSettingDefault(false);
    }
  };

  return (
    <PageShell>
      <div className="tool-page">
        <header className="tool-header">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="action-secondary py-2">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="tool-heading truncate">{doc?.name || fileName}</h1>
              <p className="text-sm text-muted-foreground">查看 JD 全文与默认状态</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDefault ? (
              <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
                当前默认
              </span>
            ) : (
              <button onClick={onSetDefault} disabled={settingDefault} className="action-primary">
                {settingDefault ? "设置中..." : "设为默认"}
              </button>
            )}
          </div>
        </header>

        {!isLoaded ? (
          <div className="tool-empty">正在同步登录态...</div>
        ) : !isSignedIn ? (
          <div className="tool-section flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">查看 JD 详情前需要先登录。</p>
              <p className="mt-1 text-xs text-muted-foreground">该页面会读取你当前账户下保存的 JD 内容和默认 JD 状态。</p>
            </div>
            {authEnabled ? (
              <SignInButton mode="modal">
                <button type="button" className="action-primary">立即登录</button>
              </SignInButton>
            ) : (
              <span className="text-sm text-muted-foreground">登录未启用</span>
            )}
          </div>
        ) : loading ? (
          <div className="tool-empty">加载中...</div>
        ) : error ? (
          <div className="tool-empty text-destructive">{error}</div>
        ) : doc ? (
          <section className="tool-section">
            <h2 className="tool-section-title">JD 全文</h2>
            <pre className="overflow-auto whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
              {doc.content}
            </pre>
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}
