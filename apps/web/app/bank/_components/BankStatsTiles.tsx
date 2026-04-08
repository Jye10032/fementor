"use client";

interface BankStatsTilesProps {
  totalCount: number;
  pendingCount: number;
  doneCount: number;
  weaknessCount: number;
}

export function BankStatsTiles({ totalCount, pendingCount, doneCount, weaknessCount }: BankStatsTilesProps) {
  const stats = [
    { label: "总题数", value: totalCount },
    { label: "待复习", value: pendingCount },
    { label: "已完成", value: doneCount },
    { label: "薄弱项题目", value: weaknessCount },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        <article key={stat.label} className="metric-tile">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{stat.label}</p>
          <p className="mt-3 text-3xl font-bold text-foreground">{stat.value}</p>
        </article>
      ))}
    </div>
  );
}
