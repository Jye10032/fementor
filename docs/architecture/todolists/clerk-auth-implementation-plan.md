# Clerk 认证与用户存储接入实施清单

> **当前状态：已弃用（被更细粒度的清单取代）。** 本清单的内容已由 `frontend-auth-migration-todolist.md`、`backend-auth-api-alignment-todolist.md`、`backend-production-hardening-todolist.md` 分别承接并完成实施。本文件保留作为原始规划参考。

- 版本：v0.1
- 日期：2026-03-26
- 对应方案：
  - `docs/architecture/specs/clerk-auth-and-user-storage-spec.md`
  - `docs/数据库字段级设计.md`
  - `docs/最小API契约.md`

## 1. 使用方式

这份文档不是架构说明，而是实施落地清单。

使用原则：

1. 默认按 `Phase 0 -> Phase 6` 顺序推进，不建议跳步。
2. 每完成一个阶段，都需要验证“本地可跑 + Railway 配置可对齐”。
3. 没有完成 `/v1/me` 之前，不要大面积改业务页面。
4. 认证接入和 PostgreSQL 迁移不要在同一个 commit 里混做。

## 2. 现有代码基线

### 前端

- 全局入口：
  - `apps/web/app/layout.tsx`
- 顶部导航与运行配置：
  - `apps/web/components/navbar.tsx`
  - `apps/web/components/runtime-config.tsx`
- 请求工具：
  - `apps/web/lib/api.ts`
- 主要业务页面：
  - `apps/web/app/resume/page.tsx`
  - `apps/web/app/interview/page.tsx`
  - `apps/web/components/interview-session-room.tsx`

### 后端

- 路由主入口：
  - `apps/api/src/server.js`
- 当前数据库层：
  - `apps/api/src/db.js`
- 简历解析：
  - `apps/api/src/resume/parse.js`
  - `apps/api/src/resume/meta.js`
  - `apps/api/src/resume/index.js`

## 3. 实施目标

本次实施拆为两个大目标：

1. 建立 `Clerk + Viewer + Token` 的认证基础设施。
2. 建立 `PostgreSQL + users + OCR usage/cache` 的存储基础设施。

阶段完成标准：

1. 前端不再依赖手填 `userId`。
2. 新业务接口以后端登录态识别用户。
3. OCR 限额与缓存以后端数据库为真源。

## 4. Phase 0：准备与环境配置

### 目标

先把外部依赖准备好，避免写完代码后发现环境没配齐。

### TODO

- [ ] 在 Clerk 控制台创建应用。
- [ ] 开启 Google 登录。
- [ ] 配置 Google OAuth 回调地址。
- [ ] 在 Railway 项目中准备前端环境变量：
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- [ ] 在 Railway 项目中准备后端环境变量：
  - `CLERK_SECRET_KEY`
- [ ] 在 Railway 创建 PostgreSQL 实例。
- [ ] 配置 `DATABASE_URL`。
- [ ] 明确本地开发的 `.env` 和 Railway env 对应关系。

### 验收

- [ ] Clerk 控制台能看到应用和 Google provider。
- [ ] Railway 中已存在 PostgreSQL 服务和连接串。
- [ ] 前后端环境变量命名已定稿。

## 5. Phase 1：前端接入 ClerkProvider 和认证外壳

### 目标

先把前端“能登录、能展示当前登录态”做起来，但先不接业务 viewer。

### 新增文件

- [ ] `apps/web/components/auth-provider.tsx`
- [ ] `apps/web/components/auth-status.tsx`
- [ ] `apps/web/lib/auth.ts`

### 修改文件

- [ ] `apps/web/app/layout.tsx`
- [ ] `apps/web/components/navbar.tsx`

### 文件级任务

#### `apps/web/app/layout.tsx`

- [ ] 接入 `ClerkProvider`。
- [ ] 把后续自定义 `AuthProvider` 放到全局 provider 链路中。
- [ ] 保持现有 `RuntimeConfigProvider` 不被破坏。

#### `apps/web/components/auth-provider.tsx`

- [ ] 提供全局 auth context。
- [ ] 暴露：
  - `isSignedIn`
  - `isLoaded`
  - `authUser`
  - `getToken`
- [ ] 当前阶段先不负责 `/v1/me`。

#### `apps/web/components/auth-status.tsx`

- [ ] 未登录时显示 Google 登录入口。
- [ ] 已登录时显示头像、邮箱或昵称、退出入口。
- [ ] 不耦合业务 viewer 字段。

#### `apps/web/lib/auth.ts`

- [ ] 封装 Clerk 相关读取逻辑。
- [ ] 提供统一 token 获取方法。
- [ ] 避免业务页面直接 import `@clerk/nextjs`。

#### `apps/web/components/navbar.tsx`

- [ ] 引入 `AuthStatus`。
- [ ] 调整布局，避免和运行配置面板互相挤压。
- [ ] 保持现有 health check 逻辑可用。

### 验收

- [ ] 本地能看到登录入口。
- [ ] Google 登录后能显示当前用户信息。
- [ ] 退出登录后 UI 状态恢复。
- [ ] 业务页面此阶段不报错。

