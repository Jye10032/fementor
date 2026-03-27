"use client";

import { ExperienceDetail as ExperienceDetailType } from "../_lib/experience.types";

type ExperienceDetailProps = {
  item: ExperienceDetailType;
};

export function ExperienceDetail({ item }: ExperienceDetailProps) {
  return (
    <div className="space-y-6">
      <section className="panel-surface">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="eyebrow-chip">{item.source_platform}</p>
            <h1 className="text-3xl font-semibold text-foreground">{item.title}</h1>
            <p className="text-sm text-muted-foreground">
              {item.company_name || "未知公司"} · {item.role_name || "未知岗位"} · {item.interview_stage || "未知轮次"}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">作者</p>
              <p className="mt-2 text-sm font-medium text-foreground">{item.author_name || "未知作者"}</p>
            </div>
            <div className="metric-tile">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">质量分</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{item.quality_score}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={item.source_url} target="_blank" rel="noreferrer" className="action-secondary">
            打开原帖
          </a>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="panel-surface">
          <p className="text-sm font-semibold text-foreground">清洗版</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{item.content_cleaned || "暂无清洗内容"}</p>
        </article>

        <article className="panel-surface">
          <p className="text-sm font-semibold text-foreground">原文</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{item.content_raw || "暂无原文"}</p>
        </article>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-lg font-semibold text-foreground">问题簇</p>
          <p className="mt-1 text-sm text-muted-foreground">用于后续检索召回、模拟面试题源和追问链恢复。</p>
        </div>

        {item.groups.length === 0 ? (
          <div className="panel-surface text-sm text-muted-foreground">当前没有抽取到问题簇。</div>
        ) : (
          item.groups.map((group) => (
            <article key={group.id} className="panel-surface">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow-chip">{group.topic_cluster || "未分类主题"}</p>
                  <h2 className="mt-3 text-xl font-semibold text-foreground">{group.canonical_question || "未命名问题簇"}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    类型：{group.group_type} · 置信度：{group.confidence.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {group.items.map((question) => (
                  <div key={question.id} className="rounded-[1.25rem] border border-border/70 bg-secondary/45 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {question.question_role}
                      </span>
                      <span className="rounded-full bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {question.category}
                      </span>
                      <span className="rounded-full bg-background px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {question.difficulty}
                      </span>
                    </div>
                    <p className="mt-3 text-base font-medium text-foreground">{question.question_text_normalized || question.question_text_raw}</p>
                    {question.knowledge_points.length > 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        知识点：{question.knowledge_points.join(" / ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
