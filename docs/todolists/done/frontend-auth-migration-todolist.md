# 前端认证迁移 Todo List

> **当前状态：已完成。** Phase 0-5 全部勾选完成，前端已从 `runtime-config.userId` 迁移到 `Clerk + viewer + Bearer token` 驱动。

- 日期：2026-03-24
- 状态：已完成
- 目标：把前端从 `runtime-config.userId` 驱动迁移到 `Clerk + viewer + Bearer token` 驱动，并与 `Supabase Postgres` 的后端用户体系对齐

## Phase 0：实施清单落盘

- [x] 建立分阶段实施清单
- [x] 每完成一个阶段后回写勾选状态

## Phase 1：全局认证基础设施

- [x] 在 `apps/web/app/layout.tsx` 接入 `ClerkProvider`
- [x] 新增 `apps/web/components/auth-provider.tsx`
- [x] 新增 `apps/web/components/auth-status.tsx`
- [x] 新增 `apps/web/lib/auth.ts`
- [x] 在导航栏接入登录态展示入口

## Phase 2：运行配置与 API Client 收敛

- [x] 从 `apps/web/components/runtime-config.tsx` 移除 `userId/setUserId`
- [x] 从 `apps/web/components/navbar.tsx` 的运行配置面板移除 `User ID`
- [x] 升级 `apps/web/lib/api.ts`，支持自动注入 Bearer token
- [x] 为 API Client 增加 `FormData`、匿名请求、`401/403` 处理能力

## Phase 3：viewer 层与 `/resume` 页面迁移

- [x] 新增 `apps/web/lib/viewer.ts`
- [x] 全局拉取 `/v1/me` 并缓存 viewer 状态
- [x] 改造 `apps/web/app/resume/page.tsx` 为登录态优先
- [x] 明确未登录时的简历页降级策略
- [x] 明确 `PDF` 上传必须登录，未登录时禁止触发 OCR 上传

## Phase 4：`/interview` 页面迁移

- [x] 改造 `apps/web/app/interview/page.tsx`
- [x] 改造 `apps/web/app/interview/_hooks/use-resume-panel.ts`
- [x] 改造 `apps/web/app/interview/_hooks/use-jd-panel.ts`
- [x] 改造 `apps/web/app/interview/_hooks/use-interview-history.ts`
- [x] 启动面试时不再由前端主动传可信 `user_id`

## Phase 5：剩余页面迁移与验证

- [x] 改造 `/practice` 页面移除 `user_id` 强依赖
- [x] 改造 `/bank` 页面移除 `user_id` 强依赖
- [x] 检查 `/resume/[filename]` 详情页的登录态读取
- [x] 构建前端并修复类型或编译错误
- [x] 回写所有阶段状态
