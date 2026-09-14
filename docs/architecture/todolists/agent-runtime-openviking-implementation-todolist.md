# DSH-first Agent Runtime 与 OpenViking 分阶段实施清单

- 版本：v1.0
- 日期：2026-08-26
- 状态：待实施
- 依据：[DSH-first Agent Runtime 与 OpenViking 方案](../agent-runtime-openviking-preliminary-design.md)

## 1. 实施目标

按照 FEMentor 当前进展，先接入 DSH 及其插件、Skill、Workflow 基础能力，再迁移面试业务，最后接入 OpenViking 作为知识库与 RAG 上下文层。

Agent 主线与数据主线并行推进，在 OpenViking 前汇合：

```text
Agent 主线：运行边界
  -> DSH Runtime
  -> DSH 插件 / Skill / Workflow
  -> 单轮评分纵向切片
  -> 其余面试任务

数据主线：PostgreSQL migration 基线
  -> repository 收敛
  -> SQLite 一次性导入与切换
  -> 知识图谱回归

两条主线验收通过
  -> OpenViking 数据同步
  -> 数据库 + 知识图谱 + OV 混合 RAG
  -> DSH 与 OV 记忆联动
```

DSH-first 指 Agent 能力按 DSH 原生能力优先落地；PostgreSQL 不阻塞 DSH Runtime、插件、Skill、Workflow 和业务切片开发，但阶段 5 的 OV 数据映射必须等待单库切换与知识图谱回归完成。

本清单暂不包含：

- 自动化评测、人工金标和模型路由。
- Codex/Claude Code subagent。
- Agent 自主写入或删除 OpenViking 资源。
- 公共资源 Watch 自动同步。
- OpenViking 生产扩容、备份和容灾。
- 与 Agent 接入无关的前端改版。

## 2. 不可破坏的现有边界

### 2.1 业务数据真源

- [ ] 保持 PostgreSQL 为用户、会话、题目、回答、评分、题库和面经的唯一结构化权威存储。
- [ ] 保持本地文件或 Supabase Storage 为简历、JD 文本的权威存储。
- [ ] OpenViking 只保存业务数据的上下文副本和派生索引，不作为业务写入入口。
- [ ] DSH、OV 不直接修改 `interview_session`、`interview_turn`、`question_source`、`user_question_bank`、`question_attempt`。

### 2.2 面经与知识图谱

现有面经链路必须保留：

```text
experience_post
  -> experience_question_group
  -> experience_question_item
  -> group embedding 候选召回
  -> knowledge_points 共现图扩展与重排
  -> 题链、难度、弱项和重复度排序
```

- [ ] `experience_post/question_group/question_item` 继续作为面经原文、题链和知识点真源。
- [ ] `knowledge-graph-skeleton.json` 与数据库共现关系继续生成运行时知识图谱。
- [ ] OV 不复制或维护第二套知识图谱边，不替代 `expandWithGraph()`。
- [ ] OV 第一阶段只补充长文档语义定位、L0/L1/L2 阅读和可审计证据引用。
- [ ] OV 不直接决定题链、难度、追问意图或用户弱项排序。

### 2.3 Workflow 所有权

- [ ] FEMentor 继续控制出题、答题、评分、追问、持久化和复盘状态流转。
- [ ] DSH Workflow 只执行输入输出明确的 Worker，不接管整场面试状态。
- [ ] 所有 Agent 结果先通过 FEMentor Schema 和业务规则，再写数据库。

## 3. 阶段 0：冻结运行边界

目标：在引入 DSH 前，先建立不会向领域层泄露 DSH 类型的最小接口。

### 0.1 配置

