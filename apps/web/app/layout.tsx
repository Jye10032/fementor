import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { AuthProvider } from "../components/auth-provider";
import { Navbar } from "../components/navbar";
import { RuntimeConfigProvider } from "../components/runtime-config";
import "./globals.css";

export const metadata: Metadata = {
  title: "FEMentor · 前端面试训练",
  description: "简历解析 -> 模拟面试 -> 评分反馈 -> 持续迭代",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  // Browser extensions may annotate <html> before React hydrates the page.
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {clerkEnabled ? (
          <ClerkProvider>
            <RuntimeConfigProvider>
              <AuthProvider clerkEnabled={clerkEnabled}>
                <Navbar />
                <main className="min-h-[calc(100vh-57px)] bg-background">{children}</main>
              </AuthProvider>
            </RuntimeConfigProvider>
          </ClerkProvider>
        ) : (
          <RuntimeConfigProvider>
            <AuthProvider clerkEnabled={false}>
              <Navbar />
              <main className="min-h-[calc(100vh-57px)] bg-background">{children}</main>
            </AuthProvider>
          </RuntimeConfigProvider>
        )}
      </body>
    </html>
  );
}
