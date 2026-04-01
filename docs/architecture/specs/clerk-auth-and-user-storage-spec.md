# Clerk 认证与用户存储接入 Spec

> **当前状态：已完成。** 已通过 Clerk + Google Auth 实现，前端 `auth-provider.tsx` / `auth-status.tsx` / `viewer.ts` 全部落地，后端 `auth.js` 支持 Bearer token 验签，PostgreSQL `users` 表已上线，`/v1/me` 返回 viewer，OCR 配额与缓存已接入 `resume_parse_usage` / `resume_parse_cache`。对应实施清单见 `clerk-auth-implementation-plan.md`、`frontend-auth-migration-todolist.md`、`backend-auth-api-alignment-todolist.md`、`backend-production-hardening-todolist.md`。

- 版本：v0.1
- 日期：2026-03-24
- 状态：已完成

## 1. 背景

当前项目的用户身份仍基于前端运行配置中的 `userId`，由浏览器本地存储驱动。这个方案适合本地调试，但不适合 Railway 线上部署后的正式用户体系，主要问题包括：

1. `userId` 由前端传入，服务端无法把它当作可信身份。
2. OCR 次数、简历历史、面试记录无法稳定绑定到真实用户。
3. Railway 线上不适合继续把核心状态长期依赖本地 SQLite 文件和容器文件系统。
4. 后续要做“Google 登录 + 每日 OCR 配额 + 跨设备数据同步”，现有结构缺少认证层与业务用户层。

## 2. 目标

本次方案目标：

1. 接入 `Clerk + Google Auth`，提供正式登录能力。
2. 在前端引入独立的 `auth/viewer` 层，把认证和运行配置解耦。
3. 在后端建立可信用户识别链路，不再依赖前端传 `user_id` 作为最终真源。
4. 引入 PostgreSQL 作为线上持久化主库，承载用户、OCR 配额、OCR 缓存等业务数据。
5. 为后续简历 OCR 限额策略提供基础设施：`pdf/image` 每天 1 次，同文件 hash 命中缓存时不重复扣额。

## 3. 非目标

本次不做：

1. 不一次性重构全仓前端目录到 `src/features`。
2. 不在这一轮引入完整计费系统。
3. 不立即迁移所有历史 SQLite 数据。
4. 不实现多认证提供方并存，只先接 `Clerk + Google`。

## 4. 核心原则

1. 业务页面不直接依赖 `Clerk`。
2. 认证身份和业务用户不是一回事：`Clerk` 负责“你是谁”，PostgreSQL 负责“你做过什么”。
3. 前端只消费 `viewer`，不直接拼装业务身份。
4. 后端统一校验 token，并把当前用户解析为可信 `viewer`。
5. OCR 配额与缓存由服务端控制，前端只展示能力状态。

## 5. 当前代码架构上的接入策略

### 5.1 前端保持现有目录风格

当前前端以 App Router 路由为主，局部采用 `_components/_hooks/_lib` 分层。为了降低改造成本，本方案不要求立即大迁移目录，先在现有结构上新增基础设施层：

- 新增全局认证层：
  - `apps/web/components/auth-provider.tsx`
  - `apps/web/components/auth-status.tsx`
  - `apps/web/lib/auth.ts`
  - `apps/web/lib/viewer.ts`
- 保留现有页面模块：
  - `apps/web/app/interview/*`
  - `apps/web/app/resume/*`
- 保留现有共享层：
  - `apps/web/components/*`
  - `apps/web/lib/*`

### 5.2 后端保持能力模块拆分

当前后端仍以 `apps/api/src/server.js` 为路由入口，以 `db / resume / doc / retrieval / llm` 为能力模块。本方案先新增：

- `apps/api/src/auth.js`

用于承接：

1. Clerk token 校验
2. 当前认证用户解析
3. 后续 `requireAuth` 能力

## 6. 前端方案

### 6.1 新增 `auth` 基础层

#### 目标