- [x] 新增仅由服务端控制的运行时选择：`AGENT_RUNTIME=native-api|dsh`。
- [x] 本地版和托管版默认配置 DSH；DSH 不可用时明确失败，不自动退回 Native API。
- [x] 托管版固定使用服务端 DSH、provider、模型和官方 Skill 配置，忽略浏览器提交的模型 Base URL、API Key 和模型覆盖。
- [ ] 明确 DSH 配置：命令或 SDK 包版本、profile、工作目录、启动超时、单次任务 deadline。
- [ ] DSH 与相关 package 使用精确版本，不使用 caret 自动升级。
- [x] 更新 `.env.example`，不写入任何真实密钥或本机登录态。

### 0.2 FEMentor 稳定契约

- [ ] 定义 `AgentRuntime`、`AgentSessionRef`、`AgentRunRequest`、`AgentCapabilities`、`AgentEvent`。
- [ ] Runtime 生命周期统一为 `startSession/runTurn/resumeSession/cancelTurn/closeSession`；Native API 路径可用轻量无状态 session 实现。
- [ ] `AgentRunRequest` 只包含任务类型、业务输入、上下文引用、Skill 引用、输出 Schema 和预算。
- [ ] `AgentEvent` 收敛为 `started/status/tool_call/tool_result/output_delta/completed/failed`。
- [ ] 领域代码不能 import Cordis、Typert、DSH session 或 JSON-RPC 内部类型。
- [ ] 为现有 LLM 调用实现薄 `NativeApiRuntime` 适配，保持行为不变。
- [ ] 为 Runtime 增加 capability negotiation，禁止假设所有 Provider 都支持工具、结构化输出或 resume。

### 0.3 完成标准

- [ ] Runtime 可以在不修改面试领域函数签名的情况下切换。
- [ ] `native-api` 路径仍能完成现有单轮评分。
- [ ] 配置错误返回明确的 `runtime_unavailable`，不静默切换到未知模型。

## 4. 阶段 1：接入 DSH Runtime

目标：只接入 DSH 原生 Agent 和不同模型 Provider，不引入 OV 和 subagent。

### 1.1 Subprocess SDK

- [ ] 使用官方 TypeScript subprocess SDK/stdio JSON-RPC 启动 DSH，不依赖 Web Host 内部 API。
- [ ] 实现 `DshRuntime` 的进程启动、握手、`startSession/runTurn/resumeSession/cancelTurn/closeSession` 和 dispose。
- [ ] 将 DSH notification 转换成 FEMentor `AgentEvent`。
- [ ] 处理 stdout 协议流与 stderr 诊断流，禁止把 stderr 混入业务输出。
- [ ] 将单次 deadline 映射为“关闭并重建 runtime”，记录无法 per-prompt cancel 的限制。
- [ ] 进程退出时清理整个子进程树。
- [ ] 限制并发 runtime/session 数量，防止重复 spawn。

### 1.2 Provider 与认证

- [ ] 首版只验证 DSH Native Agent 的模型 Provider 切换。
- [ ] Provider 配置由服务端环境或 DSH profile 读取，浏览器不读取本机凭证。
- [ ] 本地版只传递明确允许的环境变量，不扫描或上传 Codex/Claude 私有文件。
- [ ] 托管版启动服务端固定配置的 DSH，但不继承宿主机 Codex/Claude 等 Agent 登录态。

### 1.3 健康和降级

- [ ] 增加 DSH 启动健康检查和版本日志。
- [ ] 区分“DSH 未安装”“profile 无效”“Provider 未认证”“模型调用失败”。
- [x] DSH 配置或启动失败时返回明确错误，不自动降级到 `NativeApiRuntime`。
- [ ] DSH 执行中失败不自动重复有副作用的任务。

### 1.4 完成标准

- [ ] 用一个固定 prompt 跑通 DSH 原生 Agent 的流式输出。
- [ ] 可以切换至少两个模型 Provider，Agent Loop 与工具策略保持一致。
- [ ] 超时后进程树被清理，下一次任务可通过新 runtime 正常执行。
- [ ] DSH 升级前有最小兼容检查：启动、session、流式事件、关闭。

## 5. 阶段 2：接入 DSH 插件、Skill 与 Workflow

