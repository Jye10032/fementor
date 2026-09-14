# FEMentor DSH-first Agent Runtime 与 OpenViking 方案

- 版本：v1.0
- 日期：2026-08-26
- 状态：方向已确认，待分阶段实施

## 1. 目标

FEMentor 保持开源、自部署和线上托管两种使用方式，同时避免把面试业务绑定到某个模型、Agent CLI 或尚未稳定的 Agent Harness。

本方案确定五个边界：

1. FEMentor 自己负责面试 Workflow、业务状态、评分契约、配额、审计和持久化；PostgreSQL 是唯一业务关系库。
2. OpenViking 负责面试所需知识、记忆、资源和 Skill 的组织与检索。
3. DSH、Codex、Claude Code 和直接 API 调用属于可替换的 Agent 执行能力。
4. 线上托管版与开源本地版都以 DSH 为默认 Agent Runtime，但使用不同的配置、认证和权限策略，并共享相同的业务协议。
5. SQLite 仅作为历史数据迁移源，不再作为新功能或运行时 fallback；本地开发通过 Docker Compose 使用 PostgreSQL。

第一阶段已经确认：

1. 线上托管版使用服务端固定配置的 `DshRuntime`，由 DSH provider 调用固定模型 API。
2. 开源本地版同样使用 DSH 原生 Agent，通过部署者维护的 provider 配置接入不同模型。
3. 第一阶段不接入 OpenViking 和 Codex/Claude Code subagent，先完成 DSH 原生 Agent、插件、Skill、Workflow 和单轮评分切片。
4. Codex/Claude Code 作为后续可选 Worker，只在评测证明有收益的任务上启用。

“DSH-first”限定的是 Agent 能力主线，不表示所有基础设施都必须等待 DSH 完成。PostgreSQL 单库收敛可以与 DSH 基础能力并行实施，但必须在 OpenViking 资源映射和同步前完成。

### 1.1 方案选择

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| DSH 原生 Agent + 多模型 Provider | 采用 | 先复用 Agent Loop、插件、Skill 和 Workflow 基础设施，同时用 adapter 隔离 RC 版本变化 |
| 直接自研 FEMentor 专属 Agent Loop | 暂缓 | 领域 Workflow 仍由 FEMentor 持有，但首期没有必要重复实现通用 runtime、工具循环和扩展机制 |
| 首期直接把 Codex/Claude Code 当主 Agent | 不采用 | 两者在 DSH 中当前更适合 one-shot Worker；会话状态、成本和权限边界不适合直接承载整场面试 |
| 立即迁移到“万物皆插件”的完整平台 | 不采用 | 当前最需要验证的是一个评分纵向切片，不先建设泛化插件平台 |

这不是永久排除自研 Agent 或 Codex/Claude Code。只有 DSH 原生能力无法满足明确任务，且后续评测能证明收益时，才增加新的 Runtime 或 subagent provider。

## 2. 总体架构

```text
                         FEMentor Domain Workflow
                出题 / 回答 / 评分 / 追问 / 复盘 / 练习
                                      |
                    +-----------------+-----------------+
                    |                                   |
             AgentRuntime                      OpenVikingGateway
                    |                                   |
          +---------+---------+               OpenViking TypeScript SDK
          |                   |             确定性导入 / 检索 / 证据读取
  NativeApiRuntime        DshRuntime
                              |
                       DSH Native Agent -------- OpenViking DSH Memory Plugin
                              |
                  +-----------+-----------+
                  |           |           |
              fast model  balanced model  quality model

                  后续阶段按需增加：
                    Codex / Claude Code subagent
```

核心原则：**Workflow-first，Agent-as-runtime，OpenViking-as-context workspace**。

OpenViking 不是一个只返回相似文本片段的向量数据库。它提供 `resources / memories / skills / sessions` 统一上下文文件系统、L0/L1/L2 渐进读取、检索、会话归档、长期记忆提炼和版本能力。向量索引是其检索镜像，不是 FEMentor 的事实源。

模型或 Agent 可以提出评分、检索和追问建议，但最终的状态流转、数据库写入、配额检查、重复题检查和审计记录必须由 FEMentor 服务端完成。

## 3. 部署形态

