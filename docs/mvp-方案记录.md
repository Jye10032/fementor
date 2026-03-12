# MVP 方案记录

## 2026-03-09 v0.1 ~ v0.4

1. 建立 API 骨架、SQLite 持久化、简历解析、本地检索、memory 写入。
2. 新增统一检索入口与 sirchmunk 自动降级。

## 2026-03-09 v0.5

1. 引入面试会话模型：`interview_session`、`interview_turn`。
2. 新增会话接口：start / add turn / finish。
3. 新增复盘接口：`retrospect`，支持按会话聚合评分。
4. 新增题单沉淀表：`question_bank`，复盘后自动回流题目。

## 2026-03-09 v0.6

### 本次变更

1. `question_bank` 增加去重键：`user_id + chapter + question`。
2. 复盘沉淀新增插入/更新统计（new vs updated）。
3. 新增章节练习拉题接口：`GET /v1/practice/next`。
4. 新增题目复习状态接口：`POST /v1/question-bank/:id/review`。

### 当前风险

1. 复盘聚合规则仍是启发式，尚未接入 LLM 结构化分析。
2. 题目难度和标签仍基于规则映射，未引入历史表现自适应。
3. WebSearch 仍为占位返回，未接入真实 provider。

## 2026-03-09 v0.7

### 本次变更

1. 新增对话会话：`chat_session`、`chat_message`。
2. 新增非流式对话接口：`POST /v1/chat/sessions/:id/messages`。
3. 新增 SSE 流式接口：`POST /v1/chat/sessions/:id/messages/stream`。
4. 接入 OpenAI 兼容 LLM 客户端（支持 `OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL`）。
5. 未配置 API Key 时自动启用 mock 流式输出，方便本地联调。

### 当前风险

1. 对话历史长度尚未做 token 裁剪。
2. 生产场景需补充速率限制与鉴权。

## 2026-03-10 v0.8

### 本次变更

1. 模拟面试改为“启动时批量生成题目队列”，不再依赖前端逐题即时生成首题。
2. 新增 `interview_question` 表，记录题目顺序、来源、题型、难度、预期考点和状态。
3. `start session` 接口新增 `chapter/tech_stack/target_level` 入参，并返回 `queue_count/current_question`。
4. 新增 `GET /v1/interview/sessions/:session_id/questions` 用于会话页消费队列。
5. `turns` 接口支持 `question_id`，回答提交后自动返回 `next_question`。
6. 前端独立面试会话页改为按队列顺序答题，提交后自动推进到下一题。

### 当前风险

1. 题目队列生成仍是一次性批量生成，尚未根据中途回答动态重排后续题目。
2. 追问仍是单独 SSE 对话能力，未和题目队列做统一编排。
3. `interview_question.status=skipped` 还未开放前端操作入口。
## 2026-03-10 v0.9

### 本次调整

1. 面试题目队列继续保留“一次生成、按顺序推进”，但允许在弱回答后动态插入 1 道追问。
2. `interview_turn` 增加 `question_id`，把作答记录和原始队列题绑定起来。
3. `question_bank` 增加 `source_question_id/source_question_type/source_question_source`，保证复盘沉淀后还能回溯题目来源。
4. 前端面试页展示“系统已插入追问”的流程提示，并在右侧队列中区分 `follow_up`。

### 触发规则

1. 本轮分数 `< 70` 或存在明显 `weaknesses`。
2. 当前题不是 `follow_up`。
3. 同一主问题尚未插入过追问。

### 这样做的原因

1. 面试时需要即时深挖薄弱点，而不是等整场结束后再回到章节练习。
2. 章节题单必须知道题目原本来自基础题、项目题还是追问题，否则后续练习策略无法细分。
3. 这一版仍保持 MVP 复杂度，不引入多轮 agent 编排，只在现有队列上做最小增量。

## 2026-03-10 v0.10

### 本次调整

1. 修复 `sirchmunk` CLI 输出解析，过滤模型下载、缓存加载等运行日志。
2. `sirchmunk` 结果现在只接受结构化 JSON，不再把原始 stdout 文本块兜底当证据。
3. 避免下载日志、cache 日志被错误写入 `evidence_refs`，降低评分污染。

## 2026-03-10 v0.11

### 本次调整

1. `/interview` 入口改为“先选简历，再开始面试”。
2. 支持读取当前用户已有简历摘要与文件列表，也支持在入口页直接上传并解析新简历。
3. 面试会话页改成单一对话流：问题、用户回答、AI 评价、追问提示都在同一聊天区展示。
4. 去掉回答草稿预览，用户发送后再把消息写入对话。

## 2026-03-10 v0.12

### 本次调整

1. 补齐“活跃简历”概念：`user_profile.active_resume_file`。
2. 新增 `POST /v1/resume/select`，已有简历不再只是展示，而是可以真正切换为本场面试依据。
3. 面试对话区新增自动滚动，流式评价和新问题会自动滚到最新位置。
4. 当题目全部完成时，页面进入明确结束态，而不是只剩一个禁用输入框。

## 2026-03-10 v0.13

### 本次调整

1. 去掉面试页顶部重复题干，避免与聊天流中的问题内容重复。
2. 顶部改为轻量状态栏，只展示当前阶段、题型、难度和来源。
3. 继续压缩右侧信息噪音，保持“聊天区是主流程、侧栏是辅助信息”。

## 2026-03-11 v0.14

### 本次调整

1. 面试出题 prompt 从“泛化题队列生成”升级为“真实一面流程编排”。
2. 第一题固定强调开场自我介绍和代表性项目引入，不再直接进入抽象技术题。
3. 强化 JD 匹配题、项目深挖题、压力场景题的顺序约束，降低题目割裂感。
4. 新增追问 prompt 设计约束，要求追问必须紧扣上一题的薄弱点，而不是跳题。

## 2026-03-11 v0.15

### 本次调整

1. 复盘接口新增 `long_term_memory`，由 LLM 输出结构化长期记忆提炼结果。
2. 结构包含 `stable_strengths/stable_weaknesses/project_signals/role_fit_signals/recommended_focus`。
3. 当前先把长期记忆提炼结果返回给前端，并同步写入现有 markdown memory 日志。
