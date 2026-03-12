"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, GraduationCap, Home, MessageSquare, NotebookPen } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "首页", icon: Home },
  { href: "/resume", label: "简历解析", icon: NotebookPen },
  { href: "/interview", label: "模拟面试", icon: MessageSquare },
  { href: "/bank", label: "题单", icon: BookOpen },
  { href: "/practice", label: "章节练习", icon: GraduationCap },
] as const;

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <GraduationCap className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">
            FE<span className="text-primary">Mentor</span>
          </span>
        </Link>

        <div className="rounded-2xl border border-border bg-card/70 p-1">
          <div className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={
                isActive(pathname, item.href)
                  ? "flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm"
                  : "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          ))}
          </div>
        </div>
      </nav>
    </header>
  );
}