### 3.1 线上托管版

调用链：

```text
Web -> FEMentor API -> DshRuntime -> DSH Native Agent -> 固定模型 API
                      -> OpenViking Service
```

约束：

1. 模型 provider、API endpoint、模型白名单和降级策略由服务端固定配置。
2. Runtime、Cordis Profile、Skill、Tool、Workflow 和 subagent 均由服务端固定，前端不提供选择或上传入口。
3. 不向普通用户暴露自定义 LLM Base URL、API Key 或模型覆盖能力。
4. 不接收或复用用户本机 Codex、Claude Code、DSH 的认证信息。
5. 服务端统一控制超时、重试、结构化输出、成本和调用审计。

### 3.2 开源本地版

优先调用链：

```text
Web -> Local FEMentor API -> DshRuntime -> DSH Native Agent -> 不同模型 Provider
                             -> Local OpenViking
```

初步策略：

1. 默认使用 DSH 原生 Agent；模型通过代码、环境变量或 DSH provider 配置接入。
2. DSH 未安装或配置不可用时明确返回 `runtime_unavailable`，不静默退化到 `NativeApiRuntime`。
3. 浏览器不得直接读取本机 Agent 凭证；本机 Agent 的认证由 DSH、Codex 或 Claude Code 官方机制负责。
4. FEMentor 不解析、不上传 Codex/Claude 的私有凭证和会话文件。
5. DSH 当前仍处于 RC 阶段，因此只能位于适配层，不能成为 FEMentor 业务事件和存储格式的一部分。
6. 第一阶段保持 Agent Loop、Skill、工具和权限策略一致，为后续模型评测保留可比较基础。

本地版与托管版共享 PostgreSQL schema 和 migration。缺少 `DATABASE_URL` 时 API 必须明确报错，不能静默切换到 SQLite，避免同一套功能因部署配置不同而写入不同数据库。

“DSH 是否为开源版必选依赖”暂未最终决定。当前倾向是默认使用但不强制依赖。

## 4. DSH 与 Codex 的关系

DSH 不只是把 Codex 当作一个模型。当前 DSH 包中存在：

- `@deepseek-ai/dsh-subagent-codex`：通过 Codex 官方 app-server 协议执行一次性 Codex subagent。
- `@deepseek-ai/dsh-subagent-claude-code`：通过 Claude Agent SDK 执行一次性 Claude Code subagent。

因此从 FEMentor 外部看，DSH 是一个 Agent Runtime；从 DSH 内部看，Codex 和 Claude Code 是可选择的 Subagent Provider。

第一阶段不启用 Codex/Claude Code subagent，也不维护对应的直连接口。只实现：

1. `DshRuntime`
2. `NativeApiRuntime`

完成 DSH 原生 Agent 的模型评测后，再判断哪些任务需要 Codex/Claude Code one-shot subagent。只有在 DSH 无法提供所需能力或稳定性不足时，才考虑增加 `CodexRuntime`、`ClaudeCodeRuntime` 直连适配器。

## 5. AgentRuntime 初步契约

```ts
type AgentRuntimeId = "native-api" | "dsh" | "codex" | "claude-code";

type AgentCapabilities = {
  tools: boolean;
  skills: boolean;
  openViking: boolean;
  filesystem: boolean;
  sandbox: boolean;
  structuredOutput: boolean;
  sessionResume: boolean;
};

type AgentSessionRef = {
  id: string; // FEMentor internal ID
  runtimeId: AgentRuntimeId;
};

type AgentSessionRequest = {
  interviewSessionId: string;
  runtimeConfigRef: string;
};

type AgentRunRequest = {
  runId: string;
  session: AgentSessionRef;
  taskType: "evaluate-answer" | "generate-questions" | "suggest-follow-up" | "retrospect";
  input: unknown;
  contextRefs: string[];
  skillRefs: string[];
  outputSchema: unknown;
  budget: { deadlineMs: number; maxSteps: number; maxTokens?: number };
};

interface AgentRuntime {
  id: AgentRuntimeId;
  capabilities(): Promise<AgentCapabilities>;
  startSession(request: AgentSessionRequest): Promise<AgentSessionRef>;
  runTurn(request: AgentRunRequest): AsyncIterable<AgentEvent>;
  resumeSession(session: AgentSessionRef): Promise<void>;
  cancelTurn(runId: string): Promise<void>;
  closeSession(session: AgentSessionRef): Promise<void>;
}
```

