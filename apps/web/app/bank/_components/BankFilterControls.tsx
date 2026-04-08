"use client";

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
          <span className="eyebrow-chip">Filter & Review</span>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">筛选题单并安排下一轮复习</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">先按章节、来源和题型缩小范围，再决定哪些题需要继续保留，哪些已经可以标记完成。</p>
        </div>
        <button onClick={refresh} className="action-primary disabled:opacity-60" disabled={loading}>
          {loading ? "刷新中..." : "刷新题单"}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">章节</span>
          <input value={chapter} onChange={(e) => setChapter(e.target.value)} className="field-shell w-full" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">出题来源</span>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="field-shell w-full">
            <option value="all">全部</option>
            <option value="resume">resume</option>
            <option value="doc">doc</option>
            <option value="llm">llm</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">题型</span>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="field-shell w-full">
            <option value="all">全部</option>
            <option value="basic">basic</option>
            <option value="project">project</option>
            <option value="scenario">scenario</option>
            <option value="follow_up">follow_up</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
      </div>
    </>
  );
}