把 `Clerk` 封装在少数基础文件中，避免业务页面直接依赖第三方 SDK。

#### 设计

前端统一使用以下概念：

1. `authUser`
   - Clerk 认证用户
   - 字段来自 Clerk，如 `clerk_user_id/email/name/avatar`

2. `viewer`
   - 你的业务用户
   - 字段来自后端 `/v1/me`
   - 额外包含 `plan/capabilities`

#### 职责拆分

`apps/web/lib/auth.ts`

1. 封装 Clerk 相关读写
2. 提供获取 token 的统一方法
3. 暴露轻量认证状态

`apps/web/lib/viewer.ts`

1. 请求 `/v1/me`
2. 统一拿到业务用户资料
3. 暴露 viewer 能力，如 OCR 剩余额度

`apps/web/components/auth-provider.tsx`

1. 在全局初始化 auth 状态
2. 登录后自动拉取 `/v1/me`
3. 将 `viewer` 提供给全站

`apps/web/components/auth-status.tsx`

1. 展示登录按钮或当前用户信息
2. 不承载业务逻辑

### 6.2 `runtime-config` 降级为环境配置层

当前 [`apps/web/components/runtime-config.tsx`](/Users/user/vscode/fementor/apps/web/components/runtime-config.tsx) 同时管理 `apiBase/userId/llm`，后续要调整为：

保留：

1. `apiBase`
2. `llmBaseUrl`
3. `llmApiKey`
4. `llmModel`

移除：

1. `userId`
2. `setUserId`
3. 与 `userId` 有关的 localStorage 行为

这样可以保证：

1. 本地调试能力还在
2. 用户身份不再由浏览器配置驱动

### 6.3 统一 API Client

[`apps/web/lib/api.ts`](/Users/user/vscode/fementor/apps/web/lib/api.ts) 需要升级为统一请求入口：

1. 自动注入 `Authorization: Bearer <token>`
2. 兼容 `FormData`
3. 统一处理 `401/403`
4. 支持 `/v1/me`、`/v1/resume/parse`、`/v1/interview/*` 等新接口

### 6.4 页面侧改造原则

页面不再自行维护 `userId`，而是从 `viewer` 读取身份和能力。

#### `/resume`

1. 未登录时：
   - 可允许粘贴文本
   - PDF/图片 OCR 默认禁用或提示登录后可用
2. 已登录免费用户：
   - 展示“PDF/图片智能解析每天 1 次”
3. 当日 OCR 超额时：
   - 引导改用 `DOCX` 或粘贴文本

#### `/interview`

1. 使用当前登录用户的 viewer 读取简历/JD/历史会话
2. 不再让前端主动传 `user_id`

## 7. 后端方案

### 7.1 新增认证层

新增 `apps/api/src/auth.js`，职责：

1. 从请求头读取 Bearer token
2. 调 Clerk 服务端能力校验 token
3. 解析 `clerk_user_id/email/name/avatar`
4. 提供统一的 `getRequestAuth(req)` 能力

### 7.2 新增 `GET /v1/me`

用途：

1. 校验当前登录态
2. 在业务库中 `upsert users`
3. 返回当前 viewer

建议返回结构：

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

### 7.3 现有接口的兼容迁移策略

短期策略：

1. 新接口优先使用登录态识别用户
2. 旧接口暂时兼容 `user_id`
3. 如果请求内有登录态，服务端以后端识别用户为准
4. 本地开发环境可保留 `DEV_FAKE_USER_ID`

后续逐步改造这些接口：

1. `/v1/resume/parse`
2. `/v1/resume/library`
3. `/v1/resume/select`
4. `/v1/jd/upload`
5. `/v1/jd/library`
6. `/v1/jd/select`
7. `/v1/interview/sessions/start`
8. `/v1/interview/*`
9. `/v1/chat/*`

## 8. 数据存储方案

### 8.1 线上主存储

Railway 线上主数据改为 PostgreSQL。

原因：

