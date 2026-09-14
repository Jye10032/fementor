"use client";

import { RefreshCw } from "lucide-react";

interface BankFilterControlsProps {
  chapter: string;
  setChapter: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  loading: boolean;
  refresh: () => void;
}

export function BankFilterControls({
  chapter, setChapter, sourceFilter, setSourceFilter,
  typeFilter, setTypeFilter, loading, refresh,
}: BankFilterControlsProps) {
  return (
    <>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">我的训练题单</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">按章节、来源和题型快速找到下一道要练的题。</p>
        </div>
        <button onClick={refresh} className="action-secondary gap-2 disabled:opacity-60" disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "刷新中..." : "刷新题单"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">章节</span>
          <input value={chapter} onChange={(e) => setChapter(e.target.value)} className="field-shell w-full" placeholder="全部章节" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">出题来源</span>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="field-shell w-full">
            <option value="all">全部</option>
            <option value="resume">简历</option>
            <option value="doc">资料文档</option>
            <option value="llm">AI 追问</option>
            <option value="official_remote">官方题库</option>
            <option value="unknown">未分类</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">题型</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="field-shell w-full">
            <option value="all">全部</option>
            <option value="basic">基础题</option>
            <option value="interview">综合面试</option>
            <option value="project">项目深挖</option>
            <option value="scenario">场景题</option>
            <option value="follow_up">追问题</option>
            <option value="unknown">未分类</option>
          </select>
        </label>
      </div>
    </>
  );
}
