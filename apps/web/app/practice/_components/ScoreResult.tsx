"use client";

interface ScoreData {
  score: number;
  feedback: string;
  evidence_refs_count: number;
  strengths: string[];
  weaknesses: string[];
  standard_answer: string;
  evidence_refs: Array<{
    source_type: string;
    source_uri: string;
    quote: string;
    confidence: number | null;
  }>;
}

interface ScoreResultProps {
  scoreResult: ScoreData;
  onScheduleReview: (status: "pending" | "done") => void;
}

export function ScoreResult({ scoreResult, onScheduleReview }: ScoreResultProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <article className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">评分结果</p>
        <p className="mt-3 text-4xl font-bold text-foreground">{scoreResult.score}</p>
        <p className="mt-2 text-sm text-muted-foreground">{scoreResult.feedback}</p>
        <p className="mt-2 text-xs text-muted-foreground">证据命中 {scoreResult.evidence_refs_count} 条</p>
        <div className="mt-4 flex flex-col gap-2">
          <button onClick={() => onScheduleReview("done")} className="action-primary">
            掌握较好，标记完成
          </button>
          <button onClick={() => onScheduleReview("pending")} className="action-secondary">
            仍需复习，2天后再看
          </button>
        </div>
      </article>

      <div className="grid gap-4">
        <article className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">优点</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {scoreResult.strengths.map((item) => (
              <span key={item} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{item}</span>
            ))}
          </div>
        </article>
        <article className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">待改进</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {scoreResult.weaknesses.map((item) => (
              <span key={item} className="rounded-full bg-warning/10 px-3 py-1 text-xs text-warning">{item}</span>
            ))}
          </div>
        </article>
        <article className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">标准答案</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">{scoreResult.standard_answer}</p>
        </article>
        <article className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">检索证据</p>
          <div className="mt-3 space-y-3">
            {scoreResult.evidence_refs.map((item, index) => (
              <div key={`${item.source_uri}-${index}`} className="rounded-lg bg-secondary p-3">
                <p className="text-xs text-muted-foreground">{item.source_type} · {item.source_uri || "无路径"} · confidence {item.confidence ?? "n/a"}</p>
                <p className="mt-2 text-sm text-foreground">{item.quote || "无摘要"}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}