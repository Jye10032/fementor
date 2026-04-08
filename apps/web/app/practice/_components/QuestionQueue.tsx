"use client";

interface PracticeItem {
  id: string;
  chapter: string;
  question: string;
  difficulty: string;
  weakness_tag: string;
}

interface QuestionQueueProps {
  items: PracticeItem[];
  currentItemId: string | null;
  onSelect: (index: number) => void;
}

export function QuestionQueue({ items, currentItemId, onSelect }: QuestionQueueProps) {
  return (
    <section className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">待练题单</h2>
        <span className="text-xs text-muted-foreground">{items.length} 题</span>
      </div>
      <div className="mt-3 space-y-3">
        {items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => onSelect(index)}
            className={`w-full rounded-xl border p-4 text-left transition-colors ${
              currentItemId === item.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-secondary"
            }`}
          >
            <p className="font-medium text-foreground">{item.question}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {item.chapter} · {item.difficulty} · {item.weakness_tag || "无薄弱项标签"}
            </p>
          </button>
        ))}
        {items.length === 0 ? <p className="text-sm text-muted-foreground">当前章节暂无可练习题</p> : null}
      </div>
    </section>
  );
}
