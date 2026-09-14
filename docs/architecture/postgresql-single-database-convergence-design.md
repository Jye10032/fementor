# PostgreSQL 单库收敛设计

- 版本：v0.1
- 日期：2026-08-26
- 状态：已确认方向，待实施
- 关联方案：[DSH-first Agent Runtime 与 OpenViking 方案](agent-runtime-openviking-preliminary-design.md)

## 1. 决策

FEMentor 的本地开源版与线上托管版统一使用 PostgreSQL 作为唯一结构化业务数据库。

SQLite 不再承担运行时 fallback、新功能写入或长期双驱动兼容，只保留为一次性历史数据导入源。简历和 JD 原文件继续保存在本地文件系统或对象存储，PostgreSQL 保存元数据、业务引用和同步状态。

这项收敛必须先于 OpenViking 资源同步。否则同一面经、简历或会话可能从不同数据库生成不同资源 ID，无法可靠处理更新、删除和证据回查。

### 1.1 方案选择

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 本地与托管统一 PostgreSQL，SQLite 一次性导入 | 采用 | schema、repository、资源 ID 和测试矩阵只有一套，最适合后续 OV 同步 |
| 长期保留 PostgreSQL/SQLite 双驱动 | 不采用 | 当前已经出现多个独立选库开关和合并读取，继续维护会放大数据漂移与测试成本 |
| 本地 SQLite、托管 PostgreSQL | 不采用 | 本地和线上行为仍会分叉，DSH/OV 在不同部署下无法依赖相同事务与 outbox 语义 |
| PostgreSQL 长期双写 SQLite | 不采用 | 双写不能解决冲突权威问题，还会把迁移窗口变成永久一致性系统 |

本地开发增加 PostgreSQL 启动成本是可接受的代价，通过 `compose.yaml` 和统一命令降低使用门槛。

## 2. 当前问题

当前存储选择不是一个集中开关，而是多处分支：

| 位置 | 当前行为 | 风险 |
| --- | --- | --- |
| `src/db.js` | 根据 `DATABASE_URL` 在 PostgreSQL 与 SQLite facade 间切换 | 同一领域接口存在两套实现 |
| `src/experience/store.js` | 读取 `EXPERIENCE_STORAGE_DRIVER` 独立选择 | 面经可能与主业务库分离 |
| `src/request-context.js` | 读取 `PUBLIC_SOURCE_DRIVER` 独立选择 | 公开题源可能写入另一数据库 |
| `src/routes/document-routes.js` | 合并 SQLite 与 PostgreSQL 用户资料 | 读结果依赖合并顺序，难以定义权威值 |
| `src/app.js`、`src/server.js` | 启动时按环境选择初始化路径 | 配置缺失会静默改变数据落点 |
| `src/postgres.js` | 连接、repository 和运行时 DDL 混在单文件中 | migration 与启动时 schema 可能漂移 |

其他已确认问题：

1. `better-sqlite3` 仍是 API 运行依赖，`.env.example` 仍暴露 SQLite 和多个驱动开关。
2. 旧 `question_bank` 与新 `question_source -> user_question_bank -> question_attempt` 模型并存。
3. 多数业务关系只有普通列和索引，缺少必要外键；JSON 字段也同时存在 `text` 与 `jsonb` 表示。
4. 应用启动时执行 DDL，导致 migration 不再是可审计的唯一 schema 历史。

## 3. 权威数据边界

| 数据 | 权威存储 | 说明 |
| --- | --- | --- |
| 用户、场次、题目、回答、评分、配额 | PostgreSQL | 唯一业务事实源 |
| 面经原文、清洗结果、题链、知识点 | PostgreSQL | 知识图谱和题链召回的事实源 |
| 简历、JD 原文件 | 本地文件或对象存储 | 不强制把大文本或二进制写进数据库 |
| 简历、JD 元数据与活跃引用 | PostgreSQL | 使用稳定内部资源 ID |
| 知识图谱共现边 | PostgreSQL 数据 + 版本化 skeleton 派生 | 可重建，不由 OV 维护 |
| embedding cache | PostgreSQL embedding 字段派生的内存缓存 | 可重建，不是事实源 |
| OV resources、L0/L1/L2、向量索引 | OpenViking | PostgreSQL/对象存储的派生上下文层 |
| DSH/OV session 与业务 session 映射 | PostgreSQL | 支持审计、恢复和删除 |

