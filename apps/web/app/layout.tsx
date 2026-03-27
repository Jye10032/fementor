import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { AuthProvider } from "../components/auth-provider";
import { Navbar } from "../components/navbar";
import { RuntimeConfigProvider } from "../components/runtime-config";
import "./globals.css";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
});

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "FEMentor · 前端面试训练",
  description: "简历解析 -> 模拟面试 -> 评分反馈 -> 持续迭代",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        <ClerkProvider>
          <RuntimeConfigProvider>
            <AuthProvider>
              <Navbar />
              <main className="min-h-[calc(100vh-57px)] bg-background">{children}</main>
            </AuthProvider>
          </RuntimeConfigProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
