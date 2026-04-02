# 最小 API 契约

- 版本：v1.4
- 日期：2026-03-27

## 说明

当前接口契约进入“登录态优先，`user_id` 兼容迁移”的阶段：

1. 新接口默认基于 Bearer token 识别当前用户。
2. 旧接口短期仍兼容 `user_id`，但如果请求中带登录态，服务端应以后端识别的用户为准。
3. 最终目标是前端不再依赖手填 `userId`。

## GET /health

返回服务可用状态与数据库路径，并包含 LLM 配置状态（`llm.enabled/model/base_url`）。

## GET /v1/me

- 鉴权：必需登录。
- 用途：返回当前登录用户的业务 viewer，并触发 `users` 表的创建或更新。
- 响应：

```json
{
  "viewer": {
    "id": "biz_user_id",
    "auth_user_id": "user_xxx",
    "email": "user@example.com",
    "name": "Example User",
    "avatar_url": "https://...",
    "plan": "free",
    "capabilities": {
      "can_use_resume_ocr": true,
      "daily_resume_ocr_limit": 1,
      "remaining_resume_ocr_count": 1
    }
  }
}
```

## POST /v1/chat/sessions/start

- 请求：`{ "user_id": "u_001", "title": "可选" }`
- 用途：创建对话会话。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 仅作短期兼容。

## GET /v1/chat/sessions/:session_id/messages?limit=100

- 用途：读取会话消息历史。

## POST /v1/chat/sessions/:session_id/messages/stream

- 用途：SSE 流式对话（`text/event-stream`）。
- 事件：`meta`、`token`、`done`、`error`。

## POST /v1/resume/parse

- 鉴权：建议登录；未登录仅允许文本模式作为可选降级策略。
- 用途：解析简历文本，更新用户画像，并落盘到用户文档存储。
- 说明：
  - PDF/图片高成本解析受服务端 OCR 配额控制。
  - 同一文件 hash 命中缓存时直接复用结果，不重复扣额。
  - 返回新增可选字段 `parse_meta`，用于说明当前解析路径和 fallback 状态。
  - 推荐增加能力字段：
    - `parse_meta`
    - `usage`
    - `cache_hit`

### 推荐响应字段

```json
{
  "filename": "resume-frontend.md",
  "resume_text": "解析后的正文",
  "resume_summary": "摘要",
  "parse_meta": {
    "parser": "volcengine",
    "used_ocr": true,
    "quality": "good",
    "original_filename": "resume.pdf"
  },
  "usage": {
    "daily_resume_ocr_limit": 1,
    "remaining_resume_ocr_count": 0
  },
  "cache_hit": false
}
```

## GET /v1/resume/library?user_id=...

- 用途：读取当前用户已解析的简历画像和已上传简历文件列表。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。
- 响应：
  - `profile`
  - `files`
  - `has_resume`

## POST /v1/resume/select

- 请求：`{ "user_id": "u_001", "file_name": "resume-frontend.md" }`
- 用途：把某个已上传简历文件设为当前活跃简历，并重算 `resume_summary`。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。

## POST /v1/jd/upload

- 请求：`{ "user_id": "u_001", "filename": "jd-fe.md", "jd_text": "岗位描述..." }`
- 用途：保存一份 JD 文件，并把它设为当前活跃 JD。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。

## GET /v1/jd/library?user_id=...

- 用途：读取当前用户已保存 JD 列表和当前活跃 JD。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。
- 响应：
  - `profile.active_jd_file`
  - `files`
  - `has_jd`

## POST /v1/jd/select

- 请求：`{ "user_id": "u_001", "file_name": "jd-fe.md" }`
- 用途：把某个已上传 JD 文件设为当前活跃 JD。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。

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
- 迁移说明：
  - 新实现优先按登录态识别用户。
  - `user_id` 字段为短期兼容字段。
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
- 鉴权：推荐登录；按当前用户权限校验 session 归属。
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
- 鉴权：推荐登录；按当前用户权限校验 session 归属。
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
- 鉴权：推荐登录；按当前用户权限校验 session 归属。
- 响应：会话状态变为 `completed`。

## POST /v1/interview/sessions/:session_id/retrospect

- 用途：面试结束复盘，聚合各轮评分与上下文，自动沉淀题目到 `question_bank`。
- 鉴权：推荐登录；按当前用户权限校验 session 归属。
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
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。

### 迁移说明

该接口短期可继续保留，但长期应切换为：

