# fementor

题驱动前端面试练习系统（MVP）。

## 目标

- 支持用户上传文档（简历/学习笔记/项目文档）。
- 本地检索优先（sirchmunk/rga），证据不足时再 WebSearch。
- 对练习与模拟面试进行评分，沉淀用户薄弱项和优缺点。
- 使用 Markdown + 结构化数据做可追溯 memory。
- 支持对话式 LLM 与 SSE 流式输出。

## 项目结构

- `apps/api`：后端 API（MVP 骨架）
- `apps/web`：Next.js 前端（参考 frontend-roadmap-agent 布局风格）
- `docs`：需求、架构、API、DB、迭代日志
- `data/user_docs`：用户上传文档（本地）
- `data/memory`：用户 Markdown memory

## 启动

```bash
npm install
npm run dev
```

默认会同时启动：

- API：`http://localhost:3300`
- Web：`http://localhost:3000`

如需单独启动：

```bash
npm run dev:api
npm run dev:web
```

页面入口：

- `/`：总览
- `/resume`：简历解析
- `/interview`：模拟面试会话
- `/bank`：题单管理
- `/practice`：章节练习拉题

## 当前数据库

- 本地 SQLite：`data/fementor.db`

## LLM 配置（可选）

后端会自动读取 `apps/api/.env`。

- `OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）
- `OPENAI_API_KEY`
- `OPENAI_MODEL`（默认 `gpt-4o-mini`）

未配置 `OPENAI_API_KEY` 时，聊天接口自动返回 mock 文本/流，便于前后端联调。

当前已经接入 LLM 的链路：

- `/v1/resume/parse`：优先使用 LLM 生成简历摘要，失败时回退规则摘要
- `/v1/scoring/evaluate`：分数仍走规则评分，优点/缺点/反馈优先使用 LLM 重写
- `/v1/chat/sessions/*`：对话与 SSE 流式输出

## 检索策略（当前）

1. `POST /v1/retrieval/search` 为统一入口。
2. 后端通过统一检索适配层输出 `query_plan / evidence_refs / strategy / need_fallback`。
3. 默认 `strategy=auto`：先本地 `rg`，证据不足时再尝试 `sirchmunk`。
4. 若本地证据仍不足，则返回 `web_fallback`（默认关闭，设置 `ENABLE_WEBSEARCH=1` 开启占位模式）。

当前上层业务只依赖统一返回结构，不依赖 `sirchmunk` 的 `FAST/DEEP/primary/fallback` 等内部概念。

可选的 `sirchmunk` 环境变量：

- `SIRCHMUNK_BIN`：命令路径，默认 `sirchmunk`
- `SIRCHMUNK_MODE`：搜索模式，默认 `FAST`

可通过 `GET /health` 查看当前 `llm` 与 `sirchmunk` 状态。
