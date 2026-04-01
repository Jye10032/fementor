"use client";

import { useEffect } from "react";

export default function InterviewSessionLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add("hide-navbar");
    return () => document.body.classList.remove("hide-navbar");
  }, []);

  return <>{children}</>;
}
