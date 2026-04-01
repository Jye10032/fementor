"use client";

import { useAuthState } from "./auth-provider";
import { useRuntimeConfig } from "./runtime-config";

type RuntimeConfigPanelProps = {
  onSaved?: () => void;
};

export function RuntimeConfigPanel({ onSaved }: RuntimeConfigPanelProps) {
  const { viewer, isSignedIn } = useAuthState();
  const {
    apiBase,
    setApiBase,
    llmBaseUrl,
    setLlmBaseUrl,
    llmApiKey,
    setLlmApiKey,
    llmModel,
    setLlmModel,
    llmSyncing,
    llmSyncState,
    llmSyncStatus,
    syncLlmConfig,
    clearSessionLlmConfig,
    sessionLlmConfigured,
    sessionLlmMaskedKey,
    sessionLlmExpiresAt,
  } = useRuntimeConfig();

  const remainingInterviewCount = viewer?.capabilities?.remaining_interview_session_count;
  const dailyInterviewLimit = viewer?.capabilities?.daily_interview_session_limit;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">运行配置</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            API Base 保存在当前浏览器；用户 LLM Key 只保存在服务端当前会话，不写浏览器本地存储。
          </p>
        </div>
        <span className="rounded-full border border-border/70 bg-secondary/70 px-3 py-1 text-[11px] text-muted-foreground">
          会话级 Key
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">API Base</span>
          <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} className="field-shell w-full" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">LLM Base URL</span>
          <input value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} className="field-shell w-full" placeholder="https://api.openai.com/v1" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">LLM Model</span>
          <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className="field-shell w-full" placeholder="gpt-4o-mini" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">当前会话 LLM API Key</span>
          <input value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} className="field-shell w-full" type="password" placeholder="sk-..." />
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-border/70 bg-background/80 p-4 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-medium ${
            sessionLlmConfigured ? "bg-[color:color-mix(in_oklab,var(--success)_14%,transparent)] text-[color:var(--success)]" : "bg-secondary text-muted-foreground"
          }`}
          >
            {sessionLlmConfigured ? `已配置 ${sessionLlmMaskedKey || ""}` : "当前会话未配置"}
          </span>
          {isSignedIn && dailyInterviewLimit != null && remainingInterviewCount != null ? (
            <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-1 font-medium text-muted-foreground">
              免费模拟面试 {remainingInterviewCount}/{dailyInterviewLimit}
            </span>
          ) : null}
        </div>
        {sessionLlmExpiresAt ? (
          <p className="mt-2">过期时间：{new Date(sessionLlmExpiresAt).toLocaleString()}</p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <p className={`text-xs leading-5 ${
          llmSyncState === "ready"
            ? "text-[color:var(--success)]"
            : llmSyncState === "warning"
              ? "text-amber-600"
              : llmSyncState === "error"
                ? "text-[color:var(--destructive)]"
                : "text-muted-foreground"
        }`}
        >
          {llmSyncStatus}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void syncLlmConfig().then(() => {
                onSaved?.();
              }).catch(() => {});
            }}
            disabled={llmSyncing || !isSignedIn}
            className="action-primary shrink-0"
          >
            {llmSyncing ? "处理中..." : "保存并验证"}
          </button>
          <button
            type="button"
            onClick={() => {
              void clearSessionLlmConfig().then(() => {
                onSaved?.();
              }).catch(() => {});
            }}
            disabled={llmSyncing || !sessionLlmConfigured}
            className="action-secondary shrink-0"
          >
            清除当前会话 Key
          </button>
        </div>
      </div>
    </div>
  );
}
