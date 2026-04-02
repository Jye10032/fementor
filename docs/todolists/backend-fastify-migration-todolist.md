# 后端 Fastify 改造实施清单

> **当前状态：进行中，约完成 50%。** Phase 0-1 已完成（Fastify 骨架 `app.js` + `start.js` 已建立），Phase 2-3 部分完成（error-handler 插件、简单路由已迁移），但 `server.js` 仍保留原生 `http.createServer` 入口，`formidable` 仍在 `package.json` 中，SSE 流式接口仍使用原生 `res.write()`，Phase 5-9（复杂业务路由、SSE 迁移、schema 补充、旧入口清理）尚未开始。

- 版本：v0.1
- 日期：2026-03-27
- 状态：进行中（约 50%）
- 目标：把 `apps/api` 从原生 Node `http.createServer` 迁移到 `Fastify`，优先替换基础设施层，保持现有业务 service 尽量不变

## 1. 使用方式

这份文档是实施清单，不是架构 spec。

使用原则：

1. 默认按 `Phase 0 -> Phase 9` 顺序推进，不建议跨阶段并行改造。
2. 第一阶段先搭新入口，不删除旧入口，确保随时可回滚。
3. SSE、文件上传、统一错误处理分开提交，不要和普通路由迁移混在同一个 commit。
4. service 层优先保持稳定，只在 route 和基础设施层做适配。

## 2. 当前代码基线

### 后端主入口与基础设施

- 路由主入口：
  - `apps/api/src/server.js`
- HTTP helper：
  - `apps/api/src/http.js`
- 请求上下文：
  - `apps/api/src/request-context.js`
- LLM 客户端：
  - `apps/api/src/llm.js`

### 后端业务 service

- 检索与证据：
  - `apps/api/src/evidence-service.js`
- 面试上下文：
  - `apps/api/src/interview-context-service.js`
- 面试 LLM 编排：
  - `apps/api/src/interview-llm-service.js`
- 面试提交流程：
  - `apps/api/src/interview-turn-service.js`
- 简历解析流程：
  - `apps/api/src/resume-parse-service.js`

### 当前路由分组

- `apps/api/src/routes/system-routes.js`
- `apps/api/src/routes/chat-routes.js`
- `apps/api/src/routes/document-routes.js`
- `apps/api/src/routes/interview-routes.js`
- `apps/api/src/routes/practice-routes.js`

## 3. 实施目标

本次改造拆成四个结果目标：

1. 用 `Fastify` 接管 API 启动、路由注册、CORS 和 multipart。
2. 保持现有业务 service 基本不动，减少迁移回归面。
3. 保留流式接口能力，不降低 chat/interview SSE 体验。
4. 让后续 schema 校验、插件化扩展和错误治理有明确落点。

阶段完成标准：

1. 新 Fastify 入口可在本地独立启动。
2. 非流式核心路由迁移后响应结构不变。
3. 上传接口和 SSE 接口迁移后行为不回退。
4. 旧原生 `server.js` 仅在最后阶段移除。

## 4. Phase 0：准备与依赖

### 目标

先把运行时依赖和迁移边界准备好，避免实现过程中反复返工。

### TODO

- [x] 安装 `fastify`
- [x] 安装 `@fastify/cors`
- [x] 安装 `@fastify/multipart`
- [x] 确认现有启动脚本、部署脚本、Railway 配置的入口点
- [x] 确认现有 SSE 接口列表
- [x] 确认现有 `multipart/form-data` 接口列表

### 验收

- [x] 本地依赖安装完成
- [x] 迁移范围和高风险接口清单已明确

## 5. Phase 1：建立 Fastify 应用骨架

### 目标

建立新的应用入口和启动入口，但不立刻切流量。

### 新增文件

- [x] `apps/api/src/app.js`
- [x] `apps/api/src/start.js`

### 文件级任务

#### `apps/api/src/app.js`

- [x] 创建 `Fastify()` 实例
- [x] 注册 `@fastify/cors`
- [x] 注册 `@fastify/multipart`
- [x] 注册统一错误处理 plugin
- [x] 注册所有 route 模块

#### `apps/api/src/start.js`

- [x] 读取 `PORT`
- [x] 调用 `app.listen()`
- [x] 统一启动日志输出

### 验收

- [x] 新入口可以在新端口启动
- [x] `/health` 至少能通过 Fastify 返回
- [ ] 旧入口仍可独立运行

## 6. Phase 2：迁移基础设施层

### 目标

把原生 `req/res` 绑定最强的基础设施逻辑迁到 Fastify 能力上。

### 新增文件

- [x] `apps/api/src/plugins/error-handler.js`
- [x] `apps/api/src/plugins/request-context.js`

### 修改文件

- [x] `apps/api/src/http.js`
- [ ] `apps/api/src/request-context.js`

### 文件级任务

#### `apps/api/src/plugins/error-handler.js`

- [x] 注册 `setErrorHandler`
- [x] 统一 4xx / 5xx JSON 响应格式
- [x] 对接现有业务错误结构

#### `apps/api/src/plugins/request-context.js`

- [x] 封装用户身份解析
- [x] 在请求生命周期中注入 viewer / userContext
- [ ] 避免每个 route 手动重复解析用户

#### `apps/api/src/http.js`

- [ ] 删除原生 HTTP 专属 CORS 处理
- [ ] 删除原生 body 读取逻辑
- [ ] 删除原生 multipart 解析逻辑
- [x] 保留纯函数级错误工具

#### `apps/api/src/request-context.js`

