import { Brain, BriefcaseBusiness, CircleAlert, Flame, Medal, TrendingUp } from "lucide-react";
import { RetrospectResponse } from "./types";

type RetrospectSummaryProps = {
  retrospect: RetrospectResponse | null;
  variant?: "report" | "panel";
};

function renderTagList(items: string[], emptyLabel: string, toneClassName: string) {
  if (items.length === 0) {
    return <p className="text-sm leading-6 text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${toneClassName}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function RetrospectSummary({
  retrospect,
  variant = "panel",
}: RetrospectSummaryProps) {
  if (!retrospect) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-background/75 p-5 text-sm leading-6 text-muted-foreground">
        复盘尚未生成。你可以先完成本场面试，再点击“生成复盘”，系统会整理稳定优势、主要风险和下一轮练习重点。
      </div>
    );
  }

  const memory = retrospect.long_term_memory;
  const isReport = variant === "report";
  const metricClassName = isReport
    ? "rounded-2xl border border-border/70 bg-background/80 p-4"
    : "rounded-xl border border-border/70 bg-background/75 p-4";

  const insightClassName = isReport
    ? "rounded-2xl border border-border/70 bg-background/82 p-4"
    : "rounded-xl border border-border/70 bg-background/75 p-4";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <article className={metricClassName}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">平均分</p>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{retrospect.avg_score}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">基于 {retrospect.turns_count} 轮面试表现</p>
        </article>

        <article className={metricClassName}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">回流题目</p>
            <Flame className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{retrospect.promoted_questions}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            新增 {retrospect.promoted_new_questions} 道，更新 {retrospect.promoted_updated_questions} 道
          </p>
        </article>

        <article className={metricClassName}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">当前结论</p>
            <Medal className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-3 text-lg font-semibold text-foreground">
            {memory?.recommended_focus.length ? "已生成下一轮训练重点" : "已沉淀本场复盘记录"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {retrospect.memory_path ? "结果已写入成长档案" : "结果已可供本页查看"}
          </p>
        </article>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <article className={insightClassName}>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Brain className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">稳定优势</p>
              <p className="text-xs text-muted-foreground">建议继续保留的表达习惯和亮点</p>
            </div>
          </div>
          <div className="mt-4">
            {renderTagList(
              memory?.stable_strengths ?? [],
              "这一场还没有沉淀出明显的稳定优势。",
              "border-accent/20 bg-accent/5 text-accent",
            )}
          </div>
        </article>

        <article className={insightClassName}>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-warning/10 text-warning">
              <CircleAlert className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">优先补强</p>
              <p className="text-xs text-muted-foreground">下一轮练习最值得先改进的点</p>
            </div>
          </div>
          <div className="mt-4">
            {renderTagList(
              memory?.recommended_focus ?? [],
              "暂时还没有生成明确的训练重点。",
              "border-warning/20 bg-warning/5 text-warning",
            )}
          </div>
        </article>

        <article className={insightClassName}>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <CircleAlert className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">主要风险</p>
              <p className="text-xs text-muted-foreground">反复暴露、容易拖低表现的问题</p>
            </div>
          </div>
          <div className="mt-4">
            {renderTagList(
              memory?.stable_weaknesses ?? [],
              "这一场没有识别出明显的重复性风险。",
              "border-destructive/20 bg-destructive/5 text-destructive",
            )}
          </div>
        </article>

        <article className={insightClassName}>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BriefcaseBusiness className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">岗位与项目信号</p>
              <p className="text-xs text-muted-foreground">可继续强化的项目表达与岗位匹配点</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                项目信号
              </p>
              {renderTagList(
                memory?.project_signals ?? [],
                "这一场没有额外沉淀新的项目信号。",
                "border-primary/20 bg-primary/5 text-primary",
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                岗位匹配
              </p>
              {renderTagList(
                memory?.role_fit_signals ?? [],
                "这一场没有额外沉淀新的岗位匹配信号。",
                "border-primary/20 bg-primary/5 text-primary",
              )}
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
