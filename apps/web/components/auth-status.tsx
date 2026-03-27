"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { useAuthState } from "./auth-provider";

export function AuthStatus() {
  const { isLoaded, isSignedIn, authUser } = useAuthState();

  if (!isLoaded) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card/75 px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
        登录状态加载中...
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <SignInButton mode="modal">
        <button
          type="button"
          className="rounded-2xl border border-border/80 bg-card/75 px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm hover:bg-secondary hover:text-foreground"
        >
          登录
        </button>
      </SignInButton>
    );
  }

  return <UserButton />;
}
