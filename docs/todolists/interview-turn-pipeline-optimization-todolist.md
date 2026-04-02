# 面试单轮处理链路整合 Todo List

> **当前状态：尚未开始（v2 方案，2026-04-01 重写）。** 目标从 5 次 LLM 收敛到 1 次统一调用，通过流式 JSON `content` 尾字段保持流式评价体验，追问改为 embedding 检索 + LLM 验证。

- 日期：2026-04-01
- 状态：待开始
- 对应方案：
  - `docs/architecture/specs/interview-turn-pipeline-optimization-spec.md`（v2）
  - `docs/architecture/interview-orchestrator.md`

## 1. 使用方式

这份文档是实施清单，不是架构说明。

使用原则：

1. 默认按 `Phase 0 -> Phase 4` 顺序推进。
2. 每个阶段完成后都要验证"流式接口还能正常工作"。
3. 优先保持 `result` 事件结构兼容，避免前端联动返工。
4. Phase 2 接入时保留旧函数作为 fallback，通过 feature flag 切换。

## 2. 当前代码基线

### Route 层

- `apps/api/src/routes/interview-routes.js`

### 编排层

- `apps/api/src/interview/turn-service.js`

### LLM 层

- `apps/api/src/interview/llm-service.js`

### 证据层

- `apps/api/src/evidence-service.js`

### 追问复用层

- `apps/api/src/experience/follow-up-reuse.js`

### SSE / HTTP 工具

- `apps/api/src/http.js`

## 3. 目标结果

1. 正式回答（无追问）：1 次 LLM。
2. 正式回答（有追问，面经库命中）：2 次 LLM（统一调用 + adaptFollowUp）。
3. 正式回答（有追问，需生成）：2 次 LLM（统一调用 + generateFollowUpQuestion）。
4. 非正式输入：1 次 LLM（统一调用，content 输出回复）。
5. 前端 SSE 解析逻辑不变。
6. 流式 `content` 输出体验与当前流式评价一致。
7. 面经库追问复用能力不丢失。

## 4. Phase 0：基线确认与观测补齐

### 目标

补齐当前调用链的观测点，确保优化后能对比收益。

### TODO

- [ ] 确认 `turn-service` 当前正式回答路径的 LLM 调用顺序和耗时
- [ ] 确认非正式输入路径的 LLM 调用顺序和耗时
- [ ] 为整轮处理补充总耗时统计（已有部分，确认完整性）
- [ ] 记录当前首 token 时间基线

### 验收

- [ ] 能区分每轮到底调用了几次 LLM
- [ ] 有可对比的耗时基线数据

## 5. Phase 1：流式 JSON 分割器

### 目标

实现 `content` 尾字段流式输出的基础设施。

### 新增文件

- [ ] `apps/api/src/interview/content-stream-splitter.js`

### TODO

- [ ] 实现 `createContentStreamSplitter({ onContentToken, onComplete })`
- [ ] `feed(token)` 方法：缓冲 `content` 之前的字段，检测到 `"content":"` 后流式输出
- [ ] `end()` 方法：解析完整 JSON，调用 `onComplete`
- [ ] 实现 JSON 解析失败时的 `repairAndParse` fallback
- [ ] 实现字段乱序 fallback：若 JSON 完成后仍未检测到 content marker，从解析结果中提取 content 一次性推送
- [ ] 编写单元测试：正常流式、字段乱序、JSON 解析失败、content 含转义引号

### 验收

- [ ] 正常情况下 content 字段能逐 token 输出
- [ ] 异常情况下不崩溃，降级为非流式输出

## 6. Phase 2：统一 LLM 调用

### 目标

用 `processInterviewTurnWithLLM` 替代原有 5 步串行调用。

### TODO

- [ ] 在 `llm-service` 中新增 `processInterviewTurnWithLLM()`
- [ ] 设计统一 prompt，覆盖：intent + questionType + score + followUpValidation + content
- [ ] prompt 中强调字段顺序，`content` 必须是最后一个字段
- [ ] prompt 中处理 `intent !== 'answer'` 时省略评分字段的逻辑
- [ ] 在 `turn-service` 中接入新调用 + `createContentStreamSplitter`
- [ ] 将证据检索 `buildEvidenceBundle` 移到 LLM 调用之前（当前已是，确认不变）
- [ ] 添加 feature flag，可切换新旧链路
- [ ] 保留旧函数（`classifyInterviewTurnIntent`、`enhanceEvaluationWithLLM`、`generateEvaluationNarration`）作为 fallback

