"use client";

import { useEffect, useState } from "react";

export function useRuntimeConfig() {
  const [apiBase, setApiBase] = useState("http://localhost:3300");
  const [userId, setUserId] = useState("u_web_001");

  useEffect(() => {
    const savedApi = window.localStorage.getItem("fementor.apiBase");
    const savedUser = window.localStorage.getItem("fementor.userId");
    if (savedApi) setApiBase(savedApi);
    if (savedUser) setUserId(savedUser);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("fementor.apiBase", apiBase);
  }, [apiBase]);

  useEffect(() => {
    window.localStorage.setItem("fementor.userId", userId);
  }, [userId]);

  return { apiBase, setApiBase, userId, setUserId };
}

type RuntimeConfigProps = {
  apiBase: string;
  onApiBaseChange: (value: string) => void;
  userId: string;
  onUserIdChange: (value: string) => void;
};

export function RuntimeConfig({ apiBase, onApiBaseChange, userId, onUserIdChange }: RuntimeConfigProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">运行配置</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">API Base</span>
          <input
            value={apiBase}
            onChange={(e) => onApiBaseChange(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-foreground"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">User ID</span>
          <input
            value={userId}
            onChange={(e) => onUserIdChange(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-foreground"
          />
        </label>
      </div>
    </section>
  );
}
