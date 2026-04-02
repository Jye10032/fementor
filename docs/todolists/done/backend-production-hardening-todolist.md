# 后端生产化加固 Todo List

> **当前状态：已完成。** Phase 1-5 全部勾选完成，Clerk 验签、Supabase Postgres 接入、viewer 对齐、OCR 配额缓存落库、环境模板均已上线。

- 日期：2026-03-24
- 状态：已完成

## Phase 1：Clerk 正式验签

- [x] 安装 `@clerk/backend`
- [x] 优先使用 Clerk `verifyToken()` 验签 Bearer token
- [x] 保留开发环境的 payload decode 回退

## Phase 2：Supabase Postgres 基础接入

- [x] 安装 `pg`
- [x] 新增 `apps/api/src/postgres.js`
- [x] 初始化 `users`
- [x] 初始化 `resume_parse_usage`
- [x] 初始化 `resume_parse_cache`
- [x] `/health` 暴露 Postgres 配置状态

## Phase 3：viewer 与业务用户对齐

- [x] `/v1/me` 接入 Postgres `users` upsert
- [x] `viewer.id` 优先返回 Postgres `users.id`
- [x] `viewer.capabilities.remaining_resume_ocr_count` 支持读取 Postgres 统计

## Phase 4：OCR 配额与缓存落库

- [x] `resume_parse_cache` 提供按 `file_hash` 查询
- [x] `resume_parse_cache` 提供写入 / upsert
- [x] `resume_parse_usage` 提供 usage 写入
- [x] `/v1/resume/parse` 支持文件 hash、缓存命中、配额阻断
- [x] `/v1/resume/parse` 返回 `usage` 与 `cache_hit`

## Phase 5：环境模板

- [x] 新增 `apps/api/.env.example`
- [x] 补充 README 或部署说明中的 Clerk/Supabase 环境变量说明
