# 检索与 Sirchmunk 架构

- 版本：v1.0
- 日期：2026-03-17
- 状态：已接入并可用

## 1. 模块职责

检索模块负责根据题目、用户回答和题型，生成证据查询计划，执行用户资料检索，并把结果统一收敛成上层可消费的证据结构。

当前目标不是做通用搜索引擎，而是为学习反馈、知识比对和追问提供“可追溯证据”。

## 2. 架构边界

当前项目中必须明确区分两类来源：

1. 评分标准来源
2. 用户知识来源

约束如下：

1. 面试评分的标准来源固定为：
   - `rubric`
   - `expected_points`
   - `LLM reasoning`
2. 用户上传的笔记、项目文档、知识库不作为评分标准来源。
3. Sirchmunk 只负责检索用户已有知识记录，不负责定义评分标准。
4. 命中用户文档只能说明“用户曾记录过该内容”，不能直接说明“该内容是正确标准答案”。
5. LLM 生成的标准化建议内容只能进入候选区，不能直接覆盖用户正式知识库。

## 3. 当前分层

### 查询规划层

负责：

1. 根据问题、回答、简历摘要生成检索关键词。
2. 生成统一查询计划。

核心函数：

- `buildQueryPlan()`

### 检索执行层

当前包含三条路径：

1. `sirchmunk`
2. `local rg`
3. `web fallback`

核心函数：

- `retrieveEvidence()`

### 结果归一化层

负责：

1. 把不同检索来源的结果统一为证据结构
2. 屏蔽底层实现差异

## 4. 检索在整体链路中的位置

当前设计里存在两条并行链路：

### 评分链路

负责：

1. 基于 `rubric + expected_points + answer` 做标准化评分
2. 输出：
   - `score`
   - `strengths`
   - `weaknesses`
   - `rubric_refs`

说明：

1. 评分链路不依赖 Sirchmunk 命中作为标准依据。
2. 即使用户资料完全未命中，也可以继续完成评分。

### 用户知识比对链路

负责：

1. 基于 `retrieval_query + keywords + answer_summary` 检索用户资料
2. 输出：
   - `note_refs`
   - `note_match_status`
   - `conflict_flags`
   - `suggested_note`

说明：

1. Sirchmunk 主要服务于这条链路。
2. 这条链路服务于学习反馈，而不是替代评分标准。

## 5. 当前主路径

当前默认主路径是：

- `sirchmunk`

本地 `rg` 只保留为显式调试入口：

- `strategy=local`

说明：

1. 不是“先 rg 再 sirchmunk”。
2. 当前默认是 `sirchmunk_search_first`。
3. 本地 `rg` 主要用于调试或对比实验。

## 6. Query Plan 当前做了什么

`buildQueryPlan()` 当前是轻量规则规划，不是复杂 agent。

它会：

1. 拿到：
   - `question`
   - `resumeSummary`
   - `plannedKeywords`
2. 切分出词项池
3. 生成三组关键词：
   - `entity_terms`
   - `intent_terms`
   - `evidence_terms`
4. 输出：
   - `rewritten_query`
   - `keyword_groups`
   - `next_action = sirchmunk_search_first`

## 7. Sirchmunk 在当前项目中的角色

Sirchmunk 不是评分器，也不是最终答案生成器。

它当前负责：

1. 在指定知识文档路径里做多阶段检索。
2. 返回用户知识证据片段或摘要结果。
3. 供上层知识比对与学习反馈链路继续使用。

### 当前项目中的使用方式

1. 后端通过 CLI 调起 `sirchmunk`
2. 默认模式是配置项里的 `SIRCHMUNK_MODE`
3. 用户知识比对链路通常显式使用：
   - `DEEP`

### 当前工作目录

- `SIRCHMUNK_WORK_PATH=data/.sirchmunk`

## 8. 本地 rg 的角色

本地检索不是主方案，但仍保留。

当前作用：

1. 当显式要求 `strategy=local` 时走 `rg`
2. 用于调试、对比、验证某些关键词命中情况

### 当前实现

1. 通过 `localSearch()` 调用 `rg`
2. 把命中转成：
   - `source_type = local_doc`
   - `source_uri = file:line`
   - `quote`
   - `confidence`

## 9. 当前证据统一协议

不论底层来源是什么，最后都统一成：

```json
{
  "source_type": "local_doc|sirchmunk|web",
  "source_uri": "...",
  "quote": "...",
  "confidence": 0.7
}
```

### 当前好处

1. 上层不需要感知 `rg`、`sirchmunk`、`web` 的差异。
2. 复盘、日志、知识比对都可以只依赖统一证据协议。

### 推荐的上层分层

为了避免实现时再次混淆，建议把证据继续拆成：

```json
{
  "rubric_refs": [],
  "note_refs": []
}
```

约束：

1. `rubric_refs` 仅用于评分解释。
2. `note_refs` 仅用于用户知识比对与学习反馈。
3. 不允许因为 `note_refs` 命中就直接判定“回答正确”。

## 10. 路径规划的当前原则

检索不是直接把所有资料目录整包传进去。

当前按题型裁剪来源：

1. `basic`
   - JD 优先
2. `project/scenario`
   - JD + knowledge
3. `knowledge`
   - knowledge 优先

### 关于简历

当前简历原文：

- 不再直接作为 Sirchmunk / localSearch 的检索源

当前简历只保留：

- `resume_summary`

用途：

1. 生成问题
2. 评分背景
3. 标准答案组织

## 11. Web fallback 当前状态

Web fallback 目前还是占位能力。

当前行为：

1. 只有当本地证据为空时才认为需要 fallback
2. 返回的是占位结果，不是真实 Web provider

因此当前项目的真正主证据仍然是：

1. Sirchmunk
2. knowledge 文档
3. JD 文档

## 12. Sirchmunk 当前边界

### 已确认

1. Sirchmunk CLI 输出不稳定，所以项目侧做了结构化收敛。
2. Deep 模式下可能触发 `DocQA` 风格行为，因此业务层先做题型路由和路径裁剪。
3. 当前项目更适合把 Sirchmunk 视作“用户知识证据召回器”，而不是“最终答案提供者”。
4. Sirchmunk 的职责是帮助发现：
   - 用户是否已有相关记录
   - 用户知识库是否缺漏
   - 用户笔记是否与标准点冲突

### 当前风险

1. `plannedKeywords` 仍偏轻量，后续可继续升级。
2. `needFallback` 现在还是最保守的“空结果触发”，还没有做按证据质量阈值判断。
3. knowledge 文档筛选目前依赖路径和题型规划，后续可进一步做更细索引。

## 13. 当前成功标准

检索模块当前的“成功”定义是：

1. 能根据题型裁剪合适路径
2. 能稳定拿到可追溯的用户知识证据
3. 上层评分不依赖底层搜索实现细节
4. 不再把用户文档误当评分标准
5. 能为冲突提示与候选建议笔记提供稳定输入
