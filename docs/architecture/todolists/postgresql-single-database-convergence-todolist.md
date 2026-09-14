# PostgreSQL 单库收敛实施清单

- 版本：v0.1
- 日期：2026-08-26
- 状态：待实施
- 依据：[PostgreSQL 单库收敛设计](../postgresql-single-database-convergence-design.md)

## 0. 完成定义

- [ ] 本地、CI、托管环境统一使用 PostgreSQL。
- [ ] 运行时代码不存在 SQLite 选库、fallback、合并读取或双写。
- [ ] SQL migration 是唯一 schema 权威，应用启动不执行 DDL。
- [ ] 历史 SQLite 数据可通过一次性工具安全导入，源文件保持不变。
- [ ] 面经 embedding 与知识图谱固定样本回归通过。
- [ ] DSH 审计及 OV 接入所需的 runtime session、run、稳定资源 ID、outbox 和 session mapping 有 PostgreSQL schema 承载。

## 1. 建立迁移基线

- [ ] 冻结新增 SQLite schema 和 repository 能力。
- [ ] 盘点 `src/db.js` 导出的全部 facade 函数及 PostgreSQL/SQLite 实现覆盖情况。
- [ ] 盘点 `src/postgres.js` 运行时 DDL 与 `migrations/` 的差异。
- [ ] 记录 SQLite 各表行数、主键、唯一键、孤儿记录和文件引用。
- [ ] 为用户、面试、题库、练习、面经建立最小 API 冒烟清单。
- [ ] 为知识图谱保存固定测试 fixture、节点/边摘要和召回快照。

## 2. 统一 Migration

- [ ] 补齐运行时 `initPostgres()` 已创建但 migration 缺失的表、列、索引和约束。
- [ ] 在添加外键前生成孤儿记录报告和清理策略。
- [ ] 分领域补充用户、session、turn、question、experience、question-bank 的必要外键。
- [ ] 将需要检索、约束或同步的 JSON 文本字段分批迁移为 JSONB。
- [ ] 增加 `schema_migrations` runner 和启动版本校验。
- [ ] 验证空库升级、已有数据库升级和 migration 重复执行。
- [ ] 移除 `initPostgres()` 中的应用启动 DDL，只保留连接和版本检查。

## 3. PostgreSQL Repository 收敛

- [ ] 抽取共享 PostgreSQL pool、transaction 和错误映射模块。
- [ ] 按 `users`、`interview`、`question-bank`、`experience`、`sync` 拆分 repository。
- [ ] 保持 `db.js` 现有公开函数签名，内部只委托 PostgreSQL repository。
- [ ] 删除 `getSqliteModules()`、`usePostgresPrimary()` 和 `isPostgresEnabled()` 业务分支。
- [ ] 将 `experience/store.js` 固定到 PostgreSQL store。
- [ ] 将公开题源固定到 PostgreSQL，删除 `PUBLIC_SOURCE_DRIVER` 分支。
- [ ] 删除文档路由中 SQLite/PostgreSQL 用户资料合并读取。
- [ ] 将旧 `question_bank` 数据映射到三层题库模型，删除运行时 fallback。
- [ ] 明确 Clerk ID -> `users.id` 映射，领域 repository 只接收内部用户 ID。

## 4. 本地与 CI 环境

- [ ] 新增 `compose.yaml`，提供带 healthcheck 和持久化 volume 的 PostgreSQL 服务。
- [ ] 增加统一的 `db:up`、`db:migrate`、`db:check`、`db:down` 命令。
- [ ] API 启动时强制要求 `DATABASE_URL`，错误配置立即失败。
- [ ] 更新 `.env.example`，删除 `DB_PATH`、`PUBLIC_SOURCE_DRIVER`、`EXPERIENCE_STORAGE_DRIVER`。
- [ ] 健康检查删除 SQLite fallback path 和多驱动字段。
- [ ] CI 在真实 PostgreSQL 上执行 migration、repository contract test 和 API 冒烟。

## 5. 一次性 SQLite 导入器