1. 容器文件系统不适合长期持久化关键业务数据
2. 后续会有真实用户、多设备、配额、缓存、套餐等结构化关系数据
3. PostgreSQL 更适合做业务主库

### 8.2 核心表

#### `users`

用途：业务用户表，映射 Clerk 用户。

建议字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid/text | 业务主键 |
| clerk_user_id | text unique | Clerk 用户 ID |
| email | text | 邮箱 |
| name | text | 用户名 |
| avatar_url | text | 头像 |
| plan | text | `free/pro` |
| created_at | timestamptz/text | 创建时间 |
| updated_at | timestamptz/text | 更新时间 |

#### `resume_parse_usage`

用途：OCR 配额流水。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid/text | 主键 |
| user_id | uuid/text | 关联 `users.id` |
| file_hash | text | 文件 hash |
| source_type | text | `pdf/image/docx/text` |
| engine | text | `volcengine/local/manual` |
| status | text | `success/failed/cached/blocked` |
| charged | boolean/int | 是否扣配额 |
| created_at | timestamptz/text | 创建时间 |

#### `resume_parse_cache`

用途：OCR 解析缓存。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid/text | 主键 |
| user_id | uuid/text nullable | 可选，便于统计来源用户 |
| file_hash | text unique | 文件 hash |
| source_type | text | `pdf/image/docx/text` |
| parsed_text | text | 解析后的正文 |
| summary | text | 摘要 |
| parse_meta | jsonb/text | 解析元信息 |
| created_at | timestamptz/text | 创建时间 |
| updated_at | timestamptz/text | 更新时间 |

### 8.3 OCR 限额规则

推荐免费版规则：

1. `DOCX/纯文本`：不限
2. `PDF/图片`：每天 1 次
3. 同一文件 hash 命中缓存：不扣额度
4. 平台错误导致解析失败：不扣额度

### 8.4 `/v1/resume/parse` 服务端流程

1. 校验登录态
2. 识别文件类型
3. 计算 `file_hash`
4. 查询 `resume_parse_cache`
5. 命中缓存则直接返回，不扣额
6. 若是 `docx/text`，直接走低成本解析
7. 若是 `pdf/image`，检查当日 `resume_parse_usage`
8. 如果当日已超额，返回业务错误
9. 若未超额，调用火山引擎 OCR
10. 成功后写入 `resume_parse_cache`
11. 写入 `resume_parse_usage`

## 9. 模块边界

### 9.1 前端

业务页面不允许直接：

1. import `@clerk/nextjs`
2. 自行拼接 `Authorization`
3. 把 `user_id` 当作可信身份使用

统一由：

1. `auth-provider`
2. `auth-status`
3. `api.ts`
4. `viewer.ts`

承担基础设施职责。

### 9.2 后端

业务模块不直接依赖原始 token 字符串。

统一由：

1. `auth.js`
2. `/v1/me`
3. user repository

把认证身份映射成业务用户。

## 10. 风险与注意事项

1. 本地开发与 Railway 线上会并存一段时间，需要保留开发降级能力。
2. SQLite 到 PostgreSQL 的迁移要分阶段，不建议和 Clerk 首次接入同时大规模改库。
3. `server.js` 当前较大，后续如果继续扩展认证与用户逻辑，需要逐步抽离路由与 service 层。
4. OCR 额度逻辑必须以后端为真源，前端只展示状态。

## 11. 实施 TODO 清单

### Phase 1：接入 Google 登录与全局认证基础设施

- [ ] 在 Railway / Clerk 控制台创建应用并启用 Google Auth。
- [ ] 配置前端环境变量：`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`。
- [ ] 配置后端环境变量：`CLERK_SECRET_KEY`。
- [ ] 在 [`apps/web/app/layout.tsx`](/Users/user/vscode/fementor/apps/web/app/layout.tsx) 接入 `ClerkProvider`。
- [ ] 新增 `apps/web/components/auth-provider.tsx`，承载登录态与 viewer 拉取。
- [ ] 新增 `apps/web/components/auth-status.tsx`，用于导航栏登录/退出展示。
- [ ] 在 [`apps/web/components/navbar.tsx`](/Users/user/vscode/fementor/apps/web/components/navbar.tsx) 接入 `AuthStatus`。

