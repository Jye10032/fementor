"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Home, LibraryBig, MessageSquare, NotebookPen, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../lib/api";
import { AuthStatus } from "./auth-status";
import { useRuntimeConfig } from "./runtime-config";

const HEALTH_POLL_INTERVAL_MS = 30000;

type HealthResponse = {
  ok: boolean;
};

const NAV_ITEMS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/resume", label: "档案管理", icon: NotebookPen },
  { href: "/interview", label: "模拟面试", icon: MessageSquare },
  { href: "/experience", label: "面经库", icon: LibraryBig },
] as const;

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function Navbar() {
  const pathname = usePathname();
  const [configOpen, setConfigOpen] = useState(false);
  const configPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!configOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (configPanelRef.current && !configPanelRef.current.contains(e.target as Node)) {
        setConfigOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [configOpen]);
  const [healthStatus, setHealthStatus] = useState<"checking" | "ok" | "error">("checking");
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
    llmSyncStatus,
    syncLlmConfig,
  } = useRuntimeConfig();

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      if (!cancelled) setHealthStatus("checking");
      try {
        const result = await apiRequest<HealthResponse>(apiBase, "/health");
        if (!cancelled) {
          setHealthStatus(result.ok ? "ok" : "error");
        }
      } catch {
        if (!cancelled) {
          setHealthStatus("error");
        }
      }
    };

    void checkHealth();
    const timer = window.setInterval(() => {
      void checkHealth();
    }, HEALTH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [apiBase]);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/72 backdrop-blur-2xl">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary shadow-sm">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <span className="block text-lg font-bold tracking-tight text-foreground">
              FE<span className="text-primary">Mentor</span>
            </span>
            <span className="hidden text-[11px] uppercase tracking-[0.22em] text-muted-foreground sm:block">
              Frontend Interview Studio
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-full border border-border/80 bg-card/75 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground lg:inline-flex">
            面试驱动训练闭环
          </div>
          <button
            type="button"
            aria-label={healthStatus === "ok" ? "系统状态正常" : healthStatus === "error" ? "系统状态异常" : "正在检查系统状态"}
            title={healthStatus === "ok" ? "系统状态正常" : healthStatus === "error" ? "系统状态异常" : "正在检查系统状态"}
            className="status-indicator"
          >
            <span className={`status-indicator__dot status-indicator__dot--${healthStatus}`} />
          </button>
          <div className="relative" ref={configPanelRef}>
            <button
              type="button"
              onClick={() => setConfigOpen((previous) => !previous)}
              className="flex items-center gap-2 rounded-2xl border border-border/80 bg-card/75 px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm hover:bg-secondary hover:text-foreground"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden md:inline">运行配置</span>
            </button>
            {configOpen ? (
              <div className="absolute right-0 top-[calc(100%+12px)] z-50 w-[min(92vw,420px)] rounded-[1.6rem] border border-border/80 bg-card/95 p-5 shadow-[var(--shadow-soft)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">运行配置</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">这里可以设置 API Base，以及运行时 LLM 的 Base URL / API Key。</p>
                </div>
                <span className="rounded-full border border-border/70 bg-secondary/70 px-3 py-1 text-[11px] text-muted-foreground">
                  浏览器本地存储
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
                  <span className="mb-1 block text-muted-foreground">LLM API Key</span>
                  <input value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} className="field-shell w-full" type="password" placeholder="sk-..." />
                </label>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-xs leading-5 ${llmSyncStatus.startsWith("✓") ? "text-emerald-600" : llmSyncStatus.startsWith("⚠") ? "text-amber-600" : "text-muted-foreground"}`}>{llmSyncStatus}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void syncLlmConfig().then(() => {
                        setConfigOpen(false);
                      }).catch(() => {});
                    }}
                    disabled={llmSyncing}
                    className="action-primary shrink-0"
                  >
                    {llmSyncing ? "检测中..." : "保存并检测"}
                  </button>
                </div>
              </div>
              </div>
            ) : null}
          </div>
          <AuthStatus />
          <div className="rounded-[1.25rem] border border-border/80 bg-card/75 p-1 shadow-sm">
            <div className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    isActive(pathname, item.href)
                      ? "flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm"
                      : "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