`AgentSessionRef` 是 FEMentor 生成的稳定引用，内部映射 DSH session ID；它不向领域层暴露 DSH 对象。`NativeApiRuntime` 也实现同一生命周期，但可以使用无状态的轻量 session。`AgentRunRequest` 只包含 session ref、任务类型、业务输入、上下文引用、Skill 引用、输出 Schema 和执行预算，不透传 DSH 内部对象。

`AgentEvent` 应收敛为 FEMentor 稳定事件，例如：

- `started`
- `status`
- `tool_call`
- `tool_result`
- `output_delta`
- `completed`
- `failed`

会话恢复只恢复 Agent 执行上下文，不直接恢复或推进面试业务状态。FEMentor 必须先从 PostgreSQL 读取 `interview_session` 和待处理 turn，再决定是否允许调用 `resumeSession()`。

## 6. OpenViking 官方集成方案

### 6.1 采用的官方使用模式

OpenViking 官方视频与 Coding 方案采用的是同一条上下文闭环：

```text
资源导入
  -> 按业务目录组织
  -> L0 快速筛选
  -> L1 理解与导航
  -> L2 按需读取原文
  -> Agent 执行与验证
  -> 中间产物、结果和经验回写
```

映射到 FEMentor：

1. `resources` 保存可引用的简历、JD、面经和公开知识。
2. `memories` 保存跨场次发生过的事件、偏好、实体和可复用经验。
3. `skills` 保存面试 Agent 可按需加载的任务说明和 rubric。
4. `sessions` 保存一次 Agent/面试上下文的消息、归档和记忆变更记录。
5. FEMentor Workflow 决定何时检索、允许访问哪些范围，以及 Agent 结果是否写入业务库。

沿用官方 Coding 方案的职责表述：**记忆负责发生过什么，检索负责去哪里找，FEMentor 的业务库和对象存储负责现在是什么**。

### 6.2 双通道接入

目标架构不自建一套包含自动召回、消息捕获和 commit 的 `OpenVikingContextProvider`，而是拆成两条边界清晰的官方接入通道：

```text
FEMentor Backend -> @openviking/sdk -> OpenViking
  负责资源导入、处理状态、限定范围检索、L0/L1/L2 读取和证据引用

DSH Native Agent -> OpenViking 官方 DSH Memory Plugin -> OpenViking
  负责会话开场注入、每步自动召回、消息捕获、阈值/teardown commit 和模型工具面
```

这两条通道在 DSH 基础能力和业务切片完成后再分阶段接入。FEMentor 侧只保留一个薄的 `OpenVikingGateway`，封装身份、超时、范围校验、SDK 错误和观测字段，不重复实现 OV 的分层检索器、Session 归档或记忆提炼逻辑。

官方 DSH 插件会把每个 DSH session 映射为独立 OV session，subagent 也会创建独立 session。因此 DSH 路径下 FEMentor 不应再次把同一批消息写入另一个 OV session；只保存 DSH session、OV session URI 与业务 `interview_session.id` 的映射。

### 6.3 权威存储边界

| 数据 | 权威存储 | OpenViking 中的角色 |
| --- | --- | --- |
| 用户、面试场次、题目、回答、评分、配额 | PostgreSQL | Session 上下文或引用，不作为业务真源 |
| 简历、JD 原文件和解析结果 | 对象存储或本地文件 + 数据库元数据 | 用户私有 `resources` 镜像 |
| 公开面经原文、清洗结果、题目结构 | PostgreSQL | 公共 `resources` 镜像，供语义导航和证据读取 |
| 用户可见的能力画像和复盘结论 | FEMentor 结构化记录 | 可投影为 `memories`，用于辅助召回 |
| DSH 会话归档和自动提炼记忆 | OpenViking | Agent 的辅助长期上下文，不直接覆盖业务画像 |
| 面试策略、评分规则、Workflow Skill | Git 中的版本化 Skill 文件 | 部署到 `skills` 的运行时副本 |
| L0/L1 摘要、向量、检索分数 | OpenViking | 派生索引，可重建 |
| 检索结果 | 非权威临时数据 | 返回 URI、层级、分数、来源和按需正文 |

