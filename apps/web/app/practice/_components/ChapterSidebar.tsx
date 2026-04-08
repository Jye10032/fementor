"use client";

interface ChapterSidebarProps {
  chapters: Array<{ name: string; count: number }>;
  chapter: string;
  setChapter: (v: string) => void;
  chaptersLoading: boolean;
  loadChapters: () => void;
}

export function ChapterSidebar({
  chapters, chapter, setChapter, chaptersLoading, loadChapters,
}: ChapterSidebarProps) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">章节列表</h2>
          <p className="mt-1 text-sm text-muted-foreground">从左侧选择一个章节进入练习。</p>
        </div>
        <button
          onClick={loadChapters}
          disabled={chaptersLoading}
          className="action-secondary px-3 py-2 text-xs disabled:opacity-60"
        >
          {chaptersLoading ? "刷新中..." : "刷新"}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {chapters.map((item) => (
          <button
            key={item.name}
            onClick={() => setChapter(item.name)}
            className={`w-full rounded-2xl border p-4 text-left transition-colors ${
              chapter === item.name ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-background/80 hover:bg-secondary"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">{item.name}</p>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">{item.count}</span>
            </div>
          </button>
        ))}
        {chapters.length === 0 ? (
          <div className="rounded-2xl bg-secondary p-4 text-sm text-muted-foreground">
            {chaptersLoading ? "正在读取章节..." : "当前还没有可练习章节，先去模拟面试完成复盘。"}
          </div>
        ) : null}
      </div>
    </>
  );
}
