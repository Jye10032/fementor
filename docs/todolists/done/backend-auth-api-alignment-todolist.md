# 后端认证与 API 对齐 Todo List

> **当前状态：已完成。** Phase 0-5 全部勾选完成，所有业务接口已支持 Bearer token 优先的用户识别。

- 日期：2026-03-24
- 状态：已完成
- 目标：让 `apps/api` 支持 Bearer token 优先的用户识别，与前端新的 `Clerk + viewer` 接入方式对齐

## Phase 0：实施清单落盘

- [x] 建立分阶段实施清单

## Phase 1：认证解析基础设施

- [x] 新增 `apps/api/src/auth.js`
- [x] 在服务端加入 Bearer token 解析能力
- [x] 定义“Bearer token 优先，`user_id` 兼容回退”的统一用户解析规则

## Phase 2：viewer 与基础身份接口

- [x] 新增 `GET /v1/me`
- [x] 返回统一 `viewer` 结构
- [x] 登录态下自动补齐本地用户画像记录

## Phase 3：档案相关接口对齐

- [x] `/v1/resume/parse` 支持登录态优先
- [x] `/v1/resume/library`
- [x] `/v1/resume/select`
- [x] `/v1/resume/read`
- [x] `/v1/jd/upload`
- [x] `/v1/jd/library`
- [x] `/v1/jd/select`
- [x] 明确 `PDF` 上传必须登录

## Phase 4：面试与练习接口对齐

- [x] `/v1/scoring/evaluate`
- [x] `/v1/interview/sessions`
- [x] `/v1/interview/sessions/start`
- [x] `/v1/interview/sessions/:id/questions`
- [x] `/v1/interview/sessions/:id/turns/stream`
- [x] `/v1/interview/sessions/:id/finish`
- [x] `/v1/interview/sessions/:id/retrospect`
- [x] `/v1/question-bank`
- [x] `/v1/practice/next`

## Phase 5：验证与回写

- [x] 启动后端做一次基本检查
- [x] 回写所有阶段状态