目标：验证 DSH 基础扩展面，但不让 DSH 接管 FEMentor 主 Workflow。

### 2.1 插件

- [ ] 固定 FEMentor 使用的 DSH profile，并记录插件安装/加载方式。
- [ ] 编写一个无副作用的验证插件，确认配置、生命周期和事件订阅。
- [ ] 验证插件初始化失败是否会阻塞 DSH，并定义 fail-open/fail-closed 策略。
- [ ] 建立插件 allowlist，禁止运行时加载用户任意 npm 包或本地路径。
- [ ] 插件只通过 FEMentor 定义的窄接口访问业务能力。

### 2.2 Skill

- [ ] 确定 Git 中的 Skill 权威目录，并验证 DSH 实际发现路径。
- [ ] 首批只提供三个 Skill：`frontend-answer-evaluation`、`follow-up-suggestion`、`interview-retrospect`。
- [ ] Skill 只描述任务方法、输入输出和限制，不包含密钥、用户数据或可变运行状态。
- [ ] Skill 名称与版本进入 Agent run 审计记录。
- [ ] Skill 更新不依赖修改 DSH profile 的私有状态，可通过仓库版本回滚。

### 2.3 Workflow

- [ ] 编写一个只读、一次性的 DSH Workflow Worker 示例。
- [ ] Worker 只能读取显式输入，不能直接访问业务数据库。
- [ ] Worker 输出必须符合 FEMentor Schema；失败返回结构化错误。
- [ ] 配置最大步骤数、并发、Token/成本预算和 deadline。
- [ ] 明确 `node:vm` 不是沙箱，首版不开放 shell、任意文件写入和网络写操作。

### 2.4 工具权限

- [ ] 建立按任务类型的工具白名单，而不是共用一个全权限 profile。
- [ ] 评分 Worker 首版不需要文件写入、Shell、数据库和删除工具。
- [ ] 工具调用记录统一转换为 FEMentor 审计事件。
- [ ] 未知工具、越权工具和需要人工审批的调用一律 fail closed。

### 2.5 完成标准

- [ ] 插件、Skill、Workflow 三种扩展能力分别有独立冒烟用例。
- [ ] 删除任一可选插件后，核心 DSH Runtime 仍能运行。
- [ ] Workflow 失败不会修改面试场次状态。
- [ ] Skill 和工具白名单在不同模型 Provider 下保持一致。

## 6. 阶段 3：单轮评分纵向切片

目标：先把“候选人回答 -> 评分结果”接入 DSH，验证完整业务闭环，不迁移整场面试。

### 3.1 任务契约

- [ ] 从当前 `enhanceEvaluationWithLLM()` 提取 `EvaluateAnswerTask`。
- [ ] 输入固定包含问题、回答、题型、简历摘要、JD、近期上下文和可选 evidence bundle。
- [ ] 输出沿用四维 rubric、总分、优势、弱项、反馈、标准答案和知识边界。
- [ ] 评分结果继续由 FEMentor 校验、计算追问条件并持久化。
- [ ] DSH 不直接调用 `addInterviewTurn()` 或修改题目队列。

### 3.2 输入与输出风险护栏

