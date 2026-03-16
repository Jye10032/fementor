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

## 2026-03-12 v0.16

### 本次调整

1. 面试回合作答前新增 `intent router`，先判断输入属于 `answer/clarify/question_back/skip/meta/invalid` 哪一类。
2. 只有 `intent=answer` 才进入评分链路，避免把“反问面试官、问流程、要求解释题意”误判成可评分回答。
3. 评分从“规则层关键词/长度/证据数启发式”升级为“LLM rubric 评分为主，规则层仅作 fallback”。
4. rubric 固定四维：`technical_depth / structure_clarity / evidence_grounding / role_fit`。
5. 评分后新增第二步“最终评价生成”，后端把 rubric 结果转成自然语言评价文本，再以 SSE token 流式推给前端。
6. 前端不再先显示原始 JSON 再替换文案，只显示最终评价文本或非回答分支的面试官回复。
7. `skip` 分支会把当前题记为跳过并推进到下一题；`clarify/question_back/meta/invalid` 分支只回复，不计分、不推进。

### 当前链路

1. `classify intent`
2. `intent=answer` 时：
   - 检索简历/JD/用户资料
   - LLM rubric 评分
   - 生成自然语言评价
   - 写入 turn
   - 决定是否插入 follow_up 和下一题
3. `intent!=answer` 时：
   - 生成面试官回复
   - 视 intent 决定是否保留当前题或跳过当前题

### 这样做的原因

1. 之前所有输入都直接评分，更像“单次 LLM 调用”，不是一个有路由判断的面试 agent。
2. 关键词命中和证据数量只能做弱信号，不能直接代表回答质量。
3. 结构化 rubric 更适合内部存储和后续追问决策，但用户前台需要看到的是直接评价文本。

### 当前风险

1. 当前还是单 agent 多步骤编排，不是多 agent 协作；流程更清晰，但复杂场景的策略仍有限。
2. `intent router` 仍依赖 LLM 判断，后续可以继续叠加更细的规则校验和样本回放。
3. 非回答分支目前只做轻量回复，还没有接入更完整的会话策略树。

## 2026-03-13 v0.17

### 本次调整

1. 新增 `question_type router`，在 `intent=answer` 后继续识别 `basic/project/knowledge/scenario/follow_up`。
2. 面试评估链路的 Sirchmunk 检索改为显式走 `DEEP`，配合业务层先做题型路由和路径裁剪，优先提升项目题、场景题的证据召回质量。
3. 检索入口不再默认传整目录，而是按题型规划证据路径：
   - `basic`：活跃 JD
   - `project/scenario`：活跃 JD + 相关知识文档
   - `knowledge`：相关知识文档优先，必要时补充 JD
4. `resume` 不再作为检索源文件参与 Sirchmunk / 本地检索，只保留 `resume_summary` 作为评分和标准答案生成的背景信息。
5. rubric 评分 prompt 新增 `question_type` 和 `retrieval_plan`，要求 LLM 区分项目题、知识题、场景题的判分重点。
6. 单题练习与模拟面试两条评分链路统一复用这套“题型路由 + 证据规划 + rubric”流程。
7. 用户文档目录物理拆分为 `profile` 与 `knowledge` 两层：
   - `profile`：仅存 `resume/jd`
   - `knowledge`：仅存检索知识库文档
   读取逻辑保留对旧平铺目录的兼容，避免历史数据立即失效。

### 当前链路

1. `intent router`
2. `question_type router`
3. `evidence planner`
4. `sirchmunk/local/web evidence`
5. `LLM rubric scoring`
6. `自然语言评价生成`

### 这样做的原因

1. 之前 `sirchmunk` 在 `DEEP` 模式下会先做 `DocQA` 意图分流，自我介绍类问题容易被误判为整份资料 review。
2. 项目题不能只对齐简历，还要结合知识库判断方案是否合理，因此必须先做题型路由再规划证据源。
3. 评分应以“回答质量 + 证据支撑 + 项目/知识场景匹配”为主，而不是目录级总结或关键词命中。

### 当前风险

1. 题型识别仍是 LLM + fallback 混合判断，后续需要样本回放和命中统计。
2. `knowledge` 路由当前主要依赖文件名提示选知识文档，后续可升级为更细的文档索引。
3. WebSearch 仍是占位 fallback，尚未接入真实 provider。