## 4. 目标结构

```text
Web / Worker / DSH Runtime
          |
    FEMentor Domain Services
          |
    stable db facade
          |
  +-------+-------------------------+
  |       |        |                |
users  interview  question-bank  experience repositories
  |       |        |                |
  +-------+--------+----------------+
          |
      PostgreSQL
          |
   transactional outbox
          |
 OpenViking sync worker -> OpenViking derived resources
```

过渡期间保留 `db.js` 的公开函数签名，调用方不需要一次性重写；内部逐域切换为 PostgreSQL repository。`postgres.js` 按用户、面试、题库、面经、同步等领域拆分，连接池和事务工具由共享基础模块提供。

## 5. Schema 管理

`apps/api/migrations/` 是唯一 schema 权威：

1. 已发布 migration 只读保存；修复使用新的递增 migration。
2. 应用启动只检查数据库连通性和 migration 版本，不执行 `CREATE TABLE` 或 `ALTER TABLE`。
3. migration runner 在本地、CI、预发布和生产使用同一套命令。
4. 每个 migration 在空库升级和已有数据升级两条路径上验证。
5. 首轮增量 migration 补齐 schema 错误、必要外键、唯一约束、JSONB 类型和索引；加入外键前先输出孤儿记录报告。

不要求一次性把所有文本 JSON 改成 JSONB。优先处理会被查询、约束或用于 OV 映射的字段，其余字段按领域迁移。

## 6. SQLite 数据导入与切换

### 6.1 导入工具

提供独立的一次性命令，例如：

```bash
npm run db:import-sqlite -- --source /absolute/path/fementor.db --dry-run
npm run db:import-sqlite -- --source /absolute/path/fementor.db --apply
```

工具必须具备：

- 显式源文件路径和目标 `DATABASE_URL`，拒绝模糊默认路径。
- `--dry-run`、逐表读取数、可导入数、冲突数和跳过原因。
- 单事务或按依赖域分事务，失败时不留下不可识别的半迁移状态。
- 以业务 UUID/唯一键幂等 upsert，输出采用了哪种冲突策略。
- 导入前备份提示，导入后逐表计数、关键外键和抽样内容校验。
- 永不删除或修改源 SQLite 文件。

建议导入顺序：用户和资料元数据 -> 面试场次/题目/回合 -> 面经/题链 -> 题库/练习 -> 同步状态和可重建缓存。发生不可自动合并的同 ID 不同内容冲突时停止该域导入并出报告，不使用“最后写入覆盖”。

### 6.2 切换门槛

1. 空库 migration 和 API 冒烟通过。
2. SQLite dry-run 无未解释的数据丢失。
3. 正式导入后行数、稳定 ID、关键关系和文件引用验证通过。
4. PostgreSQL 路径覆盖用户、面试、题库、练习、面经同步和知识图谱初始化。
5. 禁用 SQLite fallback 后运行一轮回归。
6. 最后删除 `better-sqlite3`、SQLite repository 和旧环境变量。

不采用长期双写。迁移窗口内旧 SQLite 只读，完成核验后 PostgreSQL 直接成为唯一读写路径。

## 7. 现有知识图谱边界

现有召回链路保持不变：

```text
experience_post
  -> experience_question_group
  -> experience_question_item
  -> group embedding 候选召回
  -> knowledge_points 共现图扩展
  -> 难度 / 弱项 / 重复度 / 题链重排
```

数据库收敛只替换数据访问层，不改变 `expandWithGraph()`、embedding candidate recall 或业务 rerank 的语义。验收时需要固定样本，比较迁移前后：

- graph 节点和边数量；
- 每个节点的邻居与权重；
- embedding cache 可加载记录数；
- 固定 query 的候选 group、排序与降级行为。

OpenViking 后续接收候选 `experience_post` 的 URI 白名单，在白名单内完成长文档定位与 L1/L2 证据读取。它不创建第二套知识点边，不覆盖题链、难度、弱项或重复度排序。

## 8. Agent Runtime 与 OpenViking 支撑数据模型