资源导入失败或 OV 暂时不可用，不应影响数据库和对象存储中的原文件有效性。业务数据删除时必须由 FEMentor 发起显式清理任务，并记录数据库、对象存储和 OV 三处的删除结果。

### 6.4 URI 与目录设计

使用不可变的内部 UUID，不使用邮箱、文件名或用户输入直接构造 URI。

```text
viking://resources/fementor/
└── experiences/
    └── {experience_post_id}/
        ├── source.md
        └── normalized.md

viking://user/{ov_user_id}/resources/fementor/
├── resumes/{context_resource_id}/
│   ├── source.md
│   └── parsed.md
└── jds/{context_resource_id}/
    ├── source.md
    └── parsed.md

viking://user/{ov_user_id}/memories/
├── preferences/
├── entities/
├── events/
├── cases/
├── trajectories/
└── experiences/

viking://user/{ov_user_id}/sessions/{ov_session_id}/
viking://user/{ov_user_id}/skills/{skill_name}/
viking://agent/skills/{shared_skill_name}/
```

面试场次不复制简历和 JD 原文。现有简历/JD 没有独立业务表 ID，因此由派生同步表的 `context_resource_id` 映射当前文件或对象存储路径；面经直接使用现有 `experience_post.id`。`interview_session` 保存本次使用的资源引用、允许的面经集合和对应 `viking://` URI。这样同一资源只导入一次，场次通过不可变引用固定证据范围。

公共面经只放已审核、允许所有租户访问的内容。用户上传、私有面经和未公开材料必须放在用户 namespace，不能放入 `viking://resources`。

### 6.5 用户、Peer 与会话隔离

托管版建议建立一个 FEMentor account，并为每个 FEMentor 用户映射一个 OV User：

1. ROOT Key 只用于创建 account/user、轮换 Key 和运维，不用于普通数据请求。
2. Backend 为每个业务请求解析出固定 `ov_user_id`，再以该用户身份调用 OV；OV Key 不下发浏览器。
3. `ov_user_id` 使用稳定的内部 ID，禁止让客户端自行传入。
4. 每个 FEMentor Agent run 映射到独立 OV session，并在数据库记录双向关联。
5. 若一个 OV User 下需要隔离多个工作区或外部参与者，再使用 `peer_id`；DSH 进程按 run 显式设置 peer，召回使用 `peer_scope=actor`。

第一阶段不把 `peer_id` 当作用户隔离手段。用户隔离必须由 OV User/API 身份完成，Peer 只是在同一用户内部进一步限定工作区。开源单用户版可以使用一个本地 User，但仍沿用相同 URI 结构，避免以后迁移时重写数据。

### 6.6 资源导入与更新

1. 用户上传文件由 FEMentor 先写入权威存储，再通过 TypeScript SDK `addResource` 导入用户私有目标 URI。
2. 默认异步导入，保存 `task_id / root_uri / source_hash / indexed_at / status`；需要立即检索时才使用有界 `wait=true`。
3. 用户上传文件是一次性快照，内容变化后按新 hash 重新导入，不创建 Watch。
4. 公开面经源、文档站或代码仓库可以由后台任务使用 Watch 增量同步；Watch 的创建、取消和凭证更新只允许 Backend 执行。
5. 检索只使用处理完成且 hash 与权威源一致的资源。旧版本在切换成功后再清理，避免导入窗口导致证据不可用。
6. 对外部来源凭证使用 OV 的结构化鉴权参数，不把 token 嵌入 URL、日志或资源路径。

### 6.7 检索与读取策略

正式评分证据采用“先定位、再读取”的渐进式流程：

```text
FEMentor 生成 query 和允许的 target URIs
  -> find 或 search(mode="list") 返回 L0/L1 候选
  -> FEMentor 校验 URI 仍在白名单前缀内
  -> read 读取少量命中的 L1/L2 正文
  -> Agent 基于 URI + 原文生成评分或追问建议
  -> FEMentor 持久化最终结果和引用
```

调用边界：

