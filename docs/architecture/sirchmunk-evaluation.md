# Sirchmunk 检索增强评测

## 目标

- 验证 Sirchmunk 是否真的提升了检索命中率，而不是仅仅“返回一段看起来合理的话”。
- 区分三类能力：
  - 原始自然语言直接检索的效果
  - 经过检索式 query 和关键词整理后的 Sirchmunk 效果
  - 本地 `rg` 检索的基线效果

## 评测变体

- `direct`
  - 直接把问题和回答送入 `retrieveEvidence()`。
  - 不额外提供 `plannedQuery` 或 `plannedKeywords`。
- `prompted`
  - 使用人工设计的检索式 query 与关键词。
  - 用来近似模拟“LLM 先判断是否需要检索，再把问题整理成检索表达”的目标链路。
- `local`
  - 强制走本地 `rg` 检索。
  - 作为纯文本命中基线。

## 评测指标

- `pass_rate`
  - 当前用例是否至少命中了预期文件或预期关键词。
- `file_hit_rate`
  - 是否命中了预期资料来源。
- `average_score`
  - 简单启发式分数，不代表最终业务评分。
  - 命中预期文件权重最高，其次是关键词命中，再次是有无证据。
- `average_latency_ms`
  - 平均耗时。
- `average_evidence_count`
  - 平均证据条数。

## 用例来源

- 简历：`data/user_docs/u_web_001/profile/resume-*.md`
- JD：`data/user_docs/u_web_001/profile/jd-jd.md`
- 知识库：`data/user_docs/u_web_001/knowledge/*.md`

评测用例定义保存在：

- [sirchmunk-eval-cases.json](/Users/user/vscode/fementor/evals/sirchmunk-eval-cases.json)

## 运行方式

```bash
npm run eval:sirchmunk
```

可选参数：

```bash
node scripts/eval-sirchmunk.js --user u_web_001
node scripts/eval-sirchmunk.js --cases evals/sirchmunk-eval-cases.json --report-dir docs/reports
```

## 输出结果

脚本会在 `docs/reports/` 下生成两份报告：

- `sirchmunk-eval-<timestamp>.json`
- `sirchmunk-eval-<timestamp>.md`

## 当前局限

- `prompted` 目前使用的是人工设计的 query 和关键词，不是线上实时 LLM planner 的直接输出。
- 评分是检索命中导向的启发式评估，不等同于最终面试评分质量。
- 若后续要评测“检索是否改善最终回答质量”，建议再加一层：
  - `baseline LLM`
  - `LLM + evidence_refs`
  - `LLM + evidence_refs + retrieval planner`