数据库收敛过程中通过增量 migration 增加以下表。Agent Runtime 表可随 DSH 评分切片先落地；资源与 OV 映射表必须等待单库切换完成后启用。

### `agent_runtime_session`

保存 FEMentor 与执行运行时之间的稳定会话关系：`id`、`interview_session_id`、`runtime_id`、`external_session_id`、`runtime_version`、`status`、`created_at`、`closed_at`。`external_session_id` 只是 DSH 等外部运行时的引用，不能作为业务主键；Native API 可以为空。

### `agent_run`

保存一次有边界 Worker 执行：`id`、`runtime_session_id`、`interview_turn_id`、`task_type`、`provider`、`model`、`skill_name`、`skill_version`、`status`、预算、耗时、Token/成本、错误类别和时间戳。一个 runtime session 可以包含多个 run，业务状态提交仍由领域表负责。

### `context_resource`

保存简历、JD、面经等稳定业务资源：`id`、`source_type`、`source_key`、`owner_scope`、`owner_user_id`、`content_hash`、`storage_uri`、`created_at`、`updated_at`。`owner_scope` 只能为 `public|user`；公共资源要求 `owner_user_id IS NULL`，用户资源要求非空并关联 `users.id`。分别使用 public partial unique index 与 user partial unique index，避免 nullable key 绕过唯一约束。

### `context_resource_sync`

保存 OV 派生状态：`resource_id`、`ov_target`、`ov_uri`、`status`、`task_id`、`indexed_hash`、`last_error`、`indexed_at`、`updated_at`。`resource_id + ov_target` 唯一，允许同一业务资源投影到不同 OV 部署，但每个目标只能有一个有效映射。

### `context_session_sync`

保存 `agent_runtime_session_id`、`ov_target`、`ov_session_uri`、`peer_id`、`status`、`last_commit_at` 和版本信息。`agent_runtime_session_id + ov_target` 唯一，防止同一 DSH session 被重复映射和重复 commit。

### `context_sync_outbox`

业务事务只写资源和 outbox。独立 worker 在事务提交后同步 OV，按 `event_id` 幂等消费；失败进入可重试状态，不能回滚已经成功的业务写入。

删除采用显式状态机：先撤销业务可见性，再清理对象存储和 OV，分别记录结果。OV 不可用时资源保持不可检索并等待补偿，不重新启用已删除业务数据。

## 9. 错误处理与可观测性

- `DATABASE_URL` 缺失、连接失败、migration 落后均使 API 启动失败，并返回明确诊断。
- 健康检查只报告 PostgreSQL，不再暴露 SQLite fallback 路径。
- 数据库日志记录 migration version、连接目标类别和错误类别，不记录密码或完整连接串。
- 导入与 OV 同步分别记录 run/event ID、源 ID、hash、尝试次数和最终状态。
- OV 故障不影响 PostgreSQL 业务写入；RAG 路径降级到现有数据库、embedding 和知识图谱召回。

## 10. 测试与验收

| 范围 | 验证 |
| --- | --- |
| Migration | 空库升级、已有库升级、重复执行、落后版本拒绝启动 |
| Importer | dry-run、幂等重跑、冲突停止、回滚、计数和关联校验 |
| Repository | 用户、面试、题库、练习、面经的 contract test |
| Runtime | 缺失/错误 `DATABASE_URL` 不回落 SQLite |
| Graph | 固定样本节点、边、候选和 rerank 回归 |
| OV mapping | 同一 source/hash 幂等、更新、删除、失败补偿 |
| Security | 用户资源隔离、内部 ID 映射、RLS 行为 |

完成标准是运行时代码中不再存在 SQLite 选库分支，所有结构化业务写入可从 PostgreSQL 回查，知识图谱行为保持一致，并且 OV 中任意正式证据 URI 都能反向映射到 PostgreSQL 资源和内容 hash。

## 11. 非目标

- 不把所有简历、JD 二进制或长文本强制迁入 PostgreSQL。
- 不在本阶段引入 OpenViking、DSH 或新的模型路由。
- 不重写知识图谱算法或改用 OV 代替图召回。
- 不保留 SQLite/PostgreSQL 长期双写和数据合并读取。
- 不借数据库迁移重构无关 UI 或业务流程。
