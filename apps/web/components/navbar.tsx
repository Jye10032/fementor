"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck, GraduationCap, Home, Menu, MessageSquare, NotebookPen, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuthState } from "./auth-provider";
import { apiRequest } from "../lib/api";
import { AuthStatus } from "./auth-status";
import { RuntimeConfigPanel } from "./RuntimeConfigPanel";
import { useRuntimeConfig } from "./runtime-config";

const HEALTH_POLL_INTERVAL_MS = 30000;
const HEALTH_REQUEST_TIMEOUT_MS = 2000;

type HealthResponse = {
  ok: boolean;
  agent_runtime?: {
    available?: boolean;
  };
};

const NAV_ITEMS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/interview", label: "模拟面试", icon: MessageSquare },
  { href: "/bank", label: "题库", icon: BookOpenCheck },
  { href: "/resume", label: "我的资料", icon: NotebookPen },
] as const;

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
    || (href === "/bank" && (pathname === "/graph" || pathname === "/experience" || pathname.startsWith("/experience/")));

export function Navbar() {
  const pathname = usePathname();
  const { isSignedIn } = useAuthState();
  const [configOpen, setConfigOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);
  const [healthStatus, setHealthStatus] = useState<"checking" | "ok" | "error">("checking");
  const {
    apiBase,
    refreshSessionLlmConfig,
    runtimeMode,
    agentRuntimeId,
  } = useRuntimeConfig();

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      if (!cancelled) setHealthStatus("checking");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
      try {
        const result = await apiRequest<HealthResponse>(apiBase, "/health", { signal: controller.signal });
        if (!cancelled) {
          setHealthStatus(result.ok && result.agent_runtime?.available === true ? "ok" : "error");
        }
      } catch {
        if (!cancelled) {
          setHealthStatus("error");
        }
      } finally {
        window.clearTimeout(timeout);
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
    if (!isSignedIn || runtimeMode !== "local" || agentRuntimeId !== "native-api") return;
    void refreshSessionLlmConfig();
  }, [agentRuntimeId, apiBase, isSignedIn, refreshSessionLlmConfig, runtimeMode]);

  return (
    <header id="app-navbar" className="sticky top-0 z-50 overflow-x-clip border-b border-border/40 bg-background/60 backdrop-blur-2xl backdrop-saturate-150">
      <nav aria-label="主导航" className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary shadow-sm transition-all duration-300 group-hover:shadow-[0_0_20px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
            <GraduationCap className="h-4 w-4 text-primary-foreground transition-transform duration-300 group-hover:scale-110" />
          </div>
          <div>
            <span className="block text-base font-bold tracking-tight text-foreground">
              FE<span className="text-primary">Mentor</span>
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
              Frontend Interview Studio
            </span>
          </div>
        </Link>

        <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
          <div className="hidden text-[11px] font-medium text-muted-foreground xl:inline-flex">
            面试驱动训练闭环
          </div>
          <button
            type="button"
            aria-label={healthStatus === "ok" ? "面试服务状态正常" : healthStatus === "error" ? "面试服务状态异常" : "正在检查面试服务状态"}
            title={healthStatus === "ok" ? "面试服务状态正常" : healthStatus === "error" ? "面试服务状态异常" : "正在检查面试服务状态"}
            className="status-indicator h-8 w-8"
          >
            <span className={`status-indicator__dot status-indicator__dot--${healthStatus}`} />
          </button>
          {runtimeMode === "local" && agentRuntimeId === "native-api" ? <div className="relative" ref={configPanelRef}>
            <button
              type="button"
              onClick={() => setConfigOpen((previous) => !previous)}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-2.5 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur transition-all duration-200 hover:bg-secondary hover:text-foreground hover:shadow-md"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden md:inline">运行配置</span>
            </button>
            {configOpen ? (
              <div className="absolute right-0 top-[calc(100%+12px)] z-50 w-[min(92vw,420px)] rounded-2xl border border-border/70 bg-card/95 p-5 shadow-[var(--shadow-soft)] backdrop-blur">
                <RuntimeConfigPanel onSaved={() => setConfigOpen(false)} />
              </div>
            ) : null}
          </div> : null}
          <div className="hidden md:block">
            <div className="flex items-center gap-0.5">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className={
                    isActive(pathname, item.href)
                      ? "flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary transition-all duration-200"
                      : "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground"
                  }
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
          <button
            type="button"
            aria-label={mobileNavOpen ? "关闭导航菜单" : "打开导航菜单"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-primary-nav"
            onClick={() => setMobileNavOpen((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card/75 text-muted-foreground shadow-sm hover:bg-secondary hover:text-foreground md:hidden"
          >
            {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <AuthStatus />
        </div>

        {mobileNavOpen ? (
          <div id="mobile-primary-nav" className="absolute inset-x-3 top-[calc(100%-0.25rem)] z-50 rounded-2xl border border-border/70 bg-card/98 p-2 shadow-[var(--shadow-soft)] backdrop-blur md:hidden">
            <div className="grid gap-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                    isActive(pathname, item.href)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </nav>
    </header>
  );
}