- [ ] 将候选人回答、简历/JD、面经、Memory 和工具返回值统一标记为不可信数据；Prompt 中使用明确的数据边界，禁止其中的指令覆盖系统规则、评分 rubric 和工具权限。
- [ ] 定义面试风险分类契约，至少覆盖 `normal`、`score_manipulation`、`answer_request`、`instruction_override`、`system_prompt_probe` 和 `unsafe_content`；风险检测结果只作为服务端策略输入，不能由评分模型自行决定是否绕过护栏。
- [ ] 明确混合输入策略：包含有效回答时只评分回答内容并忽略改分、越权和索答指令；只有诱导、探测或索答而无有效回答时按 `non_answer` 处理，不产生分数和 `interview_turn`。
- [ ] 建立场景级答案披露策略：正式 `interview` 进行中不返回 `standard_answer`、expected points 或评分内部依据；`practice` 或面试结束后的显式复盘接口才允许返回参考答案。
- [ ] Native API 与 DSH 共用同一个服务端输出 Validator，校验 intent/next action 枚举、必填与条件字段、未知字段、字段长度、总分 0-100、维度 0-25、总分与维度和的一致性，以及关键词轮次和追问上限。
- [ ] 将 `outputSchema` 从元数据标识落实为真实运行时校验；Schema 或策略校验失败时不得把原始模型文本、部分结构化字段或未校验分数写库或返回前端。
- [ ] 调整 SSE 安全边界：候选人可见的评价文本必须在结构化结果和输出策略通过后再发送；若保留增量流式输出，则增加可阻断的分段过滤，确保校验失败前不会泄露标准答案、系统指令、凭证或内部评分依据。
- [ ] 对失败路径采用 fail closed：返回固定、无敏感信息的面试场景回复，并记录 `risk_code`、规则版本和处置动作；日志不记录凭证、完整系统 Prompt 或不必要的用户隐私原文。
- [ ] 为风险策略建立独立版本和审计字段，区分模型原始建议、Validator 修正/拒绝结果及最终业务提交结果，避免把模型输出直接当作权威评分。
- [ ] 增加红队与回归样例：直接/间接 Prompt Injection、中英文及混淆表达的改分诱导、索要正确答案、伪造 system/tool 内容、恶意简历/JD/证据、越界分数、非法 action、缺失字段、超长输出和 SSE 校验前泄露。

### 3.3 接入方式

- [ ] 在现有 turn service 增加 Runtime 分支，不复制整套回合逻辑。
- [ ] 保持现有 SSE `stage/token/result/error` 对外契约。
- [ ] DSH 增量文本只有通过流式输出策略后才转换为现有 `token` 事件；最终结构化结果校验通过后只发送一次。
- [ ] Schema 不通过时最多进行一次无副作用修复，之后走现有 fallback。
- [ ] 为业务 `interview_session` 创建或恢复 `agent_runtime_session`，每次评分写独立 `agent_run`。
- [ ] `agent_run` 记录 runtime、provider、model、Skill version、预算、耗时、Token/成本和错误类别。
- [ ] 只有 FEMentor 校验并提交评分业务事务后，才把 run 标记为 `committed`；失败 run 不产生半条 `interview_turn`。

### 3.4 完成标准

- [ ] 同一个 API 可以通过配置在 Native API 与 DSH 评分间切换。
- [ ] DSH 评分结果可以被现有前端、数据库和复盘流程消费。
- [ ] DSH 失败时不会产生半条 `interview_turn`。
- [ ] Native API 与 DSH 对同一组风险样例执行一致的拒绝、忽略或延后披露策略。
- [ ] 面试进行中无法通过用户输入、外部上下文或工具结果诱导改分、获取参考答案或泄露系统指令；相关用例覆盖普通 JSON 与 SSE 两条接口。
- [ ] 评分切片稳定前，不迁移出题、追问或复盘。

## 7. 阶段 4：扩展到其余面试任务

目标：在单轮评分稳定后，逐个迁移有边界的 Agent Worker。

按以下顺序实施，每完成一个任务再进入下一个：

### 4.1 出题

- [ ] 将题目批量生成封装成独立任务。
- [ ] FEMentor 负责题目去重、数量、类型分布和队列落库。
- [ ] Agent 只返回候选题目，不直接改变 session 状态。

### 4.2 追问建议

- [ ] Agent 返回追问建议、目标弱项和理由。
- [ ] `shouldInsertFollowUp`、最多一次追问和队列插入仍由 FEMentor 决定。
- [ ] 现有面经题链复用和知识图谱排序继续运行。

### 4.3 复盘

