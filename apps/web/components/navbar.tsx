"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, Home, LibraryBig, MessageSquare, Network, NotebookPen, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuthState } from "./auth-provider";
import { apiRequest } from "../lib/api";
import { AuthStatus } from "./auth-status";
import { RuntimeConfigPanel } from "./RuntimeConfigPanel";
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
  { href: "/graph", label: "知识图谱", icon: Network },
] as const;

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function Navbar() {
  const pathname = usePathname();
  const { isSignedIn } = useAuthState();
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
    refreshSessionLlmConfig,
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

  useEffect(() => {
    if (!isSignedIn) return;
    void refreshSessionLlmConfig();
  }, [apiBase, isSignedIn, refreshSessionLlmConfig]);

  return (
    <header id="app-navbar" className="sticky top-0 z-50 border-b border-border/40 bg-background/60 backdrop-blur-2xl backdrop-saturate-150">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary shadow-sm transition-all duration-300 group-hover:shadow-[0_0_20px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
            <GraduationCap className="h-5 w-5 text-primary-foreground transition-transform duration-300 group-hover:scale-110" />
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

        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden rounded-full border border-border/70 bg-card/75 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground lg:inline-flex">
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
              className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/60 px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur transition-all duration-200 hover:bg-secondary hover:text-foreground hover:shadow-md"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden md:inline">运行配置</span>
            </button>
            {configOpen ? (
              <div className="absolute right-0 top-[calc(100%+12px)] z-50 w-[min(92vw,420px)] rounded-2xl border border-border/70 bg-card/95 p-5 shadow-[var(--shadow-soft)] backdrop-blur">
                <RuntimeConfigPanel onSaved={() => setConfigOpen(false)} />
              </div>
            ) : null}
          </div>
          <div className="rounded-xl border border-border/70 bg-card/60 p-1 shadow-sm backdrop-blur">
            <div className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    isActive(pathname, item.href)
                      ? "flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200"
                      : "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground"
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
          <AuthStatus />
        </div>
      </nav>
    </header>
  );
}