| 接口 | FEMentor 用法 |
| --- | --- |
| `find()` | 默认路径。查询意图明确、需要低延迟且必须用 `targetUri` 严格限域时使用 |
| `search(mode="list")` | 查询依赖当前会话语义、需要意图扩展时使用；仍必须传 `session_id` 和允许的 `target_uri` |
| `search(mode="context")` | 仅用于身份和 Peer 已隔离后的通用 Agent 自动召回；首版不用于正式评分证据 |
| `read()` | 只读取通过 URI 前缀校验的少量候选；目录先读 L1，必要时再读 L2 |
| `grep/glob` | 精确术语、题号、公司名或文件定位的补充路径，不替代语义检索 |

`search(mode="context")` 当前不支持 `target_uri`，所以不能满足“本次只允许访问指定简历/JD/面经”的硬约束。DSH 插件可以在用户/Peer 隔离后将其用于记忆自动召回，但该结果不能直接作为正式评分证据。正式评分必须保留可审计的资源 URI、读取层级、source hash/revision 和引用正文。

Agent 可以建议 query 或请求加深读取，但不能传入任意 `target_uri`。目标 URI 由 FEMentor 根据本次 session 的资源引用在服务端生成。

### 6.8 Session、commit 与长期记忆

Native API 路径：

1. 每个 Agent run 创建或复用一个明确映射的 OV session。
2. 只写入对后续理解有价值的 user/assistant 消息和必要的上下文引用；原始大工具输出留在业务日志或对象存储，以 URI 引用进入 OV。
3. 单轮评分完成不立即把模型判断当作稳定记忆。
4. 在 `retrospect` 完成、正常关闭或达到明确阈值时 commit。
5. commit 的 Phase 1 会立即归档，Phase 2 的摘要和记忆提炼异步执行；需要记录 `task_id` 并观测完成/失败，不能把 accepted 当作已提炼完成。

DSH 路径由官方 Memory Plugin 捕获消息并在 token 阈值或 teardown 时 commit，FEMentor 不重复写入和提交。异常退出可能留下未 commit 的尾部消息，pending queue 会在后续会话重放，但 `SIGHUP`、强制终止等路径不能视为已持久化成功。

OV 自动提炼的记忆只用于后续 Agent 召回。用户可见的 `stable_strengths / stable_weaknesses / recommended_focus` 仍由 FEMentor retrospect 流程生成、校验和持久化，不能被 OV 自动记忆直接覆盖。

### 6.9 DSH Agent 的 OV 工具策略

官方 DSH 插件会向模型提供统一 MCP 工具面。FEMentor 必须在真实工具层做白名单控制，不能只靠 prompt 约束：

| 策略 | 工具 |
| --- | --- |
| 默认允许 | `find`、`search`、`read`、`list`、`tree`、`grep`、`glob`、`health` |
| 仅在显式复盘/学习任务允许 | `remember` |
| 仅 Backend 允许 | `write`、`edit`、`add_resource`、`list_watches`、`cancel_watch` |
| Agent 永不允许 | `forget` |

`forget` 是不可恢复删除，而且 MCP 层不区分 memory/resource/skill，风险不能通过命名约定消除。MCP 也不能新增 Skill，Skill 发布应走部署脚本、REST 或 `ov add-skill`。

上述“默认允许”只适用于通用助理任务。正式评分 Worker 不直接获得通用 `find/search/read` MCP 工具，而是接收 Backend 已限定范围并读取完成的 evidence bundle，或只获得 FEMentor 自己封装的 `retrieve_interview_evidence` 工具。这个工具的输入不包含 `target_uri`，目标范围只能由服务端根据 `interview_session` 生成。

如果当前 DSH profile 无法按工具名过滤，则接入 OV Agent 工具面时应增加 FEMentor 控制的 MCP allowlist proxy，或关闭 Agent 主动 OV 工具面，仅保留 Backend SDK 的确定性检索。不能在全量 15 工具暴露的情况下依赖模型自律。

## 7. Skill 与 Workflow

Skill 用于封装可版本化、可审查的面试能力，例如：

- `resume-grounded-question`
- `frontend-answer-evaluation`
- `evidence-retrieval`
- `follow-up-suggestion`
- `interview-retrospect`

