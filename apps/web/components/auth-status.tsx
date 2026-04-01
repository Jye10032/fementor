"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { useAuthState } from "./auth-provider";

export function AuthStatus() {
  const { authEnabled, isLoaded, isSignedIn } = useAuthState();

  if (!authEnabled) {
    return (
      <div className="flex h-10 w-16 items-center justify-center">
        <div className="rounded-2xl border border-border/70 bg-card/75 px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
          登录未启用
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-10 w-16 items-center justify-center">
        <div className="h-8 w-8 animate-pulse rounded-full bg-secondary" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex h-10 w-16 items-center justify-center">
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-2xl border border-border/70 bg-card/75 px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm hover:bg-secondary hover:text-foreground"
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