1. `GET /v1/user-question-bank`
2. 由服务端内部把 `question_source + user_question_bank` 组装成练习页所需结构

## POST /v1/question-sources/promote

- 鉴权：推荐登录；本地模式可回退到默认本地用户。
- 用途：把面经题、模拟面试题、简历/JD 抽取题或手工题提升为公共题源。
- 请求：

```json
{
  "source_type": "experience",
  "source_ref_id": "exp_q_001",
  "canonical_question": "Promise 与 async/await 的作用及关系",
  "question_text": "Promise 的作用是什么？",
  "normalized_question": "Promise 的核心作用与 async/await 的关系是什么",
  "category": "javascript",
  "difficulty": "medium",
  "track": "frontend",
  "chapter": "javascript",
  "knowledge_points": ["promise", "async", "await"],
  "expected_points": ["异步流程控制", "Promise 与 async/await 的关系"]
}
```

- 响应：

```json
{
  "item": {
    "id": "qs_001",
    "source_type": "experience",
    "source_ref_id": "exp_q_001",
    "canonical_question": "Promise 与 async/await 的作用及关系"
  },
  "created": true
}
```

## POST /v1/user-question-bank

- 鉴权：推荐登录；本地模式可回退到默认本地用户。
- 用途：把某个公共题源加入当前用户题库。
- 请求：

```json
{
  "question_source_id": "qs_001",
  "track": "frontend",
  "chapter": "javascript",
  "source_channel": "experience"
}
```

- 响应：

```json
{
  "item": {
    "id": "uqb_001",
    "user_id": "u_001",
    "question_source_id": "qs_001",
    "review_status": "pending",
    "mastery_level": 0
  },
  "created": true
}
```

## GET /v1/user-question-bank?track=...&chapter=...&review_status=...&limit=...

- 鉴权：推荐登录；本地模式可回退到默认本地用户。
- 用途：读取当前用户题库。
- 响应：
  - `items`
  - `total`

## POST /v1/question-attempts

- 鉴权：推荐登录；本地模式可回退到默认本地用户。
- 用途：记录一次围绕用户题库题目的作答行为。
- 请求：

```json
{
  "user_question_bank_id": "uqb_001",
  "session_type": "practice",
  "session_id": "practice_001",
  "answer": "Promise 主要用于异步流程控制...",
  "score": 78,
  "strengths": ["提到了回调地狱"],
  "weaknesses": ["没有讲 Promise 状态"],
  "feedback": "需要补齐状态流转和错误处理",
  "mastered": false,
  "next_review_at": "2026-03-29T10:00:00.000Z"
}
```

- 响应：

```json
{
  "item": {
    "id": "qa_001",
    "user_question_bank_id": "uqb_001",
    "score": 78,
    "mastered": false
  }
}
```

## GET /v1/practice/next?user_id=...&chapter=...&limit=...&include_future=1

## POST /v1/experiences/sync

- 鉴权：建议登录；新实现优先按登录态识别用户。
- 用途：创建一条“同步面经”任务，并触发牛客抓取、近 7 日过滤、去重、LLM 清洗和入库流程。
- 请求：

```json
{
  "keyword": "前端 面经",
  "days": 7,
  "limit": 10
}
```

- 约束：
  - `days` MVP 固定只支持 `7`
  - `limit` MVP 最大为 `10`

- 响应：

```json
{
  "job_id": "exp_sync_xxx",
  "status": "pending"
}
```

## GET /v1/experiences/sync/:job_id

- 鉴权：建议登录；按当前用户权限校验任务归属。
- 用途：轮询同步任务状态。
- 响应：

```json
{
  "job": {
    "id": "exp_sync_xxx",
    "keyword": "前端 面经",
    "status": "running",
    "requested_limit": 10,
    "created_count": 3,
    "skipped_count": 2,
    "failed_count": 0,
    "started_at": "2026-03-27T12:00:00.000Z",
    "finished_at": null,
    "error_message": ""
  }
}
```

## GET /v1/experiences

- 鉴权：建议登录；如果支持游客模式，默认只返回当前会话可见数据。
- 用途：查询面经库列表。
- 建议参数：
  - `query`
  - `days`
  - `company`
  - `role`
  - `page`
  - `page_size`
  - `only_valid`
  - `sort`

- 推荐响应：

