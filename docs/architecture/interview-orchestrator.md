# 面试编排架构

- 版本：v1.0
- 日期：2026-03-17
- 状态：已接入并可用

## 1. 模块职责

面试编排模块负责把“简历 + JD + 题目队列 + 用户回答 + 检索证据 + 评分 + 追问 + 复盘”串成一条完整流程。

当前目标不是做多 agent 协作，而是在单服务内完成清晰、可追踪、可回放的面试流程。

## 2. 分层

### API 层

负责：

1. 接收会话启动、答题、结束、复盘请求。
2. 提供普通 JSON 接口与 SSE 流式接口。

核心入口：

- `POST /v1/interview/sessions/start`
- `GET /v1/interview/sessions/:session_id/questions`
- `POST /v1/interview/sessions/:session_id/turns`
- `POST /v1/interview/sessions/:session_id/turns/stream`
- `POST /v1/interview/sessions/:session_id/finish`
- `POST /v1/interview/sessions/:session_id/retrospect`

### 编排层

负责：

1. 会话开始时批量生成题目队列。
2. 每轮作答前执行规则预判与单轮分析。
3. 基于分析结果规划证据路径并执行检索。
4. 进行 rubric 评分与候选人可见评价生成。
5. 根据得分和弱项决定是否插入 `follow_up`。
6. 会话结束后聚合复盘并沉淀长期记忆。

### 能力层

依赖：

1. OpenAI-compatible LLM
2. Sirchmunk
3. 本地 `rg` / 文档读取
4. SQLite

## 3. 当前主流程

### 3.1 会话启动

`start session -> 生成题目队列 -> 返回 current_question`

特点：

1. 题目不是逐题临时生成，而是启动时先生成一批队列。
2. 顺序默认偏向真实一面流程：
   - 开场背景
   - JD 匹配
   - 项目深挖
   - 场景判断

### 3.2 每轮作答

当前线上答题链路：

1. `intent router`
2. `question_type router`
3. `evidence planner`
4. `retrieval`
5. `rubric scoring`
6. `evaluation narration`
7. `queue reconciliation`

目标整合链路见：

- `docs/architecture/specs/interview-turn-pipeline-optimization-spec.md`

目标方向：

1. 规则预判 `preclassify`
2. 单次 `turn analysis`
3. `retrieval`
4. 单次 `turn scoring`
5. `queue reconciliation`

### 3.3 追问插入

如果本轮满足弱回答条件：

1. 当前题不是 `follow_up`
2. 分数偏低或弱项明显
3. 当前主问题后还没有插入过追问

则系统会：

1. 生成 1 道 `follow_up`
2. 插到当前题之后
3. 优先推进到这道追问题

### 3.4 复盘

`retrospect` 阶段会：

1. 聚合各轮得分和优劣势
2. 回流题目到 `question_bank`
3. 生成 `long_term_memory`

## 4. Intent Router

当前支持：

- `answer`
- `clarify`
- `question_back`
- `skip`
- `meta`
- `invalid`

### 作用

不是所有输入都进入评分。

例如：

1. `answer`
   - 进入完整评分链路
2. `clarify/question_back/meta`
   - 只回复，不计分
3. `skip`
   - 标记当前题跳过并推进

## 5. Question Type Router

当前支持：

- `basic`
- `project`
- `knowledge`
- `scenario`
- `follow_up`

### 作用

题型决定：

1. 检索路径怎么规划
2. 评分重点是什么
3. 是否更偏向项目证据、知识证据或场景判断

## 6. 检索与评分

### 检索

当前不是把所有资料都扔给一个统一总结器，而是先按题型裁剪路径。

例如：

1. `basic`
   - JD 优先
2. `project/scenario`
   - JD + knowledge 文档
3. `knowledge`
   - knowledge 文档优先

说明：

1. `resume` 不再直接进入 Sirchmunk 检索。
2. `resume_summary` 只作为评分背景信息。

### 评分

当前采用四维 rubric：

1. `technical_depth`
2. `structure_clarity`
3. `evidence_grounding`
4. `role_fit`

评分完成后，还会生成自然语言评价文本供前端展示。

## 7. SSE 流式输出

面试回合作答默认优先走：

- `POST /v1/interview/sessions/:session_id/turns/stream`

当前 SSE 事件包括：

1. `meta`
2. `stage`
3. `token`
4. `result`
5. `error`

### 当前含义

- `stage`
  - 表示当前编排阶段，当前线上阶段仍偏细；目标会收敛为 `analysis / retrieval / evaluation / persist / planning`
- `token`
  - 表示评价文本的增量片段
- `result`
  - 表示本轮最终结果

## 8. 存储

### SQLite

结构化存储：

1. `interview_session`
2. `interview_question`
3. `interview_turn`
4. `question_bank`

### 文件系统与 memory

1. 用户资料原文仍在文件系统。
2. 长期记忆和部分辅助沉淀仍会写 markdown。

## 9. 当前已知边界

1. 当前仍是单服务编排，不是多 agent 协作。
2. 当前单轮正式回答仍会触发多次 LLM 串行调用，后续将按 spec 收敛到更少阶段。
3. 题目队列启动时一次生成，尚未做复杂动态重排。
4. SSE 现在主要流式输出评价文本，不是整条编排步骤的全量可视化。

## 10. 当前成功标准

当前面试编排链路的“成功”定义是：

1. 用户能稳定启动会话并获取题目队列。
2. 每轮回答能完成意图判断、题型识别、证据检索与评分。
3. 弱回答时能最小成本插入追问。
4. 会话结束后能产出复盘和长期记忆。