## 6. Phase 2：前端引入 Viewer 层并清理 userId

### 目标

把“认证用户”和“业务用户”拆开，让页面开始消费 `viewer`，而不是 `userId`。

### 新增文件

- [ ] `apps/web/lib/viewer.ts`

### 修改文件

- [ ] `apps/web/components/auth-provider.tsx`
- [ ] `apps/web/components/runtime-config.tsx`
- [ ] `apps/web/components/navbar.tsx`
- [ ] `apps/web/lib/api.ts`

### 文件级任务

#### `apps/web/lib/viewer.ts`

- [ ] 定义 `viewer` 类型。
- [ ] 实现 `/v1/me` 拉取逻辑。
- [ ] 暴露：
  - `viewer`
  - `viewerLoading`
  - `viewerError`
  - `refreshViewer`

#### `apps/web/components/auth-provider.tsx`

- [ ] 在登录态稳定后自动请求 `/v1/me`。
- [ ] 把 viewer 合并进 context。
- [ ] 提供统一 hook，例如 `useAuthViewer()`。

#### `apps/web/components/runtime-config.tsx`

- [ ] 删除 `userId` 状态。
- [ ] 删除 `setUserId`。
- [ ] 删除 `fementor.userId` localStorage。
- [ ] 保留 `apiBase + llm 配置`。

#### `apps/web/components/navbar.tsx`

- [ ] 从运行配置面板移除 `User ID` 输入框。
- [ ] 保留 `API Base` 和 LLM 相关配置。

#### `apps/web/lib/api.ts`

- [ ] 支持自动带 token。
- [ ] 保持 `FormData` 请求兼容。
- [ ] 统一处理 401。
- [ ] 为未来后端 viewer 接口留出扩展位。

### 验收

- [ ] 前端不再出现 `User ID` 输入框。
- [ ] 登录后能拿到 viewer。
- [ ] 未登录时 viewer 为 `null`，页面能优雅降级。

## 7. Phase 3：后端接入认证解析和 `/v1/me`

### 目标

建立服务端可信身份识别链路，让后端能从 token 解析当前用户。

### 新增文件

- [ ] `apps/api/src/auth.js`

### 修改文件

- [ ] `apps/api/src/server.js`
- [ ] `apps/api/src/db.js`

### 文件级任务

#### `apps/api/src/auth.js`

- [ ] 实现 Bearer token 读取。
- [ ] 接入 Clerk 服务端校验。
- [ ] 返回统一结构：
  - `authUserId`
  - `email`
  - `name`
  - `avatarUrl`
- [ ] 提供 `getRequestAuth(req)`。
- [ ] 提供本地开发降级入口：
  - `DEV_FAKE_USER_ID`

#### `apps/api/src/db.js`

- [ ] 补充业务用户读写能力，至少包含：
  - `getUserByClerkUserId`
  - `upsertAuthUser`
- [ ] 在本阶段可先继续走 SQLite 占位实现，避免和 PostgreSQL 一次耦合。

#### `apps/api/src/server.js`

- [ ] 新增 `GET /v1/me`。
- [ ] 在 `/v1/me` 中：
  - 校验 token
  - `upsert` 业务用户
  - 返回 viewer
- [ ] 保证未登录返回 401。

### 验收

- [ ] 登录后调用 `/v1/me` 能得到稳定响应。
- [ ] 未登录调用 `/v1/me` 返回 401。
- [ ] 本地开发可在无 Clerk 的情况下用降级方式跑通联调。

## 8. Phase 4：PostgreSQL 接入业务用户和 OCR 表

### 目标

把线上正式用户体系和 OCR 状态迁到 PostgreSQL。

### 修改文件

- [ ] `apps/api/src/db.js` 或等价新建 PostgreSQL 数据访问模块
- [ ] `apps/api/package.json`

### 文件级任务

#### 数据层

- [ ] 决定 PostgreSQL 接入方式：
  - 直接扩展 `db.js`
  - 或新增独立 `pg` repository 模块
- [ ] 创建 `users` 表。
- [ ] 创建 `resume_parse_usage` 表。
- [ ] 创建 `resume_parse_cache` 表。
- [ ] 创建必要索引。

#### 用户同步

- [ ] `/v1/me` 改为写入 PostgreSQL `users`。
- [ ] viewer 从 PostgreSQL 读取 `plan/capabilities`。

### 推荐最小验收 SQL 能力

- [ ] 能按 `clerk_user_id` 查用户。
- [ ] 能 `upsert users`。
- [ ] 能按 `user_id + date` 查询 OCR 使用次数。
- [ ] 能按 `file_hash` 命中缓存。

### 验收

- [ ] Railway 线上可连接 PostgreSQL。
- [ ] 登录后 `users` 表有真实数据写入。
- [ ] 本地与线上数据访问逻辑不会互相覆盖。

## 9. Phase 5：业务接口迁移到登录态

### 目标

让简历、JD、面试、聊天逐步摆脱前端传 `user_id`。

### 修改文件

