# Agent 化改造路线图

- 版本：v1.1
- 日期：2026-07-29
- 状态：方案讨论稿，尚未执行

## 0. 背景与目标

当前面试编排的设计目标（见 [面试编排架构](./interview-orchestrator.md)）明确写着"当前目标不是做多 agent 协作，而是在单服务内完成清晰、可追踪、可回放的面试流程"。这个定位本身是对的，2026 年行业共识也支持"能用 Workflow 就不上 Agent"。

但当前实现是**手写状态机 + 裸 fetch 调 LLM**，把本该由标准框架承担的能力（结构化输出、工具调用、流式协议、类型同步）全部自己实现了一遍，导致：

1. `retrieval/index.js` 的 `retrieveEvidence` 是空壳，README 承诺的"检索增强评分"没有真正接入评分链路。
2. `llm.js` 用正则从文本里挖 JSON（`extractJsonObject`），没有结构化输出保证。
3. `turn-service.js` 里 `submitInterviewTurnUnified`/`submitInterviewTurnLegacy` 两个 600+ 行的近似复制函数，阶段流转靠字符串比较。
4. 前端手写 200+ 行 SSE reader 解析逻辑（`interview-session-room.tsx`）。
5. 前后端字段类型（如 `TurnResponse`）在两侧手动重复定义，靠人肉保持同步。
6. Monorepo 是假的：根 `package.json` 只用 `concurrently` 拼接两个 `npm --prefix` 子进程，没有共享包。
7. UI 无组件库支撑，所有交互原语（Dialog/Drawer/Tabs）从零手搓。

本文档给出**低成本、分阶段、可随时停止**的改造路线，目标是把"手写自研"替换为"标准件"，而不是推翻现有编排逻辑去追多智能体这种当前业务场景并不需要的复杂度。

## 1. 调研结论摘要

### 1.1 Workflow vs Agent

| 维度 | Workflow（预定代码路径） | Agent（模型自主决策循环） |
| --- | --- | --- |
| 可靠性 / 成本 / 延迟 | 更优，可预测 | 易失控（无限循环、token 爆炸） |
| 灵活性 / 长尾覆盖 | 弱 | 强 |
| 适用场景 | 步骤可枚举、可硬编码 | 步骤数不可预知、开放式问题 |

2026 年共识：**"Workflow-first，Agent-where-needed，Guardrails-everywhere"**。fementor 的面试主流程（出题→答题→评分→追问→复盘）步骤确定，应继续保持 Workflow；只在真正需要模型自主判断的子任务（证据检索、追问决策）引入工具调用能力。

### 1.2 Agent 分级现状

行业三级框架：L1 工作流 Agent → L2 推理 Agent → L3 多智能体系统。**fementor 当前处于 L1**（结构化 Workflow，无真正自主决策）。合理路径是先补齐 L2 的"结构化工具调用"，再评估是否需要 L3 多智能体，不建议跳级。

### 1.3 技术选型

- **LLM 调用层**：OpenAI 官方 SDK（`openai` 包）。选择理由：官方维护、更新最快；原生支持 `baseURL` 自定义，与现有 `OPENAI_BASE_URL` 可配置 OpenAI-compatible 服务的机制完全兼容，不锁定 OpenAI 官方服务；比引入 Agent 框架更薄，只做 API client 这一件事，不引入额外的 Agent/UI 抽象层。
  - 权衡：多 provider 切换、Agent Loop（多轮工具调用循环）、前端流式 hook 均无现成封装，需要自己实现，但代码量可控（详见阶段 1、2）。
  - 阶段 2 的工具调用循环具体怎么写（手写 while 循环 / 引入轻量封装）暂不确定，待阶段 2 启动时再评估。
- **Monorepo**：pnpm workspace（依赖管理，解决幽灵依赖和版本漂移）+ Turborepo（任务编排与增量缓存，替代 `concurrently`）。
- **UI 组件**：shadcn/ui（源码级组件，与现有 Tailwind v4 + OKLCH design token 兼容）。前端流式渲染方案待定（见阶段 4）。

## 2. 分阶段实施方案

### 阶段 0：Monorepo 底座硬化（约 1 天，零风险）

- 引入 `pnpm-workspace.yaml`（`apps/*` + `packages/*`）与 `turbo.json`，替换根 `package.json` 里的 `concurrently` 拼接脚本。
- 新建 `packages/shared-types`，把前端 `apps/web/components/interview-session/types.ts` 与后端 `turn-service.js` 里重复定义的字段（如 `TurnResponse`、`InterviewTurnStageEvent`）收敛为一份 Zod schema，前后端共用同一个包。

不改动任何业务逻辑，只换依赖管理与任务编排基座。

### 阶段 1：LLM 调用层替换为 OpenAI 官方 SDK（约 3-5 天，低风险）

