# 项目文档索引

- 版本：v1.0
- 日期：2026-03-17

## 目录约定

### `architecture/`

- 面向系统设计与技术方案。
- 关注“当前模块怎么实现、用了什么技术、边界在哪里”。
- 其中：
  - `architecture/specs/`：方向性方案、专题 spec。
  - `architecture/todolists/`：实施清单、任务清单、迁移 checklist。

### `pages/`

- 面向页面级文档。
- 关注“某个页面调用什么接口、展示什么状态、依赖哪些技术”。

### `api/`

- 面向接口契约与字段定义。
- 当前仍沿用根目录下的《最小API契约》与《数据库字段级设计》。

### `reports/`

- 面向排查记录、实验记录、问题分析。
- 这类文档不作为当前实现方案的唯一依据。

## 当前建议优先阅读

1. [项目架构设计](/Users/user/vscode/fementor/docs/项目架构设计.md)
2. [Clerk 认证与用户存储接入 Spec](/Users/user/vscode/fementor/docs/architecture/specs/clerk-auth-and-user-storage-spec.md)
3. [Clerk 认证与用户存储接入实施清单](/Users/user/vscode/fementor/docs/architecture/todolists/clerk-auth-implementation-plan.md)
4. [后端 Fastify 改造实施清单](/Users/user/vscode/fementor/docs/architecture/todolists/backend-fastify-migration-todolist.md)
5. [简历解析架构](/Users/user/vscode/fementor/docs/architecture/resume-parsing.md)
6. [面试编排架构](/Users/user/vscode/fementor/docs/architecture/interview-orchestrator.md)
7. [上下文与长期记忆架构](/Users/user/vscode/fementor/docs/architecture/context-and-memory.md)
8. [简历解析页](/Users/user/vscode/fementor/docs/pages/resume-page.md)
9. [模拟面试页](/Users/user/vscode/fementor/docs/pages/interview-page.md)
10. [模拟面试会话页优化 Spec](/Users/user/vscode/fementor/docs/pages/interview-session-optimization-spec.md)
11. [最小API契约](/Users/user/vscode/fementor/docs/最小API契约.md)

## 现有根目录文档说明

- [项目架构设计](/Users/user/vscode/fementor/docs/项目架构设计.md)：系统总览。
- [最小API契约](/Users/user/vscode/fementor/docs/最小API契约.md)：主要接口入口。
- [数据库字段级设计](/Users/user/vscode/fementor/docs/数据库字段级设计.md)：数据库结构。
- [prompt-模板](/Users/user/vscode/fementor/docs/prompt-模板.md)：提示词模板。
- [mvp-方案记录](/Users/user/vscode/fementor/docs/mvp-方案记录.md)：版本迭代记录。

## 维护规则

1. 技术现状优先写入 `architecture/` 或 `pages/`。
2. 排查过程与实验日志写入 `reports/`。
3. 当实现方案变化时，先更新技术文档，再补迭代记录。

## 提交格式

后续 commit message 统一使用以下格式：

```md
XX :xxxx
```

要求：

1. 冒号前后保留空格。
2. `XX` 表示本次提交的类型或模块。
3. `xxxx` 简要描述本次提交内容。

示例：

```md
Fix :resume storage invalid key
Docs :update runtime and storage notes
Feat :add local postgres health payload
```

## 当前环境变量约定

前后端认证与数据库接入当前使用以下关键变量：

- Web：
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `NEXT_PUBLIC_API_BASE`
- API：
  - `CLERK_SECRET_KEY`
  - `CLERK_JWT_KEY`
  - `DEV_FAKE_USER_ID`
  - `DATABASE_URL`
  - `PGSSL_DISABLE`

API 侧模板见 [apps/api/.env.example](/Users/user/vscode/fementor/apps/api/.env.example)。
