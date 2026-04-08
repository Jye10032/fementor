"use client";

interface ActiveQuestionProps {
  question: string;
  chapter: string;
  difficulty: string;
  nextReviewAt: string | null;
  answer: string;
  setAnswer: (v: string) => void;
  submitting: boolean;
  onSubmit: () => void;
}

export function ActiveQuestion({
  question, chapter, difficulty, nextReviewAt,
  answer, setAnswer, submitting, onSubmit,
}: ActiveQuestionProps) {
  return (
    <div className="space-y-4">
      <header className="rounded-xl bg-secondary p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">当前题目</p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">{question}</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          {chapter} · {difficulty} · next_review_at {nextReviewAt ?? "无"}
        </p>
      </header>

      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">你的回答</span>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={8}
          placeholder="按项目背景、方案选择、权衡取舍、结果复盘来组织回答。"
          className="field-shell w-full"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button onClick={onSubmit} disabled={submitting || !answer.trim()} className="action-primary">
          {submitting ? "评分中..." : "提交评分"}
        </button>
        <button onClick={() => setAnswer("")} className="action-secondary">
          清空回答
        </button>
      </div>
    </div>
  );
}
