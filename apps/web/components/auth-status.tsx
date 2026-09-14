"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { UserRoundCheck } from "lucide-react";
import { useAuthState } from "./auth-provider";

export function AuthStatus() {
  const { authEnabled, isLoaded, isSignedIn, viewer } = useAuthState();

  if (!authEnabled) {
    return (
      <div className="flex h-10 w-auto min-w-16 items-center justify-center">
        <div
          className="flex size-10 items-center justify-center rounded-lg border border-border/70 bg-card/75 text-sm text-muted-foreground shadow-sm sm:h-auto sm:w-auto sm:gap-2 sm:px-3 sm:py-2"
          aria-label={viewer?.role === "admin" ? "本地管理员" : "本地用户"}
          title={viewer?.role === "admin" ? "本地管理员" : "本地用户"}
        >
          <UserRoundCheck className="size-4" />
          <span className="hidden whitespace-nowrap sm:inline">
            {viewer?.role === "admin" ? "本地管理员" : "本地用户"}
          </span>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-10 w-auto min-w-16 items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-secondary" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex h-10 w-auto min-w-16 items-center justify-center">
        <SignInButton mode="modal">
          <button
            type="button"
            className="whitespace-nowrap rounded-2xl border border-border/70 bg-card/75 px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm hover:bg-secondary hover:text-foreground"
          >
            登录
          </button>
        </SignInButton>
      </div>
    );
  }

  return (
    <div className="flex h-10 w-16 items-center justify-center">
      <UserButton />
    </div>
  );
}