- [ ] 实现显式 `--source`、`--dry-run` 和 `--apply` 参数。
- [ ] 导入前检查源文件可读、目标库 migration 版本正确、目标连接非生产误操作。
- [ ] 输出逐表读取、导入、更新、跳过、冲突和失败计数。
- [ ] 按用户/资料、面试、面经、题库练习、同步状态顺序导入。
- [ ] 使用稳定 ID 和唯一键幂等 upsert。
- [ ] 同 ID 不同内容冲突停止对应领域并生成报告，不静默覆盖。
- [ ] 失败事务回滚，不修改或删除源 SQLite 文件。
- [ ] 正式导入前保留源文件备份并记录 checksum。
- [ ] 导入后校验行数、外键、业务 ID、文件可访问性和抽样内容。
- [ ] 重跑导入器，确认不会产生重复数据。

## 6. 知识图谱回归

- [ ] 从 PostgreSQL 加载全部有效 `experience_question_group` embedding。
- [ ] 比较固定 fixture 的知识点节点数、边数、邻居和权重。
- [ ] 比较固定 query 的 embedding 候选 group。
- [ ] 比较 graph rerank 后的题链顺序、难度、弱项和重复度处理。
- [ ] 验证 embedding 不可用时的现有降级行为。
- [ ] 确认本阶段未改变 `expandWithGraph()` 和 rank 算法语义。

## 7. Agent Runtime 与 OV 前置 Schema

- [ ] 新增 `agent_runtime_session`，映射业务 session、runtime 和外部 session ID。
- [ ] 新增 `agent_run`，按 Worker 执行记录任务、模型、Skill、预算、状态和错误；不把 Agent 输出直接当业务状态。
- [ ] 新增 `context_resource`，统一简历、JD、面经的稳定资源标识。
- [ ] 新增 `context_resource_sync`，记录 OV URI、hash、task 和状态。
- [ ] 新增 `context_sync_outbox`，与业务资源写入处于同一事务。
- [ ] 新增 `context_session_sync`，关联 runtime session 与 OV session，并防止重复 commit。
- [ ] 为 public/user owner 分别建立 partial unique index，并为用户资源增加 `owner_user_id -> users.id` 外键。
- [ ] `context_resource_sync` 显式包含 `ov_target`，对 `resource_id + ov_target` 建唯一约束。
- [ ] 定义 `pending/processing/ready/failed/stale/deleted` 状态转换。
- [ ] Agent Runtime 两表可随 DSH 评分切片启用；context/OV 表只完成 schema 与 repository contract，不在本阶段调用 OV。

## 8. 删除 SQLite 运行时

- [ ] PostgreSQL API 冒烟和 importer 验收全部通过。
- [ ] 禁用 SQLite 路径后运行完整后端测试。
- [ ] 删除 `better-sqlite3` 依赖。
- [ ] 删除 `src/db/` 中只服务于 SQLite 的实现和初始化逻辑。
- [ ] 删除 `DB_PATH` 相关健康信息、日志和文档。
- [ ] `rg` 检查不再存在运行时 SQLite driver/fallback 分支。
- [ ] 若 importer 仍需 SQLite 读取依赖，确保它不被 API runtime import。

## 9. 最终验收

- [ ] 缺失或错误 `DATABASE_URL` 时 API 明确失败，不创建本地数据库文件。
- [ ] 本地和托管版使用同一 migration 集合和 repository contract。
- [ ] 用户、面试、题库、练习、面经同步全链路通过 PostgreSQL。
- [ ] 历史 SQLite 数据导入报告无未解释丢失或覆盖。
- [ ] 知识图谱和 embedding 固定样本回归通过。
- [ ] OV 资源 ID 和同步任务可以从 PostgreSQL 稳定生成。
- [ ] 文档、环境变量和健康检查与单库现状一致。

## 10. 回滚边界

- [ ] 每个 schema 改动有 forward-fix 策略；不通过改写历史 migration 回滚。
- [ ] repository 收敛按领域提交，可在删除 SQLite 代码前回退应用版本。
- [ ] SQLite 源文件始终只读保留，可重新执行导入。
- [ ] 切换后不恢复双写；严重问题回退应用版本和 PostgreSQL 备份，而不是重新启用两个事实源。