- [ ] Agent 生成 retrospect 候选结果。
- [ ] 题库回流、长期画像和练习计划仍由 FEMentor 持久化。
- [ ] DSH 会话内容不自动成为用户可见的稳定能力画像。

### 4.4 完成标准

- [ ] 每种任务有独立输入 Schema、输出 Schema、Skill 和工具白名单。
- [ ] 任一任务可单独切回 Native API，不要求整场统一切换。
- [ ] FEMentor 主 Workflow 中不存在 DSH 内部对象。

## 8A. 后续阶段：DSH Worker Pool 并发与故障恢复

详细设计见 [DSH Worker Pool 并发与故障恢复设计](../dsh-worker-pool-design.md)。本阶段只在 DSH 单轮评分和基础扩展能力稳定后实施，当前不代表已支持多人排队或多实例调度。

- [ ] 单实例 DSH Worker Pool（独立 DSH 子进程）
- [ ] 进程内 FIFO 队列、队列上限和等待超时
- [ ] `interview_session_id` 粘性路由与同 Session 并发锁
- [ ] Worker 健康检查、优雅退出和崩溃重建
- [ ] checkpoint/resume 或基于结构化 `InterviewState` 的恢复
- [ ] queued/running/completed/failed/cancelled 前端状态
- [ ] 多 API 实例共享队列、租约、分布式锁和死信机制

## 9. 并行数据主线：PostgreSQL 单库收敛

目标：与 DSH 阶段 0-4 并行，在新增 OV 同步状态、资源映射和证据引用前结束 PostgreSQL/SQLite 双实现维护。PostgreSQL 作为本地与托管版唯一运行时业务库；SQLite 只作为一次性历史数据迁移源。详细任务以 [PostgreSQL 单库收敛实施清单](postgresql-single-database-convergence-todolist.md) 为准，本节只保留汇合门槛。

### DB.1 运行时与配置收敛

- [ ] 取消运行时存储选择器；PostgreSQL 是唯一实现，首版不保留 SQLite fallback。
- [ ] API 启动时必须校验 `DATABASE_URL`；缺失或不可连接时返回明确错误，禁止静默初始化 SQLite。
- [ ] 删除 `DB_PATH`、`PUBLIC_SOURCE_DRIVER`、`EXPERIENCE_STORAGE_DRIVER` 的运行时选库语义，避免用户、题源、面经写入不同数据库。
- [ ] 本地开发与 CI 统一通过 `compose.yaml` 启动 PostgreSQL，并执行 PostgreSQL migration。
- [ ] 保持原文存储边界：简历/JD 原文件继续存于对象存储或本地文件系统，PostgreSQL 保存其业务元数据与活跃引用。

### DB.2 Repository 与数据模型收敛

- [ ] 将 `db.js` 收敛为 PostgreSQL 单一 facade，保持现有领域函数签名，移除 `getSqliteModules()` 与按 `DATABASE_URL` 分流的逻辑。
- [ ] 将 `experience/store.js` 固定到 PostgreSQL store，移除 SQLite/PostgreSQL 混用的可能性。
- [ ] 对齐 PostgreSQL 与 SQLite 现有能力后，将新功能仅写入 PostgreSQL；包括后续 `context_resource_sync`、面试轮次 evidence refs 和 OV 同步任务。
- [ ] 删除 SQLite 专属的旧 `question_bank` fallback，统一使用 `question_source -> user_question_bank -> question_attempt`。
- [ ] 明确内部用户主键为 `users.id`；请求上下文负责从 Clerk ID 映射内部 ID，迁移前不得混用两种 ID。

### DB.3 Schema 真源与历史数据迁移