- [ ] `apps/web/app/resume/page.tsx`
- [ ] `apps/web/app/interview/page.tsx`
- [ ] `apps/web/app/interview/_hooks/use-resume-panel.ts`
- [ ] `apps/web/app/interview/_hooks/use-jd-panel.ts`
- [ ] `apps/web/app/interview/_hooks/use-interview-history.ts`
- [ ] `apps/web/components/interview-session-room.tsx`
- [ ] `apps/api/src/server.js`

### 文件级任务

#### 前端页面

- [ ] `/resume` 页面改为从 viewer 驱动。
- [ ] `/interview` 页面不再从 runtime config 读取 `userId`。
- [ ] 面试会话页所有请求走带 token 的 `api.ts`。

#### 前端 hooks

- [ ] `use-resume-panel` 去掉对外部 `userId` 的硬依赖。
- [ ] `use-jd-panel` 去掉对外部 `userId` 的硬依赖。
- [ ] `use-interview-history` 去掉对外部 `userId` 的硬依赖。

#### 后端接口

- [ ] `/v1/resume/library` 优先按登录态识别用户。
- [ ] `/v1/resume/select` 优先按登录态识别用户。
- [ ] `/v1/jd/*` 优先按登录态识别用户。
- [ ] `/v1/interview/sessions/start` 优先按登录态识别用户。
- [ ] `/v1/chat/*` 优先按登录态识别用户。
- [ ] 短期保留 `user_id` 兼容逻辑。

### 验收

- [ ] 业务主流程在登录态下不再依赖前端 `userId`。
- [ ] 旧本地调试流仍可跑通。
- [ ] 页面刷新后用户历史仍能正常读取。

## 10. Phase 6：OCR 配额与缓存接入

### 目标

实现“平台托管 OCR key + 服务端限额 + 同文件缓存复用”的完整链路。

### 修改文件

- [ ] `apps/api/src/server.js`
- [ ] `apps/api/src/resume/parse.js`
- [ ] `apps/api/src/resume/meta.js`
- [ ] `apps/web/app/resume/page.tsx`

### 文件级任务

#### 后端解析链路

- [ ] 在 `/v1/resume/parse` 中计算 `file_hash`。
- [ ] 查询 `resume_parse_cache`。
- [ ] 命中缓存则直接返回结果。
- [ ] `docx/text` 继续走低成本解析。
- [ ] `pdf/image` 先检查 `resume_parse_usage`。
- [ ] 超额时返回业务错误：
  - `429 resume_ocr_quota_exceeded`
- [ ] 成功解析后写入：
  - `resume_parse_cache`
  - `resume_parse_usage`

#### 前端 `/resume`

- [ ] 展示 OCR 剩余额度。
- [ ] 登录用户展示“PDF/图片智能解析每天 1 次”。
- [ ] 超额时显示降级提示：
  - 改用 `DOCX`
  - 改用粘贴文本
- [ ] 命中缓存时可提示“已复用上次解析结果”。

### 验收

- [ ] 同一 PDF 二次上传不重复扣额。
- [ ] 免费用户当天第二次上传 PDF/图片时被正确拦截。
- [ ] `DOCX/文本` 不受 OCR 限额影响。
- [ ] 平台错误导致的解析失败不错误扣额。

## 11. 横切约束

### 11.1 前端

- [ ] 业务页面不直接 import `@clerk/nextjs`。
- [ ] 业务页面不自行拼接 Authorization。
- [ ] `runtime-config` 不再承载用户身份。

### 11.2 后端

- [ ] 业务路由不直接信任前端传的 `user_id`。
- [ ] OCR 配额判断以后端数据库为真源。
- [ ] Railway 环境变量与本地 `.env` 命名保持一致。

## 12. 推荐实施顺序

1. 先做 Phase 0，确认外部环境全部齐备。
2. 再做 Phase 1，让前端先有登录外壳。
3. 再做 Phase 2 和 Phase 3，打通 `/v1/me`。
4. 再做 Phase 4，切入 PostgreSQL。
5. 再做 Phase 5，把业务接口逐步迁到登录态。
6. 最后做 Phase 6，上 OCR 配额和缓存。

## 13. 建议拆分为独立 PR 的粒度

### PR 1：认证外壳

- `ClerkProvider`
- `AuthProvider`
- `AuthStatus`
- `Navbar` 接入登录入口

### PR 2：Viewer 与 `/v1/me`

- `viewer.ts`
- `api.ts` token 注入
- `/v1/me`
- 本地开发降级

### PR 3：PostgreSQL 用户表

- `users`
- viewer 持久化

### PR 4：业务接口迁移

- `/resume`
- `/interview`
- `/chat`

### PR 5：OCR 配额与缓存

- `resume_parse_usage`
- `resume_parse_cache`
- `/v1/resume/parse`

## 14. 最终验收清单

- [ ] 用户可通过 Google 登录进入系统。
- [ ] 前端不再要求手动输入 `userId`。
- [ ] `/v1/me` 能返回稳定 viewer。
- [ ] Railway 线上用户数据进入 PostgreSQL。
- [ ] OCR 配额按用户和自然日生效。
- [ ] 同文件缓存可复用，不重复扣额。
- [ ] 主流程 `/resume -> /interview -> /chat` 在登录态下全部可用。