```json
{
  "items": [
    {
      "id": "exp_post_xxx",
      "title": "搜狐畅游前端实习面经",
      "source_platform": "nowcoder",
      "source_url": "https://www.nowcoder.com/discuss/xxx",
      "company_name": "搜狐畅游",
      "role_name": "前端实习",
      "interview_stage": "一面",
      "published_at": "2026-03-23T15:59:00.000Z",
      "summary": "……",
      "quality_score": 86,
      "question_group_count": 2,
      "question_item_count": 9
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 42
}
```

## GET /v1/experiences/:id

- 鉴权：建议登录。
- 用途：读取单条面经详情，包含原文、清洗版和问题簇。
- 推荐响应：

```json
{
  "item": {
    "id": "exp_post_xxx",
    "title": "搜狐畅游前端实习面经",
    "source_platform": "nowcoder",
    "source_url": "https://www.nowcoder.com/discuss/xxx",
    "author_name": "a股受害者",
    "company_name": "搜狐畅游",
    "role_name": "前端实习",
    "interview_stage": "一面",
    "published_at": "2026-03-23T15:59:00.000Z",
    "content_raw": "……",
    "content_cleaned": "……",
    "summary": "……",
    "quality_score": 86,
    "groups": [
      {
        "id": "exp_group_xxx",
        "topic_cluster": "JavaScript 异步编程模型",
        "canonical_question": "Promise 与 async/await 的作用及关系",
        "group_type": "chain",
        "items": [
          {
            "id": "exp_item_1",
            "question_text_raw": "Promise 的作用是什么",
            "question_text_normalized": "Promise 的核心作用与解决的问题是什么",
            "question_role": "main",
            "order_in_group": 1,
            "parent_item_id": null,
            "category": "JavaScript",
            "difficulty": "medium",
            "follow_up_intent": "clarify",
            "knowledge_points": ["异步编程", "回调地狱"]
          }
        ]
      }
    ]
  }
}
```

## POST /v1/interview/experience-retrieval/preview

- 鉴权：建议登录。
- 用途：在正式启动模拟面试前，预览当前 JD / 简历 / 关键词会召回哪些面经问题。
- 请求：

```json
{
  "keyword": "前端实习",
  "target_level": "intern",
  "job_description": "……",
  "resume_summary": "……",
  "limit": 10
}
```

- 响应：

```json
{
  "items": [
    {
      "id": "exp_item_1",
      "post_id": "exp_post_xxx",
      "question_text_normalized": "虚拟列表的实现原理是什么",
      "question_role": "main",
      "category": "前端性能",
      "score": 0.84,
      "source_post_title": "某厂前端实习面经"
    }
  ]
}
```

## POST /v1/interview/sessions/start

- 新增可选字段：
  - `use_experience_questions`
  - `experience_query`

- 推荐请求示例：

```json
{
  "target_level": "mid",
  "job_description": "可选，未传时回退到当前 active_jd_file",
  "use_experience_questions": true,
  "experience_query": "前端实习"
}
```

- 推荐新增响应字段：
  - `experience_question_count`
  - `queue_sources`

- 说明：
  - 当 `use_experience_questions=true` 时，服务端会在出题前先召回相关 `experience_question_item`
  - 召回结果作为额外题源混入当前问题队列

- 用途：获取可练习题（默认仅到期题）。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。

## POST /v1/question-bank/:id/review

- 用途：更新题目复习状态。

## GET /v1/users/:user_id/weaknesses

- 用途：查询用户薄弱项趋势。
- 迁移说明：
  - 长期应改为 `GET /v1/me/weaknesses` 或等价 viewer 下接口。

## GET /v1/attempts?user_id=...&limit=...

- 用途：查询单题评分历史。
- 迁移说明：
  - 新实现优先按登录态取用户。
  - `user_id` 参数后续将逐步废弃。

## 鉴权约定

### 请求头

登录态请求统一使用：

```http
Authorization: Bearer <token>
```

### 服务端规则

1. 如果请求携带 Bearer token，服务端优先按 token 解析当前用户。
2. 若同时传入 `user_id`，服务端以后端识别用户为准。
3. 仅在本地开发/调试阶段允许降级使用 `user_id`。

## 错误码建议

### 认证相关

1. `401 unauthorized`：未登录或 token 无效
2. `403 forbidden`：无权访问他人资源

### OCR 配额相关

1. `429 resume_ocr_quota_exceeded`：当天 PDF/图片 OCR 配额已用完
2. `400 unsupported_resume_file_type`：文件格式不支持
3. `422 resume_parse_failed`：解析失败，但不是认证或配额问题