- [ ] 将 `apps/api/migrations/` 设为 PostgreSQL 唯一 schema 真源；补齐运行时 `initPostgres()` 中尚未覆盖的 schema 差异。
- [ ] 为 migration 增加 PostgreSQL 冒烟校验；schema 稳定后，`initPostgres()` 只做连接检查，不在应用启动时执行 DDL。
- [ ] 实现一次性 SQLite -> PostgreSQL 数据迁移脚本，按用户、简历/JD 元数据、面试、面经、题库/练习、同步状态和缓存的依赖顺序导入。
- [ ] 迁移脚本支持 `--dry-run`、幂等重跑、按表计数校验和失败报告；迁移过程不得删除原 SQLite 文件。
- [ ] 校验业务引用的简历/JD 对象或本地文件仍可访问，但不复制原文件到 PostgreSQL。

### DB.4 汇合门槛

- [ ] 本地与托管环境均只使用 PostgreSQL 完成用户、面试、题库、练习、面经同步与知识图谱初始化。
- [ ] 缺失 `DATABASE_URL`、连接失败和 RLS 拒绝均返回明确错误，不发生隐式 fallback。
- [ ] SQLite 历史数据已可完整迁移，迁移后行数、业务 ID、关键关联和抽样内容校验通过。
- [ ] 删除 `better-sqlite3`、`src/db/` SQLite 实现、SQLite 初始化和相关环境变量前，完成 PostgreSQL 路径的 API 冒烟与受影响集成测试。
- [ ] 本数据主线不引入 OV、DSH、UI 或无关业务重构；它不阻塞 DSH 阶段 0-4，但未完成前不得进入 OV 阶段 5。

## 9. 阶段 5：为 OpenViking 准备数据映射

目标：不改变现有业务存储的前提下，建立可重试、可审计的 OV 派生同步层。

进入条件：DSH 阶段 0-4 已完成所需业务切片，且 PostgreSQL 数据主线 DB.4 全部通过。任何一条主线未完成，都不得创建正式 OV 资源映射。

### 5.1 新增同步状态表

- [ ] 确认 PostgreSQL 已具备 `agent_runtime_session`、`agent_run`、`context_resource`、`context_resource_sync`、`context_sync_outbox` 和 `context_session_sync`。
- [ ] 同步表最少包含：稳定 resource ID、`source_type`、`source_key`、`owner_scope`、`owner_user_id`、`source_hash`、`ov_uri`、`status`、`task_id`、`last_error`、`indexed_at`、`created_at`、`updated_at`。
- [ ] `owner_scope` 固定为 `public|user`；分别为公共资源和 `owner_user_id` 非空的用户资源建立 partial unique index。
- [ ] 同步映射显式记录 `ov_target`，`resource_id + ov_target` 建唯一约束。
- [ ] 状态至少包含 `pending/processing/ready/failed/stale/deleted`。
- [ ] 同步记录只描述派生索引状态，不改变业务记录有效性。

### 5.2 资源标识

- [ ] 公共面经使用 `experience_post.id` 关联 OV，不依赖可变公司名或职位名拼路径。
- [ ] 建议 URI：`viking://resources/fementor/experiences/{experience_post_id}/`。
- [ ] 简历/JD 当前没有独立业务表 ID，由 `context_resource_sync.id` 提供稳定资源 ID。
- [ ] 简历/JD 的 `source_key` 指向现有本地文件或对象存储路径，URI 不暴露真实文件名和用户信息。
- [ ] 每个 OV 资源保留 `source_type/source_key/source_hash`，用于回查权威源。

### 5.3 同步触发

- [ ] 业务写事务只写数据库/对象存储和同步状态，不在事务内调用 OV。
- [ ] 事务提交后由后台 worker 导入 OV，并更新 `task_id/status`。
- [ ] 面经新增、重清洗、失效和删除分别产生 `pending/stale/deleted` 同步状态。
- [ ] 简历/JD 保存、覆盖和删除分别产生对应同步状态。
- [ ] 增加 reconciler，能够扫描 DB 与 OV 状态并补偿漏任务。
- [ ] 使用 `content_hash` 幂等去重；相同 hash 不重复导入。

### 5.4 完成标准