- 新建 `packages/agent-core`，用 `openai` 包的 `chat.completions.create()` 重写 `apps/api/src/llm.js` 里的 `chatCompletion`/`streamCompletion`/`jsonCompletion`，`baseURL`/`apiKey` 沿用现有 `getResolvedLlmConfig` 的运行时配置机制（含会话级 LLM 配置覆盖）。
- 用 `response_format: { type: 'json_schema', json_schema: {...} }`（配合 Zod 生成 JSON Schema，如 `zod-to-json-schema`）替代 `extractJsonObject` 的正则兜底提取，保证结构化输出。
- `streamCompletion` 用 `stream: true` + `for await` 遍历 chunk 重写，替代现有手写的 `reader.getReader()` + buffer 拼接逻辑；SDK 本身不提供现成的增量文本 helper，需要自行维护累积文本状态。
- 利用现有 `INTERVIEW_PIPELINE_VERSION` 环境变量做灰度对比，验证替换前后行为一致，暂不改动 `buildUnifiedTurnSystemPrompt` 的 prompt 内容。

### 阶段 2：检索与追问决策改造为 Tool Calling（约 1-2 周，中风险）

- 把空壳 `retrieval/index.js` 的 `retrieveEvidence` 和已有但游离的 `experience/recall.js` 的 `recallQuestionForKeyword` 封装为 OpenAI SDK 的 `tools` 参数（function calling schema）。
- 评分环节让模型自主决定是否调用检索工具补充证据，真正落地"检索增强评分"；多轮工具调用循环（模型返回 `tool_calls` → 执行对应函数 → 结果写回 `messages` → 再次请求，直到无新工具调用）需要手写，具体实现方式（直接写 `while` 循环，还是封装一个轻量 `runToolLoop` 辅助函数）留到本阶段启动时再确定。
- 追问逻辑（`shouldInsertFollowUp` + `follow_up_validation` 字段判断）改为模型显式调用 `insert_follow_up` 工具，决策过程从隐式 JSON 字段变为可审计的工具调用轨迹，并可加前置护栏（如一题最多追问 1 次）。

### 阶段 3：Orchestrator + Worker 拆分（可选，视业务需求触发）

**默认不做**，仅在明确需要以下场景时才启动：

- 多面试官会诊（技术面 / HR 面 / 主管面 Agent 各自独立提问与评分维度）。
- 追问链条需要支持多轮连续博弈（当前只支持插 1 层追问）。

若触发，把 `submitInterviewTurnUnified` 里揉合的"意图判断→题型分类→评分→追问决策→反馈生成"拆分为 1 个 Orchestrator + 若干 Worker（各自独立 system prompt + 工具集，仍基于 `openai` SDK 的 `tools` 机制实现调用），替代现在几百行的 prompt 拼接函数。

### 阶段 4：UI 层现代化（与阶段 1-2 并行，低风险，前端流式渲染方案待定）

- 引入 shadcn/ui，复用现有 `globals.css` 的 OKLCH design tokens，逐步替换 `interview-session/` 下手搓的 Drawer、Tabs 等交互原语，业务外壳不变。
- 前端流式渲染暂不改动（保留现有 `interview-session-room.tsx` 手写 SSE reader 逻辑），后续如需简化可考虑抽取自定义 hook 减少重复代码，具体方案留到本阶段启动时再定。
- 保持现有 `_components/_hooks/_lib` 分层规范（见 [apps/web/CONVENTIONS.md](../../apps/web/CONVENTIONS.md)）不变。

## 3. 优先级与成本收益

| 阶段 | 工作量 | 风险 | 收益 |
| --- | --- | --- | --- |
| 0. pnpm + Turborepo + 共享类型包 | 1 天 | 极低 | 消灭前后端类型漂移 |
| 1. LLM 层换 OpenAI 官方 SDK | 3-5 天 | 低（可双轨对比） | 省维护成本，结构化输出更可靠，不引入额外框架依赖 |
| 2. 检索 / 追问改为 Tool Calling | 1-2 周 | 中 | 兑现检索增强评分承诺，决策可审计 |
| 3. Orchestrator + Worker 拆分 | 1-2 周 | 中高，建议先不做 | 仅多面试官 / 深度追问链场景收益明显 |
| 4. shadcn/ui（前端流式渲染待定） | 与 1-2 并行 | 低 | UI 交互原语标准化 |

建议执行顺序：**0 → 1 → 4（并行）→ 2 →（视需求）3**。

## 4. 验证与回滚

- 阶段 1-2 均可复用现有 `INTERVIEW_PIPELINE_VERSION` 环境变量做新旧实现并行对比，出现回归可直接切回旧实现。
- 每阶段完成后需更新 [面试编排架构](./interview-orchestrator.md) 中"当前已知边界"章节，保持架构文档与实现同步。
