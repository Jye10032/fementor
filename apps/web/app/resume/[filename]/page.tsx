"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageShell } from "../../../components/page-shell";
import { useRuntimeConfig } from "../../../components/runtime-config";
import { apiRequest } from "../../../lib/api";

type ResumeReadResponse = {
  user_id: string;
  name: string;
  content: string;
  summary: string;
  original_filename: string;
  updated_at: string;
};

export default function ResumeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { apiBase, userId } = useRuntimeConfig();
  const fileName = decodeURIComponent(String(params.filename ?? ""));

  const [doc, setDoc] = useState<ResumeReadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingDefault, setSettingDefault] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (!userId || !fileName) return;
    const load = async () => {
      setLoading(true);
      try {
        const [docData, libraryData] = await Promise.all([
          apiRequest<ResumeReadResponse>(
            apiBase,
            `/v1/resume/read?user_id=${encodeURIComponent(userId)}&file_name=${encodeURIComponent(fileName)}`
          ),
          apiRequest<{ profile: { active_resume_file: string } | null }>(
            apiBase,
            `/v1/resume/library?user_id=${encodeURIComponent(userId)}`
          ),
        ]);
        setDoc(docData);
        setIsDefault(libraryData.profile?.active_resume_file === fileName);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [apiBase, userId, fileName]);

  const onSetDefault = async () => {
    setSettingDefault(true);
    try {
      await apiRequest(apiBase, "/v1/resume/select", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, file_name: fileName }),
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
            <button
              onClick={() => router.back()}
              className="action-secondary py-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0">
              <h1 className="tool-heading truncate">{doc?.original_filename || fileName}</h1>
              {doc?.updated_at && (
                <p className="text-sm text-muted-foreground">更新于 {doc.updated_at}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDefault ? (
              <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-semibold text-primary">
                当前默认
              </span>
            ) : (
              <button
                onClick={onSetDefault}
                disabled={settingDefault}
                className="action-primary"
              >
                {settingDefault ? "设置中..." : "设为默认"}
              </button>
            )}
          </div>
        </header>

        {loading ? (
          <div className="tool-empty">加载中...</div>
        ) : error ? (
          <div className="tool-empty text-destructive">{error}</div>
        ) : doc ? (
          <div className="space-y-5">
            {doc.summary && (
              <section className="tool-section">
                <h2 className="tool-section-title">摘要</h2>
                <p className="text-sm leading-7 text-foreground">{doc.summary}</p>
              </section>
            )}
            <section className="tool-section">
              <h2 className="tool-section-title">简历全文</h2>
              <pre className="overflow-auto whitespace-pre-wrap break-words text-sm leading-7 text-foreground">
                {doc.content}
              </pre>
            </section>
          </div>
        ) : null}
      </div>
    </PageShell>
  );
}