- [ ] OV 停机时业务写入仍成功，同步状态进入待处理或失败。
- [ ] OV 恢复后可重放，不重复创建多个有效 URI。
- [ ] 可以从任意 OV URI 回查业务 source ID、hash 和存储位置。
- [ ] 删除流程分别记录业务库、对象存储和 OV 的结果。

## 10. 阶段 6：接入 OpenViking Gateway 与资源同步

目标：先让 Backend 通过官方 SDK 管理资源，不把 OV 工具直接开放给 Agent。

### 6.1 服务与 SDK

- [ ] 本地启动 OV 服务并执行 `openviking-server doctor`。
- [ ] `/health` 只作为存活探测，不替代配置诊断。
- [ ] 接入官方 TypeScript SDK，封装薄 `OpenVikingGateway`。
- [ ] Gateway 统一处理身份、超时、错误、任务状态和 URI 前缀校验。
- [ ] 托管版使用 OV User 隔离用户；本地单用户版沿用相同 URI 结构。

### 6.2 导入内容

- [ ] 面经 `source.md` 由 `content_cleaned` 生成，并保留原业务引用。
- [ ] 面经 `normalized.md` 可包含 summary、公司、岗位、阶段和结构化题目导航，但数据库仍是真源。
- [ ] 简历/JD 从当前权威文件读取后导入用户私有 namespace。
- [ ] 默认异步导入并轮询 task；只有显式需要立即检索时有界等待。
- [ ] 导入完成前不把资源加入可检索白名单。

### 6.3 Skill 边界

- [ ] Git 中的 Skill 仍为权威版本。
- [ ] OV Skill 仅作为部署副本，不允许 Agent 自行新增或修改。
- [ ] DSH Skill 与 OV Skill 的名称、版本和内容来源保持可追踪，不维护两份人工编辑副本。

### 6.4 完成标准

- [ ] 一份面经、一份简历和一份 JD 可以导入并按 URI 读取。
- [ ] 公共面经与用户私有资料不能跨 namespace 误读。
- [ ] OV 资源 hash 与数据库/对象存储 hash 一致。
- [ ] SDK 故障不会阻塞 API 启动和非 RAG 面试流程。

## 11. 阶段 7：数据库、知识图谱与 OV 混合 RAG

目标：使用现有结构化召回缩小候选范围，再让 OV 完成长文档语义定位和证据读取。

### 7.1 混合检索流程

```text
问题 + 简历项目 + JD + 当前弱项
  -> DB 过滤有效面经、公司、岗位、阶段
  -> 现有知识图谱扩展知识点
  -> 现有题链/难度/弱项逻辑得到候选 post/group
  -> 将候选映射为允许的 OV URI
  -> OV find 或 search(mode="list")
  -> URI 白名单校验
  -> OV read 少量 L1/L2 正文
  -> 组装 evidence bundle
  -> DSH/Native API 评分 Worker
```

- [ ] 保留现有 embedding + graph rerank 作为结构化候选生成器。
- [ ] 只把 `is_valid` 且 OV 同步状态为 `ready` 的面经加入 OV 检索范围。
- [ ] `find()` 作为明确查询和严格限域的默认路径。
- [ ] 需要会话意图扩展时使用 `search(mode="list") + session_id + target_uri`。
- [ ] 首版不使用不支持 `target_uri` 的 context mode 生成正式评分证据。
- [ ] Agent 不能自行传 `target_uri`；范围由 Backend 根据业务候选生成。

### 7.2 Evidence Bundle

- [ ] 统一证据结构：`ov_uri`、`source_type`、`source_id`、`source_hash`、`level`、`score`、`excerpt`。
- [ ] 对 OV 返回 URI 再做前缀和 source mapping 校验。
- [ ] 评分结果中的引用必须来自本次 evidence bundle。
- [ ] `question_attempt.evidence_refs_json` 继续存结构化引用。
- [ ] 为 `interview_turn` 增加结构化 evidence refs 存储，不能只保存数量。
- [ ] 不把完整长文重复写入 turn 表，只存必要摘录和可回查引用。

