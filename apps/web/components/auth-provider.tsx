"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { createContext, ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AuthState, AuthUser } from "../lib/auth";
import { setApiTokenResolver } from "../lib/api";
import { fetchViewer, Viewer } from "../lib/viewer";
import { useRuntimeConfig } from "./runtime-config";

const AuthContext = createContext<AuthState | null>(null);

type AuthProviderProps = {
  children: ReactNode;
};

function buildAuthUser(user: ReturnType<typeof useUser>["user"]): AuthUser | null {
  if (!user) {
    return null;
  }

  return {
    clerkUserId: user.id,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    name: user.fullName ?? user.username ?? null,
    avatarUrl: user.imageUrl ?? null,
  };
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { apiBase } = useRuntimeConfig();
  const [authReady, setAuthReady] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const refreshViewer = async () => {
    if (!isSignedIn) {
      setViewer(null);
      setViewerError(null);
      return null;
    }

    try {
      setViewerLoading(true);
      setViewerError(null);
      const response = await fetchViewer(apiBase);
      setViewer(response.viewer);
      return response.viewer;
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载 viewer 失败";
      setViewer(null);
      setViewerError(message);
      return null;
    } finally {
      setViewerLoading(false);
    }
  };

  const value = useMemo<AuthState>(
    () => ({
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      authReady,
      authUser: buildAuthUser(user),
      viewer,
      viewerLoading,
      viewerError,
      getToken: async () => {
        if (!isSignedIn) {
          return null;
        }

        return getToken();
      },
      refreshViewer,
    }),
    [authReady, getToken, isLoaded, isSignedIn, refreshViewer, user, viewer, viewerError, viewerLoading],
  );

  useLayoutEffect(() => {
    setAuthReady(false);
    setApiTokenResolver(async () => {
      if (!isSignedIn) {
        return null;
      }

      return getToken();
    });
    setAuthReady(true);

    return () => {
      setAuthReady(false);
      setApiTokenResolver(async () => null);
    };
  }, [getToken, isSignedIn]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn) {
      setViewer(null);
      setViewerError(null);
      setViewerLoading(false);
      return;
    }

    void refreshViewer();
  }, [apiBase, isLoaded, isSignedIn]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthState() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthState must be used within AuthProvider");
  }

  return context;
}
