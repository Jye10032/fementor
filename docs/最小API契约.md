# 最小 API 契约

- 版本：v1.1
- 日期：2026-03-11

## GET /health

返回服务可用状态与数据库路径，并包含 LLM 配置状态（`llm.enabled/model/base_url`）。

## POST /v1/chat/sessions/start

- 请求：`{ "user_id": "u_001", "title": "可选" }`
- 用途：创建对话会话。

## GET /v1/chat/sessions/:session_id/messages?limit=100

- 用途：读取会话消息历史。

## POST /v1/chat/sessions/:session_id/messages/stream

- 用途：SSE 流式对话（`text/event-stream`）。
- 事件：`meta`、`token`、`done`、`error`。

## POST /v1/resume/parse

- 用途：解析简历文本，更新 `user_profile.resume_summary`，并落盘到 `data/user_docs`。

## GET /v1/resume/library?user_id=...

- 用途：读取当前用户已解析的简历画像和已上传简历文件列表。
- 响应：
  - `profile`
  - `files`
  - `has_resume`

## POST /v1/resume/select

- 请求：`{ "user_id": "u_001", "file_name": "resume-frontend.md" }`
- 用途：把某个已上传简历文件设为当前活跃简历，并重算 `resume_summary`。

## POST /v1/jd/upload

- 请求：`{ "user_id": "u_001", "filename": "jd-fe.md", "jd_text": "岗位描述..." }`
- 用途：保存一份 JD 文件，并把它设为当前活跃 JD。

## GET /v1/jd/library?user_id=...

- 用途：读取当前用户已保存 JD 列表和当前活跃 JD。
- 响应：
  - `profile.active_jd_file`
  - `files`
  - `has_jd`

## POST /v1/jd/select

- 请求：`{ "user_id": "u_001", "file_name": "jd-fe.md" }`
- 用途：把某个已上传 JD 文件设为当前活跃 JD。

## POST /v1/retrieval/query-plan

- 用途：根据 `question + resume_summary` 生成检索关键词分组。

## POST /v1/retrieval/search

- 用途：统一检索入口（默认直走 sirchmunk；仅在显式 `strategy=local` 时才走本地 rg；证据不足触发 fallback 信息）。

## POST /v1/scoring/evaluate

- 用途：单题评分并落库到 `attempt/evidence/score/weakness`，同时写 memory。
- 当前链路：
  - `intent` 不参与单题练习
  - 服务端会先做 `question_type` 识别
  - 再按题型规划证据路径并走统一检索
  - 评分阶段固定使用 evidence-based rubric
- 响应新增字段：
  - `resolved_question_type`
  - `question_type_reason`

## POST /v1/interview/sessions/start

- 请求：
```json
{
  "user_id": "u_001",
  "target_level": "mid",
  "job_description": "可选，未传时回退到当前 active_jd_file"
}
```
- 用途：创建面试会话，并在后端一次性生成题目队列。
- 说明：
  - 若前端未传 `job_description`，服务端会尝试读取 `user_profile.active_jd_file` 对应内容作为本场 JD。
  - 题目顺序默认按“开场自我介绍 -> JD 匹配 -> 项目深挖 -> 场景追问”生成。
- 响应新增字段：
  - `interview_mode = resume_jd`
  - `job_description_present`
  - `target_level`
  - `queue_count`
  - `current_question`

## GET /v1/interview/sessions/:session_id/questions

- 用途：读取本场面试的题目队列。
- 响应：
  - `items`: 全量题目队列
  - `current_question`: 当前待回答题目

## POST /v1/interview/sessions/:session_id/turns

- 请求：
```json
{
  "question_id": "q_xxx",
  "question": "可选，前端可冗余传递",
  "answer": "用户回答",
  "evidence_refs": []
}
```
- 用途：提交当前队列题目的回答并评分。
- 当前链路：
  - `intent router`
  - `question_type router`
  - `evidence planner`
  - `rubric scoring`
  - `evaluation narration`
- 响应新增字段：
  - `question_id`
  - `resolved_question_type`
  - `question_type_reason`
  - `feedback`
  - `next_question`
  - `next_question.question_type = follow_up` 时，表示本轮弱项触发了即时追问
  - 服务端会把本轮 `question_id` 写入 `interview_turn.question_id`

## POST /v1/interview/sessions/:session_id/finish

- 请求：`{ "summary": "可选" }`
- 响应：会话状态变为 `completed`。

## POST /v1/interview/sessions/:session_id/retrospect

- 用途：面试结束复盘，聚合各轮评分与上下文，自动沉淀题目到 `question_bank`。
- 响应新增字段：
  - `promoted_questions`
  - `promoted_new_questions`
  - `promoted_updated_questions`
  - `long_term_memory`
  - 回流题目会保留 `source_question_id/source_question_type/source_question_source`

### `long_term_memory` 结构

```json
{
  "stable_strengths": [],
  "stable_weaknesses": [],
  "project_signals": [],
  "role_fit_signals": [],
  "recommended_focus": []
}
```

- 说明：
  - 由复盘阶段的 LLM 结构化提炼生成
  - 用于把本场短期上下文转成可跨场次复用的长期结论

## GET /v1/question-bank?user_id=...&chapter=...&limit=...

- 用途：查询沉淀题单，用于章节练习拉题。

## GET /v1/practice/next?user_id=...&chapter=...&limit=...&include_future=1

- 用途：获取可练习题（默认仅到期题）。

## POST /v1/question-bank/:id/review

- 用途：更新题目复习状态。

## GET /v1/users/:user_id/weaknesses

- 用途：查询用户薄弱项趋势。

## GET /v1/attempts?user_id=...&limit=...

- 用途：查询单题评分历史。
