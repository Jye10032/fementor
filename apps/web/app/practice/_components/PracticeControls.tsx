"use client";

interface PracticeControlsProps {
  chapter: string;
  viewerName: string;
  includeFuture: boolean;
  setIncludeFuture: (v: boolean) => void;
  loading: boolean;
  isSignedIn: boolean;
  onLoad: () => void;
}

export function PracticeControls({
  chapter, viewerName, includeFuture, setIncludeFuture,
  loading, isSignedIn, onLoad,
}: PracticeControlsProps) {
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="rounded-xl bg-secondary px-4 py-2 text-sm text-foreground">
        当前章节：<span className="font-medium">{chapter || "未选择"}</span>
      </div>
      <div className="rounded-xl bg-secondary px-4 py-2 text-sm text-foreground">
        当前用户：<span className="font-medium">{viewerName}</span>
      </div>
      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={includeFuture} onChange={(e) => setIncludeFuture(e.target.checked)} />
        include_future
      </label>
      <button onClick={onLoad} className="action-primary disabled:opacity-60" disabled={loading || !chapter || !isSignedIn}>
        {loading ? "拉取中..." : "拉取练习题"}
      </button>
    </div>
  );
}