Skill 负责告诉 Agent 如何完成一个有边界的任务；FEMentor Workflow 负责决定何时调用、调用次数、输入范围和结果是否生效。

Skill 的 Git 仓库版本是权威源，OpenViking 中的是部署副本。官方 `add_skill` 当前始终写入 user-scoped Skill 根，因此接入 OV Skill 时把产品 Skill 通过部署任务同步到各运行用户的 `viking://~/skills`。`viking://agent/skills` 只作为未来的共享只读根，必须先验证官方支持的管理写入机制。任何 Skill 更新都必须经过校验、版本记录和回滚，不允许面试 Agent 自行改写。

不采用“让 Agent 自由决定整个面试流程”的方式。第一阶段由 FEMentor Workflow 调用 DSH 原生 Agent 完成有边界的任务，不启用 subagent。后续只把 Codex/Claude Code subagent 用于代码分析、项目仓库核查或复杂证据复核等局部 Worker。

## 8. 安全与失败降级

1. 所有 Agent 调用必须有超时、最大轮数、最大并发和取消机制。
2. DSH/Codex/Claude Code 的文件系统权限应默认限制在 FEMentor 工作目录和显式资源目录。
3. OpenViking 不可用时，面试主流程可以继续，但结果标记为“无外部证据”。
4. DSH 不可用时明确提示运行时不可用，不自动切换到 `NativeApiRuntime` 或未知模型；Native 路径只允许部署者显式配置用于迁移和调试。
5. Agent 输出必须通过 FEMentor Schema 校验，失败时重试一次或进入确定性 fallback。
6. 工具白名单、追问次数、重复题检查、数据写入和审计始终由 FEMentor 控制。
7. 只有启用 DSH Memory Plugin 后才做有界 OV 健康探测；连续失败时跳过插件自动召回并降级，避免官方插件的同步 pre-step 健康检查反复阻塞请求。
8. `/health` 只证明服务进程存活；部署和启动时还需要 `openviking-server doctor` 验证模型、存储和鉴权配置。
9. OpenViking 的 ROOT Key、外部资源凭证和用户 Key 不进入 prompt、Agent 工具结果或浏览器响应。

## 9. 待社区调研的问题

1. DSH 官方建议宿主应用通过什么稳定接口启动任务、消费流式事件和取消任务？
2. `dsh-subagent-codex` 是否复用本机 Codex 登录态，部署时有哪些认证约束？
3. Codex/Claude Code subagent 的工作目录、权限、沙箱和超时如何配置？
4. one-shot subagent 是否适合面试场景，还是应由 DSH 主 Agent 保持会话、按任务调用 subagent？
5. DSH 的 Skill、Workflow 和 OpenViking/MCP 类上下文工具应如何组合？
6. DSH RC 版本的协议稳定性、升级兼容策略和生产使用建议是什么？
7. 是否已有将 DSH 嵌入 Web/API 产品、而不是直接作为交互式 Agent 使用的参考实现？

## 10. 实施顺序

具体任务与验收条件见 [分阶段实施清单](todolists/agent-runtime-openviking-implementation-todolist.md)。执行分为两条主线，并在 OV 接入前汇合：

1. Agent 主线先定义 `AgentRuntime`、`AgentEvent` 和 capability contract。
2. 固定 DSH 版本，通过官方 subprocess SDK 实现 `DshRuntime`。
3. 验证 DSH 插件、Skill、Workflow 和工具白名单。
4. 先把单轮回答评分作为纵向切片接入 DSH，再逐个迁移出题、追问建议和复盘 Worker。
5. 数据主线并行按 [PostgreSQL 单库收敛设计](postgresql-single-database-convergence-design.md) 结束运行时双驱动，稳定业务 ID 与 migration。
6. 两条主线均通过各自验收后，在 PostgreSQL 中建立资源、outbox、OV 同步状态和 Session 映射。
7. 接入 `@openviking/sdk`，实现薄 `OpenVikingGateway` 和异步资源同步。
8. 保留现有面经 embedding 与知识图谱召回，用 OV 补充长文档语义定位和证据读取。
9. Backend RAG 稳定后，再安装官方 DSH Memory Plugin 完成长记忆闭环。
10. 评测、模型路由和 Codex/Claude Code one-shot subagent 作为后置独立阶段。

