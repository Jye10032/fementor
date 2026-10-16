# 上下文与长期记忆架构

- 版本：v1.0
- 日期：2026-03-17
- 状态：已接入并可用

> 演进说明（2026-08-26）：本文的 SQLite/Markdown 内容记录当前长期记忆实现。结构化业务记录将统一迁移到 PostgreSQL；OpenViking 后续只作为派生上下文与 Agent 记忆层，边界见 [DSH-first 与 OpenViking 方案](agent-runtime-openviking-preliminary-design.md)。

## 1. 模块职责

> 产品方向更新（2026-10-10）：本文保留已有字段与摘要行为的记录。后续按[动态面试与能力画像全链路设计](../specs/adaptive-interview-evidence-profile-spec.md)保存有来源、时间和适用范围的能力观察；单场表现不自动升级为稳定弱项。新方案尚未实现，旧字段不能直接视为新的证据画像。

上下文与长期记忆模块负责在面试过程中控制 prompt 长度，并把会话结束后的稳定结论沉淀下来，供后续复盘和练习使用。

当前目标是：

1. 不让历史对话无限膨胀
2. 保留后续评分和追问仍然需要的信息
3. 把短期表现转成跨场次可复用的长期记忆

## 2. 当前分层

### 短期上下文

作用：

1. 服务当前这场面试的评分与追问
2. 由最近若干轮原文 + 较早历史摘要共同组成

### 长期记忆

作用：

1. 服务跨场次的稳定能力画像
2. 由整场复盘阶段统一生成

## 3. 当前上下文管理方式

> 更新（2026-10-12）：以下第 3—6 节保留 legacy 管线的说明。unified 单轮评分已使用 `buildBudgetedTurnContext()`：先计量完整请求的 token 和字节预算，保留本轮完整题目、回答、已有简历摘要与 JD；历史能容纳时全部保留，超预算时优先保留最近两轮和相关原文，其余转为明确标记的压缩摘录，并记录遗漏轮数。这里保留的是已经存储的 `resume_summary`，不是重新读取整份简历文件；压缩摘录也不代表完整证据。预算包含输出余量，详见 [回答恢复与上下文预算](railway-agent-sandbox-design.md#13-2026-10-12-回答持久化与上下文预算)。

### 3.1 不是直接保留全部原文

当前实现里，会先把本场 `interview_turn` 按时间倒序处理。

策略：

1. 最近轮次原文优先保留
2. 超出预算的更早轮次进入 `overflowTurns`
3. `overflowTurns` 再压缩成一段摘要

核心函数：

- `buildInterviewContextWindow()`

## 4. 当前压缩逻辑

### 输入

压缩函数会拿到：

1. `currentQuestion`
2. `overflow_turns`

其中每轮会传入精简后的字段：

1. `question`
2. `answer`
3. `score`
4. `strengths`
5. `weaknesses`

### 输出

压缩结果固定为：

```json
{
  "summary": "...",
  "open_points": ["..."]
}
```

含义：

1. `summary`
   - 较早历史的压缩摘要
2. `open_points`
   - 仍未补足的关键弱点

### 当前实现方式

压缩优先走：

- `jsonCompletion()`

如果 LLM 失败，再退回规则 fallback。

## 5. 当前上下文 fallback

如果 LLM 压缩失败，会走 `buildContextSummaryFallback()`。

当前规则逻辑会聚合：

1. 已讨论主题
2. 已体现优势
3. 历史薄弱点

并把弱项去重后放进：

- `open_points`

说明：

当前不是“丢掉历史”，而是“把旧历史压缩成摘要 + open points”。

## 6. 当前上下文窗口输出

`buildInterviewContextWindow()` 最终会返回：

1. `summary`
2. `openPoints`
3. `recentTurnsText`
4. `contextText`

其中：

- `summary`
  - 较早历史压缩摘要
- `recentTurnsText`
  - 最近轮次原文
- `contextText`
  - 两者拼接后的最终上下文

## 7. 长期记忆当前做了什么

长期记忆不是在每一轮实时生成，而是在：

- `retrospect`

阶段统一生成。

核心函数：

- `summarizeLongTermMemory()`

## 8. 当前长期记忆结构

当前输出固定为：

```json
{
  "stable_strengths": [],
  "stable_weaknesses": [],
  "project_signals": [],
  "role_fit_signals": [],
  "recommended_focus": []
}
```

### 含义

1. `stable_strengths`
   - 跨多轮成立的稳定优势
2. `stable_weaknesses`
   - 反复出现、影响评分的弱点
3. `project_signals`
   - 项目型能力信号
4. `role_fit_signals`
   - 与 JD 匹配或不匹配的信号
5. `recommended_focus`
   - 后续最值得练习的方向

## 9. 当前长期记忆输入

长期记忆提炼会使用：

1. `resume_summary`
2. `strengths`
3. `weaknesses`
4. 本场 `turns`
5. `questionItems`

说明：

它不是只看最后一轮，而是看整场。

## 10. 当前长期记忆 fallback

如果 LLM 提炼失败，会走规则 fallback：

1. `stable_strengths`
   - 直接取当前 strengths
2. `stable_weaknesses`
   - 直接取当前 weaknesses
3. `project_signals`
   - 从带“项目”字样的问题中提取
4. `role_fit_signals`
   - 从 JD 相关题目中提取
5. `recommended_focus`
   - 优先取 weaknesses

## 11. 存储方式

### SQLite

结构化结果会返回给前端，并间接体现在：

1. `interview_session`
2. `interview_turn`
3. `question_bank`

### Markdown memory

当前还会调用：

- `appendMemoryEntry()`

把阶段性总结写到：

- `data/memory/user-<id>.md`

说明：

现在的 markdown memory 更像补充日志，不是唯一真源。

## 12. 当前边界

1. 当前上下文管理是“最近原文 + 较早摘要”，不是复杂分块记忆系统。
2. 长期记忆目前在 `retrospect` 阶段一次生成，不会实时回写到更细粒度画像表。
3. `open_points` 目前主要服务上下文压缩和后续追问，不是完整任务规划器。

## 13. 当前成功标准

当前上下文与长期记忆模块的“成功”定义是：

1. Prompt 不会因为历史无限增长而失控
2. 较早轮次不会直接丢失，而是压缩成可复用摘要
3. 会话结束后能稳定生成长期记忆结构
4. 这些结果足够支撑后续复盘、题单回流和练习建议
