"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiRequest } from "../lib/api";

type RuntimeConfigContextValue = {
  apiBase: string;
  setApiBase: (value: string) => void;
  runtimeMode: string;
  agentRuntimeId: string;
  agentRuntimeAvailable: boolean | null;
  agentRuntimeState: string;
  agentRuntimeErrorCode: string | null;
  refreshRuntimeHealth: (baseUrl?: string) => Promise<void>;
  publicSourceDriver: string;
  publicSourceStorageTarget: string;
  llmBaseUrl: string;
  setLlmBaseUrl: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  llmSyncing: boolean;
  llmSyncState: "idle" | "syncing" | "ready" | "warning" | "error";
  llmSyncStatus: string;
  syncLlmConfig: () => Promise<void>;
  clearSessionLlmConfig: () => Promise<void>;
  refreshSessionLlmConfig: () => Promise<void>;
  sessionLlmConfigured: boolean;
  sessionLlmMaskedKey: string | null;
  sessionLlmExpiresAt: string | null;
};

const DEFAULT_LOCAL_API_BASE = "http://localhost:3300";
const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_BASE || (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" ? "/api/proxy" : DEFAULT_LOCAL_API_BASE);
const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const HEALTH_REQUEST_TIMEOUT_MS = 2000;

type HealthResponse = {
  ok?: boolean;
  runtime?: {
    mode?: string;
    public_source_driver?: string;
    public_source_storage_target?: string;
  };
  agent_runtime?: {
    selected_runtime?: string;
    available?: boolean;
    state?: string;
    error_code?: string;
  };
  llm?: {
    base_url?: string;
    model?: string;
    has_api_key?: boolean;
  };
};

type SessionLlmConfigPayload = {
  base_url?: string;
  model?: string;
  has_api_key?: boolean;
  masked_api_key?: string | null;
  expires_at?: string | null;
};

type SessionLlmConfigResponse = {
  configured?: boolean;
  config?: SessionLlmConfigPayload;
};

const RuntimeConfigContext = createContext<RuntimeConfigContextValue | null>(null);

function normalizeBaseUrl(value: string | null | undefined) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isHostedBrowser() {
  if (typeof window === "undefined") return false;
  return window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
}

async function fetchHealth(baseUrl: string): Promise<HealthResponse> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error("health_base_missing");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${normalizedBaseUrl}/health`, { signal: controller.signal });
    if (!response.ok) throw new Error(`health_http_${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) throw new Error("health_invalid_response");
    const data = (await response.json()) as HealthResponse;
    if (data.ok !== true) throw new Error("health_not_ready");
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function probeHealth(baseUrl: string) {
  try {
    const data = await fetchHealth(baseUrl);
    return data.ok === true;
  } catch {
    return false;
  }
}

function getBootstrapApiCandidates() {
  if (typeof window === "undefined") {
    return [normalizeBaseUrl(DEFAULT_API_BASE)].filter(Boolean);
  }

  const savedApi = isHostedBrowser()
    ? ""
    : normalizeBaseUrl(window.localStorage.getItem("fementor.apiBase"));
  const envApi = normalizeBaseUrl(DEFAULT_API_BASE);

  return [savedApi, envApi]
    .map((candidate) => normalizeBaseUrl(candidate))
    .filter((candidate, index, items) => Boolean(candidate) && items.indexOf(candidate) === index);
}

type ProviderProps = {
  children: ReactNode;
};

export function RuntimeConfigProvider({ children }: ProviderProps) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [runtimeMode, setRuntimeMode] = useState("unknown");
  const [agentRuntimeId, setAgentRuntimeId] = useState("unknown");
  const [agentRuntimeAvailable, setAgentRuntimeAvailable] = useState<boolean | null>(null);
  const [agentRuntimeState, setAgentRuntimeState] = useState("checking");
  const [agentRuntimeErrorCode, setAgentRuntimeErrorCode] = useState<string | null>(null);
  const [publicSourceDriver, setPublicSourceDriver] = useState("sqlite");
  const [publicSourceStorageTarget, setPublicSourceStorageTarget] = useState("local_sqlite");
  const [llmBaseUrl, setLlmBaseUrl] = useState(DEFAULT_LLM_BASE_URL);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM_MODEL);
  const [llmSyncing, setLlmSyncing] = useState(false);
  const [llmSyncState, setLlmSyncState] = useState<RuntimeConfigContextValue["llmSyncState"]>("idle");
  const [llmSyncStatus, setLlmSyncStatus] = useState("尚未同步 LLM 配置。");
  const [sessionLlmConfigured, setSessionLlmConfigured] = useState(false);
  const [sessionLlmMaskedKey, setSessionLlmMaskedKey] = useState<string | null>(null);
  const [sessionLlmExpiresAt, setSessionLlmExpiresAt] = useState<string | null>(null);
  const [backendLlmReady, setBackendLlmReady] = useState(false);
  const [runtimeHealthInitialized, setRuntimeHealthInitialized] = useState(false);
  const initializedRef = useRef(false);
  const healthRequestIdRef = useRef(0);
  const sessionLlmConfiguredRef = useRef(sessionLlmConfigured);
  sessionLlmConfiguredRef.current = sessionLlmConfigured;

  const applyHealthState = useCallback((data: HealthResponse) => {
    const nextRuntimeMode = String(data.runtime?.mode || "").trim();
    const nextAgentRuntimeId = String(data.agent_runtime?.selected_runtime || "").trim();
    const nextAgentRuntimeState = String(data.agent_runtime?.state || "unknown").trim();
    const nextAgentRuntimeErrorCode = String(data.agent_runtime?.error_code || "").trim();

    if (nextRuntimeMode) setRuntimeMode(nextRuntimeMode);
    if (nextAgentRuntimeId) setAgentRuntimeId(nextAgentRuntimeId);
    setAgentRuntimeAvailable(data.agent_runtime?.available === true);
    setAgentRuntimeState(nextAgentRuntimeState);
    setAgentRuntimeErrorCode(nextAgentRuntimeErrorCode || null);

    const nextPublicSourceDriver = String(data.runtime?.public_source_driver || "").trim();
    const nextPublicSourceStorageTarget = String(data.runtime?.public_source_storage_target || "").trim();
    if (nextPublicSourceDriver) setPublicSourceDriver(nextPublicSourceDriver);
    if (nextPublicSourceStorageTarget) setPublicSourceStorageTarget(nextPublicSourceStorageTarget);

    return {
      backendBaseUrl: String(data.llm?.base_url || "").trim(),
      backendModel: String(data.llm?.model || "").trim(),
      hasBackendKey: data.llm?.has_api_key === true,
    };
  }, []);

  const applyBackendLlmHealth = useCallback((hasBackendKey: boolean) => {
    setBackendLlmReady(hasBackendKey);
    if (hasBackendKey) {
      setLlmSyncState("ready");
      setLlmSyncStatus("服务端默认 LLM 已就绪。");
    } else if (!sessionLlmConfiguredRef.current) {
      setLlmSyncState("idle");
      setLlmSyncStatus("服务端默认 LLM 尚未配置。");
    }
  }, []);

  const refreshRuntimeHealth = useCallback(async (baseUrl?: string) => {
    const targetBaseUrl = normalizeBaseUrl(baseUrl || apiBase);
    const requestId = healthRequestIdRef.current + 1;
    healthRequestIdRef.current = requestId;

    setAgentRuntimeAvailable(null);
    setAgentRuntimeState("checking");
    setAgentRuntimeErrorCode(null);

    try {
      const data = await fetchHealth(targetBaseUrl);
      if (requestId !== healthRequestIdRef.current) return;
      const { hasBackendKey } = applyHealthState(data);
      applyBackendLlmHealth(hasBackendKey);
    } catch {
      if (requestId !== healthRequestIdRef.current) return;
      setAgentRuntimeAvailable(false);
      setAgentRuntimeState("unavailable");
      setAgentRuntimeErrorCode("health_unreachable");
      applyBackendLlmHealth(false);
    }
  }, [apiBase, applyBackendLlmHealth, applyHealthState]);

  const applySessionConfigState = useCallback((payload?: SessionLlmConfigResponse | null) => {
    const config = payload?.config;
    const configured = payload?.configured === true && config?.has_api_key === true;

    setSessionLlmConfigured(configured);
    setSessionLlmMaskedKey(config?.masked_api_key || null);
    setSessionLlmExpiresAt(config?.expires_at || null);

    if (config?.base_url) {
      setLlmBaseUrl(config.base_url);
    }
    if (config?.model) {
      setLlmModel(config.model);
    }

    if (configured) {
      setLlmSyncState("ready");
      setLlmSyncStatus("当前会话已配置用户 LLM Key。");
      return;
    }

    if (backendLlmReady) {
      setLlmSyncState("ready");
      setLlmSyncStatus("服务端默认 LLM 已就绪。");
      return;
    }

    setLlmSyncState("idle");
    setLlmSyncStatus("当前会话未配置用户 LLM Key。");
  }, [backendLlmReady]);

  useEffect(() => {
    const allowBrowserOverrides = !isHostedBrowser();
    let cancelled = false;
    const savedApi = (allowBrowserOverrides
      ? normalizeBaseUrl(window.localStorage.getItem("fementor.apiBase"))
      : "") || normalizeBaseUrl(DEFAULT_API_BASE);
    const savedLlmBaseUrl = allowBrowserOverrides
      ? window.localStorage.getItem("fementor.llmBaseUrl")
      : null;
    const savedLlmModel = allowBrowserOverrides
      ? window.localStorage.getItem("fementor.llmModel")
      : null;

    setApiBase(savedApi);
    if (savedLlmBaseUrl) setLlmBaseUrl(savedLlmBaseUrl);
    if (savedLlmModel) setLlmModel(savedLlmModel);

    void (async () => {
      let resolvedApiBase = savedApi;

      try {
        const candidates = getBootstrapApiCandidates();

        for (const candidate of candidates) {
          if (await probeHealth(candidate)) {
            resolvedApiBase = candidate;
            break;
          }
        }

        if (cancelled) return;
        if (resolvedApiBase !== savedApi) {
          setApiBase(resolvedApiBase);
        }

        const data = await fetchHealth(resolvedApiBase);
        if (cancelled) return;
        const { backendBaseUrl, backendModel, hasBackendKey } = applyHealthState(data);

        if (!savedLlmBaseUrl && backendBaseUrl) {
          setLlmBaseUrl(backendBaseUrl);
        }
        if (!savedLlmModel && backendModel) {
          setLlmModel(backendModel);
        }
        applyBackendLlmHealth(hasBackendKey);
      } catch {
        if (cancelled) return;
        setAgentRuntimeAvailable(false);
        setAgentRuntimeState("unavailable");
        setAgentRuntimeErrorCode("health_unreachable");
      } finally {
        if (!cancelled) {
          initializedRef.current = true;
          setRuntimeHealthInitialized(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyBackendLlmHealth, applyHealthState]);

  useEffect(() => {
    if (!runtimeHealthInitialized) return;
    const initialRefresh = window.setTimeout(() => {
      void refreshRuntimeHealth();
    }, 350);
    const timer = window.setInterval(() => {
      void refreshRuntimeHealth();
    }, 30000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
    };
  }, [apiBase, refreshRuntimeHealth, runtimeHealthInitialized]);

  useEffect(() => {
    if (!initializedRef.current || isHostedBrowser()) return;
    window.localStorage.setItem("fementor.apiBase", normalizeBaseUrl(apiBase));
  }, [apiBase]);

  useEffect(() => {
    if (!initializedRef.current || isHostedBrowser()) return;
    window.localStorage.setItem("fementor.llmBaseUrl", llmBaseUrl);
  }, [llmBaseUrl]);

  useEffect(() => {
    if (!initializedRef.current || isHostedBrowser()) return;
    window.localStorage.setItem("fementor.llmModel", llmModel);
  }, [llmModel]);

  const refreshSessionLlmConfig = useCallback(async () => {
    try {
      const data = await apiRequest<SessionLlmConfigResponse>(apiBase, "/v1/runtime/session-llm-config", {
        auth: "required",
      });
      applySessionConfigState(data);
    } catch {
      applySessionConfigState(null);
    }
  }, [apiBase, applySessionConfigState]);

  const syncLlmConfig = useCallback(async () => {
    try {
      setLlmSyncing(true);
      setLlmSyncState("syncing");
      setLlmSyncStatus("正在保存当前会话 LLM Key...");

      await apiRequest<SessionLlmConfigResponse>(apiBase, "/v1/runtime/session-llm-config", {
        method: "PUT",
        body: JSON.stringify({
          base_url: llmBaseUrl,
          api_key: llmApiKey,
          model: llmModel,
        }),
        auth: "required",
      });

      setLlmSyncStatus("正在校验当前会话 LLM Key...");
      const validated = await apiRequest<SessionLlmConfigResponse & { valid?: boolean }>(
        apiBase,
        "/v1/runtime/session-llm-config/validate",
        {
          method: "POST",
          body: JSON.stringify({}),
          auth: "required",
        },
      );

      setLlmApiKey("");
      applySessionConfigState(validated);
      setLlmSyncStatus("当前会话 LLM Key 已保存并验证通过。");
    } catch (error) {
      setLlmSyncState("error");
      setLlmSyncStatus(`同步失败：${String(error)}`);
      throw error;
    } finally {
      setLlmSyncing(false);
    }
  }, [apiBase, applySessionConfigState, llmApiKey, llmBaseUrl, llmModel]);

  const clearSessionLlmConfig = useCallback(async () => {
    try {
      setLlmSyncing(true);
      await apiRequest(apiBase, "/v1/runtime/session-llm-config", {
        method: "DELETE",
        auth: "required",
      });
      setLlmApiKey("");
      applySessionConfigState(null);
    } finally {
      setLlmSyncing(false);
    }
  }, [apiBase, applySessionConfigState]);

  const value = useMemo<RuntimeConfigContextValue>(() => ({
    apiBase,
    setApiBase,
    runtimeMode,
    agentRuntimeId,
    agentRuntimeAvailable,
    agentRuntimeState,
    agentRuntimeErrorCode,
    refreshRuntimeHealth,
    publicSourceDriver,
    publicSourceStorageTarget,
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
    refreshSessionLlmConfig,
    sessionLlmConfigured,
    sessionLlmMaskedKey,
    sessionLlmExpiresAt,
  }), [
    apiBase,
    runtimeMode,
    agentRuntimeId,
    agentRuntimeAvailable,
    agentRuntimeState,
    agentRuntimeErrorCode,
    refreshRuntimeHealth,
    publicSourceDriver,
    publicSourceStorageTarget,
    llmBaseUrl,
    llmApiKey,
    llmModel,
    llmSyncing,
    llmSyncState,
    llmSyncStatus,
    syncLlmConfig,
    clearSessionLlmConfig,
    refreshSessionLlmConfig,
    sessionLlmConfigured,
    sessionLlmMaskedKey,
    sessionLlmExpiresAt,
  ]);

  return (
    <RuntimeConfigContext.Provider value={value}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig() {
  const context = useContext(RuntimeConfigContext);
  if (!context) {
    throw new Error("useRuntimeConfig must be used within RuntimeConfigProvider");
  }
  return context;
}