```text
Agent 主线: Runtime contract -> DshRuntime -> 插件/Skill/Workflow -> 评分切片 -> 其他 Worker
                                                                  \
                                                                   -> OV 映射/同步 -> 混合 RAG -> Memory Plugin
                                                                  /
数据主线: PostgreSQL 基线 -> repository 收敛 -> SQLite 导入/切换 -> graph 回归
```

## 11. 当前未决项

- 开源版是否强制安装 DSH。
- 托管版具体使用哪家模型 API 和模型白名单。
- 托管版 OpenViking 采用同机服务还是独立服务部署，以及备份、扩容和恢复目标。
- Skill 的仓库位置、版本协议和分发方式。
- Codex/Claude Code subagent 的启用门槛和候选任务。
- 本地版如何展示运行时发现、认证状态和 capability 差异。
- DSH profile 是否支持可靠的 MCP 工具级 allowlist；若不支持，采用哪种只读代理。
- DSH Memory Plugin 能否按 FEMentor 需要限制 memory policy；在验证前，自动记忆只作辅助上下文。
- 公共面经从业务库同步到 OV 的更新粒度、删除传播和 source revision 协议。

## 12. DSH GitHub 调研结论

调研基线：`deepseek-ai/deepseek-harness` `master@b150a55`，版本 `0.1.1-rc.2`；2026-08-26 已重新确认 master commit 和关键文档链接仍有效。以下结论来自官方文档、当前源码契约和 GitHub Discussions，仍需在 FEMentor 原型中验证。

### 12.1 推荐的宿主集成接口

DSH 官方当前提供 Python SDK 和 TypeScript `@deepseek-ai/dsh-sdk-client`，两者通过子进程 stdio JSON-RPC 驱动完整 runtime。FEMentor 的 `DshRuntime` 应优先使用这一接口，不直接依赖 DSH Web Host、Cordis、Typert 或内部 API Gateway 类型。

API Gateway 当前主要覆盖 unary Remote，并不提供稳定的 session 增量事件协议。DSH 仍处于 developer preview，官方明确提示后续可能发生破坏性变更。

参考：