### 7.3 降级

- [ ] OV 不可用时继续使用现有 DB、embedding 和知识图谱召回。
- [ ] 降级结果标记 `retrieval_source=legacy_graph` 或 `no_external_evidence`。
- [ ] OV 空结果不是业务错误，不触发无界重试。
- [ ] OV 与现有召回结果冲突时，以数据库有效性、题链和权限边界为准。

### 7.4 完成标准

- [ ] 正式评分证据可以回查到数据库记录和源文档 hash。
- [ ] 知识图谱仍负责相关知识点扩展，OV 负责文档定位与读取，职责无重叠真源。
- [ ] 用户 A 的简历/JD 不会进入用户 B 的 evidence bundle。
- [ ] 关闭 OV 后，现有面经召回和面试主流程仍可运行。

## 12. 阶段 8：DSH 与 OpenViking 联动

目标：在 Backend RAG 稳定后，再增加 DSH 的通用长期记忆，不改变正式证据链。

### 8.1 官方 Memory Plugin

- [ ] 安装并固定官方 DSH Memory Plugin 版本。
- [ ] 验证 DSH session 与 OV session 的一一映射。
- [ ] 验证开场注入、每步召回、消息捕获、阈值 commit、teardown commit 和 pending replay。
- [ ] DSH 路径不重复通过 Backend 写入相同消息。
- [ ] 记录异常退出、`SIGHUP` 和强制终止不能保证 commit 的边界。

### 8.2 工具白名单

- [ ] 通用助理任务只允许 `find/search/read/list/tree/grep/glob/health`。
- [ ] `remember` 只在显式复盘或学习任务开放。
- [ ] `write/edit/add_resource/list_watches/cancel_watch` 只允许 Backend。
- [ ] `forget` 永不开放给 Agent。
- [ ] 如果 DSH profile 不能过滤 MCP 工具，增加 allowlist proxy 或关闭 Agent 主动 OV 工具面。

### 8.3 双召回治理

- [ ] 正式评分只消费 Backend 生成的 evidence bundle。
- [ ] DSH Memory Plugin 自动召回只作为偏好、历史事件和执行经验上下文。
- [ ] 自动记忆不得作为“候选人回答正确”的唯一证据。
- [ ] OV 自动提炼结果不得直接覆盖 FEMentor 的用户可见能力画像。

### 8.4 完成标准

- [ ] 通用记忆召回与正式业务证据在日志和输入中可以区分。
- [ ] Plugin 不可用时 DSH 评分和 Backend RAG 仍能运行。
- [ ] 同一 DSH session 不产生重复 OV 会话和重复 commit。

## 13. 后置项

以下工作在上述主链路完成后再单独立项：

- [ ] 自动化评测、变形测试和人工金标。
- [ ] `fast/balanced/quality` 模型路由。
- [ ] Codex/Claude Code one-shot subagent。
- [ ] 公共资源 Watch 和增量站点同步。
- [ ] OpenViking 生产备份、扩容、容灾和多区域部署。
- [ ] 允许用户自定义 Skill 的产品能力与安全审核。

## 14. 阶段交付规则

每个阶段完成时必须：

- [ ] 更新相关架构文档中的“当前状态”和“已知边界”。
- [ ] 运行现有静态检查和受影响路径的集成测试。
- [ ] 记录实际验证层级：静态、进程集成、本地端到端或线上部署。
- [ ] 保留上一运行路径的独立开关，不复用业务 pipeline flag。
- [ ] 不在同一提交中混入无关 UI、依赖管理或数据库重构。
- [ ] 涉及用户可见 Agent 输出的阶段必须通过对应 Prompt Injection、越权输出、敏感信息和流式泄露回归用例。
- [ ] 未完成验收条件时，不把下一阶段能力接入默认主流程。
