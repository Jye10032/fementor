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
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-border/70 py-3">
      {stats.map((stat) => (
        <article key={stat.label} className="flex items-baseline gap-2">
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          <p className="text-lg font-semibold text-foreground">{stat.value}</p>
        </article>
      ))}
    </div>
  );
}