- [Python SDK guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/python-sdk.md)
- [TypeScript SDK client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)
- [API Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/api-gateway.md)
- [Discussion #2981](https://github.com/deepseek-ai/deepseek-harness/discussions/2981)
- [Discussion #4377](https://github.com/deepseek-ai/deepseek-harness/discussions/4377)

### 12.2 Codex 与 Claude Code subagent 的真实能力

Codex provider 会启动 DSH 包内精确锁定版本的 Codex wrapper，通过 `app-server --stdio` 创建临时 thread；Claude Code provider 会通过包内 Agent SDK 启动新的 CLI process。它们调用的是真正 Agent，不只是同名模型。

两个 provider 当前都是 one-shot：每次调用创建新进程和新会话，只返回最终结果，不支持 continuation、resume、process pool 或完整 progress stream。因此它们适合简历分析、单题校验、证据摘要等自包含 Worker，不适合承载整场面试状态。

本地认证可以通过 `HOME`、`CODEX_HOME` 和产品原生设置读取已有登录态，但 DSH 不应复制或上传这些凭证。credential-shaped 环境变量默认会被清理；显式 API Key 需要由 provider 配置主动注入。

参考：

- [Codex provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-codex/README.md)
- [Claude Code provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-claude-code/README.md)
- [Subagent subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md)

### 12.3 取消、超时与沙箱边界

Codex/Claude Code provider 当前没有 wall-clock timeout 和副作用回滚。provider 的 `dispose()` 可以终止整个 process tree，但 SDK wire 没有单次 prompt 的中途取消；必要时只能关闭并重建整个 runtime。

DSH workflow worker 虽支持 cancel/dispose 和并发上限，但官方明确说明 `node:vm` 不是安全边界。FEMentor 仍需自行提供 deadline、成本预算、并发配额、重复任务指纹、进程关闭重建、独立工作目录和副作用审计。

参考：

- [SDK client limitations](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)
- [Workflow subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/workflow.md)
- [Workflow worker thread](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/workflow/workflow-worker-thread/README.md)
- [Discussion #4449](https://github.com/deepseek-ai/deepseek-harness/discussions/4449)

### 12.4 OpenViking 与 Skill 的组合方式

DSH 社区调研阶段建议把 OpenViking 拆成 Skill 和检索工具。结合后续确认的 OpenViking 官方 DSH 插件，目标架构进一步收敛为：

```text
OpenViking 官方 DSH Memory Plugin
  -> 自动召回、会话捕获、commit、openviking-memory Skill

FEMentor OpenVikingGateway
  -> 限定范围检索与读取，返回 URI、source revision、score 和正文
```

Skill 负责提供按需加载的任务说明；官方插件负责 DSH 的通用记忆闭环；Gateway 负责正式业务证据。是否检索、检索范围和结果是否进入评分仍由 FEMentor 状态机决定。

参考：

- [Skills subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md)
- [Skill registry](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill/README.md)

### 12.5 对最终方案的影响

第一阶段只维护：

1. `NativeApiRuntime`
2. `DshRuntime`

`DshRuntime` 通过官方 subprocess SDK 接入，并在 adapter 内把 JSON-RPC notification 转换为 FEMentor 自有事件。第一阶段只运行 DSH 原生 Agent，通过 provider 切换不同模型。Codex、Claude Code subagent 延后接入，暂不实现对应直连 adapter。

DSH 依赖必须精确锁定版本并建立兼容测试，不使用 caret 范围自动升级。如果 RC 阶段的 SDK 或插件 ABI 持续破坏核心体验，本地版应能退回 `NativeApiRuntime`。

参考：

- [DSH README](https://github.com/deepseek-ai/deepseek-harness)
- [Release PR #2908](https://github.com/deepseek-ai/deepseek-harness/pull/2908)
- [Discussion #4473](https://github.com/deepseek-ai/deepseek-harness/discussions/4473)
- [Discussion #1711](https://github.com/deepseek-ai/deepseek-harness/discussions/1711)

## 13. OpenViking 官方资料依据

本轮调研日期为 2026-08-25，关键官方链接于 2026-08-26 重新验证可访问。OpenViking 文档更新较快，进入实现阶段时仍需要再次核对 SDK 类型和插件版本。

- [视频创作方案](https://www.openviking.ai/solutions/video)：业务目录、L0/L1/L2 渐进读取和产物回写闭环。
- [Coding Agent 方案](https://www.openviking.ai/solutions/coding)：resources/memories 分工、跨会话记忆与“当前事实”边界。
- [核心概念](https://www.openviking.ai/concepts)：URI、Resource/Memory/Skill、分层上下文和版本能力。
- [API 概览](https://docs.openviking.ai/zh/api/01-overview)：TypeScript/Python/Go SDK、HTTP、CLI 和认证入口。
- [资源 API](https://docs.openviking.ai/zh/api/02-resources)：资源类型、异步处理、目标 URI、tags 和 Watch。
- [检索 API](https://docs.openviking.ai/zh/api/06-retrieval)：`find`、`search`、context mode、分层结果和范围限制。
- [会话 API](https://docs.openviking.ai/zh/api/05-sessions)：消息、归档、commit 两阶段、异步记忆提炼和审计记录。
- [记忆 API](https://docs.openviking.ai/zh/api/16-memory)：内置记忆类型和预算召回。
- [Skill API](https://docs.openviking.ai/zh/api/04-skills)：user-scoped Skill、校验、更新和删除边界。
- [多租户 API](https://docs.openviking.ai/zh/api/08-admin)：ROOT/ADMIN/USER、Account/User 和 API Key 管理。
- [服务端快速开始](https://docs.openviking.ai/zh/getting-started/03-quickstart-server)：服务启动、`doctor`、`health` 和认证。
- [DSH Memory Plugin](https://docs.openviking.ai/zh/agent-integrations/17-dsh)：DSH 进程内插件、自动召回、消息捕获、pending 和 session 映射。
- [Agent 集成能力参考](https://docs.openviking.ai/zh/agent-integrations/16-capability-reference)：MCP 工具面、commit 生命周期、删除风险和各 Harness 差异。