- [ ] 保留纯用户解析逻辑
- [ ] 去掉对原生 `req/res` 的直接耦合

### 验收

- [x] 全局错误格式稳定
- [ ] 登录态请求可以从 Fastify 生命周期中拿到用户上下文
- [ ] 基础 helper 不再依赖 `http.createServer`

## 7. Phase 3：迁移简单非流式路由

### 目标

先迁移最容易验证的普通路由，跑通“请求进入 -> service -> JSON 响应返回”的闭环。

### 优先顺序

1. `system-routes`
2. `document-routes` 中非上传接口
3. `practice-routes` 中纯 JSON 接口

### TODO

- [x] 把 `apps/api/src/routes/system-routes.js` 改成 Fastify route register 函数
- [x] 把 `apps/api/src/routes/document-routes.js` 中非上传接口改成 Fastify route
- [x] 把 `apps/api/src/routes/practice-routes.js` 中非流式接口改成 Fastify route
- [ ] 把 `json(...)` 迁移为 `reply.code(...).send(...)`
- [ ] 把路径参数读取迁移为 `request.params`
- [ ] 把 query/body 读取迁移为 `request.query` / `request.body`

### 验收

- [x] 简单 GET/POST 接口能通过 Fastify 工作
- [ ] 返回 JSON 结构与迁移前一致
- [ ] 旧前端无需改调用协议

## 8. Phase 4：迁移上传与 multipart 接口

### 目标

替换 `formidable`，把文件上传改成 Fastify multipart 方案。

### 高风险接口

- `POST /v1/resume/parse`
- 其他文档上传接口

### TODO

- [x] route 层改用 `@fastify/multipart`
- [x] route 层统一整理 `fields` 和 `file`
- [x] `resume-parse-service` 改成接收结构化入参，而不是原生请求对象
- [ ] 明确文件大小限制
- [ ] 明确允许的 MIME type / 扩展名

### 验收

- [ ] PDF 上传正常
- [ ] 非 PDF 上传规则稳定
- [ ] 解析接口响应结构不变

## 9. Phase 5：迁移复杂业务路由

### 目标

在普通路由跑通后，再迁移业务编排更重的接口。

### 优先顺序

1. `chat-routes` 的非流式接口
2. `interview-routes` 的非流式接口
3. 剩余需要 request context 的业务接口

### TODO

- [x] 迁移 chat session 创建与普通消息接口
- [ ] 迁移 interview session 启动、题单、完成、复盘接口
- [ ] 保持 service 层调用方式基本不变
- [ ] 清理 route 层里的原生 HTTP 兼容代码

### 验收

- [x] chat 非流式接口可用
- [ ] interview 非流式接口可用
- [ ] service 层无需大面积重写

## 10. Phase 6：迁移 SSE 与流式接口

### 目标

单独处理最容易出细节问题的流式响应。

### 高风险接口

- `POST /v1/chat/sessions/:id/messages/stream`
- `POST /v1/interview/sessions/:id/turns/stream`

### TODO

- [ ] 在 Fastify route 中设置 `text/event-stream`
- [ ] 用 `reply.raw.write(...)` 输出 SSE 帧
- [ ] 保留首帧、增量帧、完成帧、错误帧行为
- [ ] 正确处理客户端断开连接
- [ ] 验证上游 LLM 流中断时的收尾逻辑

### 验收

- [ ] 前端能持续收到 token/event
- [ ] 中途报错时连接能正确结束
- [ ] 断开连接不会留下悬挂任务

## 11. Phase 7：补充 schema 与约束

### 目标

开始真正吃到 Fastify 的结构化收益，而不只是“换一个 HTTP 框架”。

### TODO

- [ ] 为关键路由定义 `params` schema
- [ ] 为关键路由定义 `body` schema
- [ ] 为关键路由定义 `response` schema
- [ ] 优先覆盖 `resume/parse`、`chat`、`interview` 三类核心接口

### 验收

- [ ] 关键接口具有基础 schema
- [ ] 明显非法请求能被框架层提前拦截

## 12. Phase 8：联调、对照与切换

### 目标

在保留旧入口的情况下，对照验证 Fastify 版本行为。

### TODO

- [ ] 新旧服务分别跑在不同端口
- [ ] 对照关键接口的状态码、响应体、错误体
- [ ] 对照 SSE 行为
- [ ] 对照上传行为
- [ ] 确认部署入口切换方案

### 验收

- [ ] 关键接口对照通过
- [ ] 可以安全切换默认启动入口

## 13. Phase 9：清理遗留

### 目标

在 Fastify 版本稳定后，删除原生 HTTP 遗留实现。

### TODO

- [ ] 删除旧原生 `server.js` 入口逻辑
- [ ] 删除 `formidable`
- [ ] 删除不再使用的原生 HTTP helper
- [ ] 更新 README 和部署说明
- [ ] 回写阶段状态

### 验收

- [ ] 代码库只保留 Fastify 主入口
- [ ] 不再存在多套重复基础设施

## 14. 验证清单

- [ ] `health`、`viewer`、文档读取接口正常
- [ ] `resume/parse` 上传链路正常
- [ ] `chat` 非流式与流式接口正常
- [ ] `interview` 非流式与流式接口正常
- [ ] 认证上下文在所有受保护接口一致
- [ ] 错误响应结构一致

## 15. 推荐提交切分

1. `feat(api): scaffold fastify app entry and plugins`
2. `refactor(api): migrate basic json routes to fastify`
3. `refactor(api): migrate multipart upload routes to fastify`
4. `refactor(api): migrate sse routes to fastify`
5. `chore(api): remove native http server and formidable`
