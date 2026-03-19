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

type RuntimeConfigContextValue = {
  apiBase: string;
  setApiBase: (value: string) => void;
  userId: string;
  setUserId: (value: string) => void;
  llmBaseUrl: string;
  setLlmBaseUrl: (value: string) => void;
  llmApiKey: string;
  setLlmApiKey: (value: string) => void;
  llmModel: string;
  setLlmModel: (value: string) => void;
  llmSyncing: boolean;
  llmSyncStatus: string;
  syncLlmConfig: () => Promise<void>;
};

const DEFAULT_API_BASE = "http://localhost:3300";
const DEFAULT_USER_ID = "u_web_001";
const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";

const RuntimeConfigContext = createContext<RuntimeConfigContextValue | null>(null);

type ProviderProps = {
  children: ReactNode;
};

export function RuntimeConfigProvider({ children }: ProviderProps) {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [llmBaseUrl, setLlmBaseUrl] = useState(DEFAULT_LLM_BASE_URL);
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM_MODEL);
  const [llmSyncing, setLlmSyncing] = useState(false);
  const [llmSyncStatus, setLlmSyncStatus] = useState("尚未同步 LLM 配置。");
  const initializedRef = useRef(false);
  const bootstrappedSyncRef = useRef(false);

  useEffect(() => {
    const savedApi = window.localStorage.getItem("fementor.apiBase");
    const savedUser = window.localStorage.getItem("fementor.userId");
    const savedLlmBaseUrl = window.localStorage.getItem("fementor.llmBaseUrl");
    const savedLlmApiKey = window.localStorage.getItem("fementor.llmApiKey");
    const savedLlmModel = window.localStorage.getItem("fementor.llmModel");

    if (savedApi) setApiBase(savedApi);
    if (savedUser) setUserId(savedUser);
    if (savedLlmBaseUrl) setLlmBaseUrl(savedLlmBaseUrl);
    if (savedLlmApiKey) setLlmApiKey(savedLlmApiKey);
    if (savedLlmModel) setLlmModel(savedLlmModel);

    initializedRef.current = true;
  }, []);

  useEffect(() => {
    if (!initializedRef.current) return;
    window.localStorage.setItem("fementor.apiBase", apiBase);
  }, [apiBase]);

  useEffect(() => {
    if (!initializedRef.current) return;
    window.localStorage.setItem("fementor.userId", userId);
  }, [userId]);

  useEffect(() => {
    if (!initializedRef.current) return;
    window.localStorage.setItem("fementor.llmBaseUrl", llmBaseUrl);
  }, [llmBaseUrl]);

  useEffect(() => {
    if (!initializedRef.current) return;
    window.localStorage.setItem("fementor.llmApiKey", llmApiKey);
  }, [llmApiKey]);

  useEffect(() => {
    if (!initializedRef.current) return;
    window.localStorage.setItem("fementor.llmModel", llmModel);
  }, [llmModel]);

  const syncLlmConfig = useCallback(async () => {
    try {
      setLlmSyncing(true);
      setLlmSyncStatus("正在同步 LLM 配置...");
      const response = await fetch(`${apiBase}/v1/runtime/llm-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: llmBaseUrl,
          api_key: llmApiKey,
          model: llmModel,
        }),
        cache: "no-store",
      });

      const data = (await response.json()) as { error?: string; message?: string; config?: { has_api_key?: boolean; model?: string } };
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setLlmSyncStatus(
        data.message
          || `LLM 配置已同步${data.config?.has_api_key ? "，当前已设置 API Key" : "，当前未设置 API Key"}。`,
      );
    } catch (error) {
      setLlmSyncStatus(`同步失败：${String(error)}`);
      throw error;
    } finally {
      setLlmSyncing(false);
    }
  }, [apiBase, llmApiKey, llmBaseUrl, llmModel]);

  useEffect(() => {
    if (!initializedRef.current || bootstrappedSyncRef.current) return;
    bootstrappedSyncRef.current = true;
    if (!llmApiKey.trim() && !llmBaseUrl.trim()) return;
    void syncLlmConfig().catch(() => {});
  }, [llmApiKey, llmBaseUrl, syncLlmConfig]);

  const value = useMemo<RuntimeConfigContextValue>(() => ({
    apiBase,
    setApiBase,
    userId,
    setUserId,
    llmBaseUrl,
    setLlmBaseUrl,
    llmApiKey,
    setLlmApiKey,
    llmModel,
    setLlmModel,
    llmSyncing,
    llmSyncStatus,
    syncLlmConfig,
  }), [
    apiBase,
    userId,
    llmBaseUrl,
    llmApiKey,
    llmModel,
    llmSyncing,
    llmSyncStatus,
    syncLlmConfig,
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