### Phase 2：前端身份与运行配置解耦

- [ ] 在 `apps/web/lib/auth.ts` 封装 Clerk 适配逻辑。
- [ ] 在 `apps/web/lib/viewer.ts` 封装 `/v1/me` 请求与 viewer 状态。
- [ ] 从 [`apps/web/components/runtime-config.tsx`](/Users/user/vscode/fementor/apps/web/components/runtime-config.tsx) 中移除 `userId` 相关状态与 localStorage。
- [ ] 在 [`apps/web/components/navbar.tsx`](/Users/user/vscode/fementor/apps/web/components/navbar.tsx) 的“运行配置”面板里移除 `User ID` 输入。
- [ ] 升级 [`apps/web/lib/api.ts`](/Users/user/vscode/fementor/apps/web/lib/api.ts) 为统一带 token 的 API Client。

### Phase 3：后端认证与 viewer 接口

- [ ] 新增 `apps/api/src/auth.js`，实现 Bearer token 读取与 Clerk 校验。
- [ ] 在 [`apps/api/src/server.js`](/Users/user/vscode/fementor/apps/api/src/server.js) 中新增 `GET /v1/me`。
- [ ] 建立“认证用户 -> 业务用户”的 `upsert users` 逻辑。
- [ ] 为本地开发保留 `DEV_FAKE_USER_ID` 或等价调试入口。

### Phase 4：PostgreSQL 接入

- [ ] 在 Railway 创建 PostgreSQL 实例。
- [ ] 配置 `DATABASE_URL`。
- [ ] 设计并创建 `users` 表。
- [ ] 设计并创建 `resume_parse_usage` 表。
- [ ] 设计并创建 `resume_parse_cache` 表。
- [ ] 评估现有 SQLite 表的保留策略：短期并行 / 中期迁移。

### Phase 5：业务接口迁移到登录态

- [ ] 将 `/v1/resume/library` 改为优先按登录态取用户。
- [ ] 将 `/v1/resume/select` 改为优先按登录态取用户。
- [ ] 将 `/v1/jd/*` 改为优先按登录态取用户。
- [ ] 将 `/v1/interview/sessions/start` 改为优先按登录态取用户。
- [ ] 将 `/v1/interview/*` 其他接口逐步移除对 `user_id` 的强依赖。
- [ ] 将 `/v1/chat/*` 改为优先按登录态取用户。

### Phase 6：OCR 配额与缓存上线

- [ ] 为 `/v1/resume/parse` 增加 `file_hash` 计算。
- [ ] 为 `/v1/resume/parse` 接入 `resume_parse_cache` 命中逻辑。
- [ ] 为 `/v1/resume/parse` 接入 `resume_parse_usage` 配额判断。
- [ ] 免费版规则定为：`pdf/image` 每天 1 次，`docx/text` 不限。
- [ ] 解析失败时区分“平台失败不扣额”和“用户输入问题”的处理规则。
- [ ] 前端 `/resume` 页面展示 OCR 剩余额度与降级提示。

### Phase 7：收尾与清理

- [ ] 清理仍直接读取 `userId` 的前端模块。
- [ ] 更新接口契约文档与数据库字段文档。
- [ ] 补充登录态、OCR 限额、缓存命中三类验收测试。
- [ ] 确认 Railway 线上环境变量、回调地址、域名配置全部正确。

## 12. 验收标准

1. 用户可通过 Google 登录进入系统。
2. 登录后 `/v1/me` 能返回稳定的 `viewer`。
3. 前端不再需要手填 `userId` 才能使用主流程。
4. Railway 线上核心用户数据不再依赖容器本地文件作为唯一真源。
5. `pdf/image` OCR 能按天限额，且同文件重复上传不重复扣额。
