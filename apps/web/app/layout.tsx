import type { Metadata } from "next";
import { Navbar } from "../components/navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "FEMentor · 面试驱动题单",
  description: "模拟面试 -> 复盘 -> 题单沉淀 -> 章节练习",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Navbar />
        <main className="min-h-[calc(100vh-57px)] bg-background">{children}</main>
      </body>
    </html>
  );
}
