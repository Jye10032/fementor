"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Network } from "lucide-react";

const BANK_VIEWS = [
  { href: "/bank", label: "题目" },
  { href: "/experience", label: "面经" },
  { href: "/bank/mine", label: "我的题单" },
];

export function BankNavigation() {
  const pathname = usePathname();

  return (
    <header className="space-y-4">
      <h1 className="text-2xl font-semibold text-foreground">题库</h1>
      <nav aria-label="题库导航" className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70">
        <div className="flex min-w-0 gap-5 sm:gap-7">
          {BANK_VIEWS.map(({ href, label }) => {
            const active = href === "/experience"
              ? pathname === href || pathname.startsWith(`${href}/`)
              : pathname === href;
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {label}
              </Link>
            );
          })}
        </div>
        <Link href="/graph" aria-current={pathname === "/graph" ? "page" : undefined}
          className={`mb-3 inline-flex items-center gap-1.5 text-xs font-medium ${pathname === "/graph" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
          <Network className="size-3.5" />知识图谱
        </Link>
      </nav>
    </header>
  );
}