### 修改文件

- [ ] `apps/api/src/interview/llm-service.js`
- [ ] `apps/api/src/interview/turn-service.js`

### 验收

- [ ] 正式回答主链路降到 1 次 LLM
- [ ] 非正式输入 1 次 LLM
- [ ] 前端仍能实时看到流式评价文本
- [ ] `result` 事件结构兼容现有前端
- [ ] feature flag 可切回旧链路

## 7. Phase 3：追问复用链路对接

### 目标

将面经库追问检索结果传入统一 LLM 调用做适用性验证。

### TODO

- [ ] 在 `follow-up-reuse.js` 中新增 `searchCandidateFollowUp()`：仅做 embedding 检索，不调用 LLM
- [ ] 在 `turn-service` 中：LLM 调用前检索候选追问，作为 `candidate_follow_up` 传入
- [ ] 在统一 prompt 中增加 `follow_up_validation` 输出字段
- [ ] LLM 调用后根据 `follow_up_validation.suitable` 决定：
  - `true` → `adaptFollowUp`（1 次轻量 LLM）→ 插入队列
  - `false` 且无其他候选 → `generateFollowUpQuestion`（1 次 LLM）→ 插入队列
  - `false` 且有其他候选 → 尝试下一个候选
- [ ] 验证面经追问复用率不下降

### 修改文件

- [ ] `apps/api/src/experience/follow-up-reuse.js`
- [ ] `apps/api/src/interview/turn-service.js`
- [ ] `apps/api/src/interview/llm-service.js`（prompt 调整）

### 验收

- [ ] 面经库有可用追问时，总 LLM 调用 ≤ 2 次
- [ ] 面经库无可用追问时，总 LLM 调用 ≤ 2 次
- [ ] 追问质量和当前一致

## 8. Phase 4：SSE 阶段语义收敛 + 清理

### 目标

收敛 SSE 阶段名，清理 deprecated 函数。

### TODO

- [ ] 统一 `stage.step` 为：`retrieval` / `evaluation` / `persist` / `planning`
- [ ] 将 route 层和 turn-service 中的旧阶段名替换
- [ ] 确认前端阶段展示逻辑兼容新值
- [ ] 删除 deprecated 函数：
  - `classifyInterviewTurnIntent`
  - `classifyQuestionType`（evidence-service）
  - `planRetrievalWithLLM`（evidence-service）
  - `enhanceEvaluationWithLLM` / `scoreAnswerWithRubricLLM`
  - `generateEvaluationNarration`
- [ ] 删除 feature flag（确认新链路稳定后）

### 修改文件

- [ ] `apps/api/src/routes/interview-routes.js`
- [ ] `apps/api/src/interview/turn-service.js`
- [ ] `apps/api/src/interview/llm-service.js`
- [ ] `apps/api/src/evidence-service.js`
- [ ] `apps/web/components/interview-session-room.tsx`（确认兼容）

### 验收

- [ ] 前端阶段展示不报错
- [ ] 代码库中不再存在 deprecated 函数
- [ ] 文档状态与代码一致

## 9. 回归验证清单

- [ ] 正式回答：流式评价正常输出
- [ ] 正式回答：结构化评分正确存库
- [ ] skip：题目标记 skipped，切换到下一题
- [ ] clarify：面试官回复正常
- [ ] meta：面试官回复正常
- [ ] invalid：提示用户给出可评分回答
- [ ] follow-up：面经库命中时正确插入
- [ ] follow-up：面经库未命中时正确生成
- [ ] SSE `token` / `result` / `done` 事件结构不变
- [ ] 首 token 时间相较基线有明显下降
- [ ] 回写 `docs/architecture/interview-orchestrator.md`
- [ ] 回写本清单阶段状态
