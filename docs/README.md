# 项目文档索引

- 版本：v1.2
- 日期：2026-10-10

## 目录约定

### `architecture/`

- 面向系统设计与技术方案。
- 关注“当前模块怎么实现、用了什么技术、边界在哪里”。
- 其中：
  - `architecture/todolists/`：实施清单、任务清单、迁移 checklist。

### `specs/` 与 `todolists/`

- `specs/`：已经细化的专题规格和实施方案。
- `todolists/`：现有业务能力的任务清单；架构专项清单放在 `architecture/todolists/`。

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

1. [项目架构设计](architecture/项目架构设计.md)
2. [Clerk 认证与用户存储接入 Spec](specs/clerk-auth-and-user-storage-spec.md)
3. [Clerk 认证与用户存储接入实施清单](todolists/done/clerk-auth-implementation-plan.md)
4. [后端 Fastify 改造实施清单](todolists/backend-fastify-migration-todolist.md)
5. [简历解析架构](architecture/resume-parsing.md)
6. [面试编排架构](architecture/interview-orchestrator.md)
7. [上下文与长期记忆架构](architecture/context-and-memory.md)
8. [Agent 化改造历史路线图](architecture/agent-modernization-roadmap.md)
9. [多 Agent Runtime、Railway Sandbox 与共享能力方案](architecture/agent-runtime-openviking-preliminary-design.md)
10. [多 Runtime 与共享能力分阶段实施清单](architecture/todolists/agent-runtime-openviking-implementation-todolist.md)
11. [Railway Sandbox Agent 运行与生命周期设计](architecture/railway-agent-sandbox-design.md)
12. [PostgreSQL 单库收敛设计](architecture/postgresql-single-database-convergence-design.md)
13. [PostgreSQL 单库收敛实施清单](architecture/todolists/postgresql-single-database-convergence-todolist.md)
14. [简历解析页](pages/resume-page.md)
15. [模拟面试页](pages/interview-page.md)
16. [模拟面试会话页优化 Spec](specs/interview-session-optimization-spec.md)
17. [最小API契约](database/最小API契约.md)
18. [岗位分析与面试准备页设计](specs/job-interview-preparation-spec.md)：结合 JD、近期面经与个人能力证据生成面试准备快照，设计草案，尚未实现。
19. [动态面试与能力画像全链路设计](specs/adaptive-interview-evidence-profile-spec.md)：动态探索、优势证据、评价与长期记忆的演进方案，设计草案，尚未实现。
20. [动态面试与能力画像分阶段实施计划](todolists/adaptive-interview-phased-implementation-plan.md)：阶段 0 已建立工程基线，阶段 1 已实现本地影子切片；完整验收仍待完成，见[验收记录](reports/evidence-phase01/README.md)。

Agent 接入以第 9—11 项的 2026-10-10 方案为准；新增能力仍待实现。原 [DSH Worker Pool 设计](architecture/dsh-worker-pool-design.md) 保留为历史参考，不再作为当前实施顺序。

## 现有根目录文档说明

- [项目架构设计](architecture/项目架构设计.md)：系统总览。
- [最小API契约](database/最小API契约.md)：主要接口入口。
- [数据库字段级设计](database/数据库字段级设计.md)：数据库结构。
- [prompt-模板](prompt-模板.md)：提示词模板。
- [mvp-方案记录](mvp-方案记录.md)：版本迭代记录。

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

API 侧模板见 [apps/api/.env.example](../apps/api/.env.example)。
