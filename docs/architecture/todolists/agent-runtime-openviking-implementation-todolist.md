# 多 Runtime、Railway Sandbox 与共享能力分阶段实施清单

- 版本：v2.6
- 日期：2026-10-15
- 状态：自主主 Agent + 串行专家的测试环境链路通过；主子同时强退专项及前端部署待完成
- 依据：[多 Agent Runtime 主方案](../agent-runtime-openviking-preliminary-design.md)、[Railway Sandbox 运行设计](../railway-agent-sandbox-design.md)

## 1. 实施目标与基线

从 DSH-first 调整为“FEMentor 持有业务 Workflow + 外层隔离环境 + 可替换 Agent Runtime”。首先在 Railway Sandbox 验证 Codex 单轮评分，再接 Claude 和按需自研 Agent；共享同一套领域能力、Schema、记忆访问和正式提交逻辑。

代码核对基线为 `c804e72`。在此基线上已新增 Codex/Railway 合成原型，现有 `native-api`/`dsh` 契约、执行器、评分接入和 migration 003 保持。已补上 Codex 外层出网治理及真实面试入口；Claude 直连、生产灰度与多副本调度未完成。旧清单中的 DSH 配置完成标记只适用于旧路径，不代表以下新增任务完成。

原 DSH 专属 Worker Pool、DSH 必选插件与 Codex one-shot subagent 前置路线停止作为本清单实施顺序。保留现有实现，迁移按任务灰度且可显式回退。

### 2026-10-10 首个切片验收

- [x] 固定合成 React key 题目，经本机 FEMentor → Railway Sandbox → Codex App Server → 真实模型 → FEMentor Validator 完成单轮评分。
- [x] 返回 93 分，四维 23/24/22/24；Schema 与总分一致性校验通过，保持标准化结果结构。
- [x] 模型转发复用 SDK 控制通道；真实模型 key/Railway token 留在宿主，VM 只接收无凭证配置。
- [x] Agent 以 UID 1001、NoNewPrivs、只读输入/能力目录运行，默认 ISOLATED 且无公开域名。
- [x] 成功 run `183eebe4-69ec-4348-a589-66aa504017a1` 销毁确认；本次 7 个调试/验收 Sandbox 全部清理，平台列表无本次遗留活跃实例。
- [x] 47 项 Runtime 测试通过，独立静态审查问题已修正。
- [x] 将 Codex 注册到真实面试流程，使用独立合成数据经现有 HTTP/SSE → turn service → 真实 Sandbox → Validator → SQLite 短事务验收。
- [ ] 部署并开启真实用户灰度；须先完成下方真实材料与可靠性门槛。

源文件、运行/清理命令与完整证据见 [实施记录](../railway-agent-sandbox-design.md#9-2026-10-10-首个实施切片)。以下仅勾选完整覆盖的子项，不把这次通过视为整个 B/C/D 阶段完成。

### 2026-10-10 第二个切片验收

- [x] root 创建独立 network/PID/mount namespace，仅启用 lo；随后降权、清空 capabilities 并设置 NoNewPrivs，Codex 和 bridge 继承同一隔离。
- [x] 任务材料上传前及 bridge 启动前执行内核探测：公网/私网 IPv4/IPv6、metadata、UDP DNS 拒绝；DNS 查询失败；loopback 正常；路由修改、namespace reentry、提权拒绝。
- [x] 真实面试入口支持 answer 与 skip/clarify 等非回答分支、关键词和候选追问 Schema；服务端决定后续动作。
- [x] Codex 分支原子提交评分/题目/关键词变化；快照过期、取消、非法评分不写库、不发送评价 token。
- [x] 请求断开取消、进程内并发 1、持久化清理记录与遗留资源阻塞；修复创建前取消误记 unknown、鉴权期间断开漏监听两项审查问题。
- [x] 合成真实接口验收 run `0f8a6ad1-e2db-45a3-8a5b-543e7a4ab532`：92 分、题目推进与关键词结束、重复/跨用户拒绝、销毁确认。
- [x] 披露限制复验 run `72a7c8dc-7bf3-49eb-a294-e082e3d0bccb` 通过；120 秒超时样例确认无评分写入且销毁。最终目标环境无活跃 Sandbox。
- [x] 全部 91 项 API 测试通过；包含真实路由、断开取消、事务回滚、过期候选、非回答和创建前取消。
- [ ] 生产 PostgreSQL 实测、多副本持久化租约/配额、未知创建对账、独立回收器与真实用户灰度；已知 ID 的单 owner 回收见第四个切片。

详细范围与命令见 [第二个切片记录](../railway-agent-sandbox-design.md#10-2026-10-10-出站隔离与面试接口接入)。该切片当时仅验收 SQLite；后续独立 PostgreSQL 实测见下节。

### 2026-10-10 第三个切片：云端测试部署

- [x] 在 `codex-staging` 创建单独 API、PostgreSQL 16 和持久化卷；生产服务及用户数据未切换。
- [x] API 单副本、Node 24、部署前 migration、健康检查；运行 journal 持久化在 `/data`。
- [x] 公网 HTTPS/SSE → 云端 API 验签 → 私网 PostgreSQL → Codex Sandbox → Validator → 销毁 → 事务提交；合成回答 84 分，run `56e28031-e9c8-49c6-8b5b-eeb4ac41595b`。
- [x] 数据库仅写 1 条评分、题目与关键词推进；匿名/伪造签名 401、跨用户 403、重复回答 409，SSE 披露及 Runtime 选择检查通过。
- [x] PostgreSQL 实库的约束冲突整体回滚、快照过期与取消拒绝提交；无部分写入。
- [x] 每次运行的内核网络探测通过，平台确认 Sandbox 已销毁。
- [x] 测试 API 正常重启后，PostgreSQL 评分/题目/关键词与卷上的运行 journal 均保留；生产部署版本复核未变化。
- [x] 独立部署源码快照的 91 项 API 测试通过；部署产物、测试结果和资源审计可核对。
- [ ] 未知创建对账、独立回收器、跨进程租约/配额、完整 crash recovery、Clerk 前端登录与真实用户灰度；已知 ID 回收见下一切片。

实际部署、源码 hash、测试身份边界及证据路径见 [第三个切片记录](../railway-agent-sandbox-design.md#11-2026-10-10-railway-测试-api-与-postgresql-验收)。测试 JWT 经过真实签名校验，不代表 Clerk 托管登录已验收。

### 2026-10-10 第四个切片：异常退出后的资源回收

- [x] 启动与定时扫描持久化日志，回收当前 owner 的已知沙箱；排除本进程活动任务，失败退避重试。
- [x] 未知 ID、损坏日志及归属不符保持阻塞；平台确认销毁后才恢复评分。
- [x] 日志写入失败不阻止删除；补写成功前维持不可用；模型配置错误不阻止控制面回收。
- [x] staging 评分中实际 SIGKILL 主 API；自动重启后沙箱销毁，PostgreSQL 评分为 0、题目与关键词未推进。
- [x] 同一面试重新提交成功，90 分、仅 1 条评分；两次沙箱均销毁，生产部署未变化。
- [x] 独立源码快照 99 项检查通过，源码审查问题修复；云端 COPY 文件 hash 与快照一致。
- [ ] API 永久停止时的独立回收、无 ID 创建结果对账、多副本租约与业务重放仍待实现。

精确部署和故障证据见 [第四个切片记录](../railway-agent-sandbox-design.md#12-2026-10-10-异常退出后的资源回收)。当前只支持单 API owner，不将资源回收视为完整业务恢复。

### 2026-10-12 第五个切片：回答持久化与上下文预算

- [x] Codex + unified 先保存不可变回答，再进入模型评分；输入失败/进程退出后可按提交 ID 重试，不要求重传回答。
- [x] 评分、题目推进与完整结果同事务提交；attempt ID 拒绝迟到结果；已完成提交重放结果，不新建沙箱或重复评分。
- [x] 保存完整评价、澄清/跳题响应；网页保留失败输入，刷新同步服务器记录，并按稳定 ID 合并对话。
- [x] 完整保留本轮输入、已有简历摘要和 JD；按 token/字节预算选取已评分历史，超限明确报错并保留回答。
- [x] 独立源码 105 项 API 测试、共享工作区 123 项 API 测试、4 项网页恢复测试及 TypeScript 检查通过。
- [x] Railway 实测 5,324 字符回答：评分中 SIGKILL，重启后回答 hash 不变；只传 ID 重新评分成功，重复 ID 返回同一结果且评分仅 1 条。
- [x] 两次沙箱均销毁、部署源码 hash 校验通过、生产部署保持基线，临时管理 SSH key 已删除。
- [ ] 独立测试前端部署与真实 Clerk 登录页面验收；当前网页只完成本地检查。
- [ ] 其他 Runtime 的回答持久化、非评分对话注入模型历史、多副本接管、自动重放与大窗口压力测试。

证据及实现边界见 [第五个切片记录](../railway-agent-sandbox-design.md#13-2026-10-12-回答持久化与上下文预算)。恢复依赖 FEMentor 的业务记录，新的评分不会续接已终止的 Codex 中间推理。

### 2026-10-15 第六个切片：自主面试主 Agent（测试链路通过）

规格：[自主面试主 Agent v1](../../specs/interview-director-v1.md)；任务细分：[实施计划](../../superpowers/plans/2026-10-15-interview-director.md)。用户确认自主动作/专家选择，Runtime 固定由服务端配置。

- [x] 明确主 Codex 的面试角色、共享能力来源、业务真源、主/子沙箱职责与预算。
- [x] 固定 0.162.1 动态工具协议，主 Agent 只可调用注册专家；评分专家保持无工具权限。
- [x] 串行子任务 admission、父子取消和回收、实际模型输入工具历史校验。
- [x] 专家产物先持久化，主 Agent 仅引用本 attempt 产物，决策与评分/题目变化原子提交。
- [x] 非评分对话加入上下文；澄清保持题目，结束状态持久化与网页恢复。
- [x] 本地权限、协议、业务与回放验证；独立审查。
- [x] Railway 测试 API + PostgreSQL 的真实主/子链路，销毁及生产未变核对。
- [ ] 主子同时活动时的云端强制退出与按提交 ID 重试专项复验。

本切片实测：澄清 → 23 分评分并生成追问 → 结束；5 个 Sandbox 销毁、3 条提交回放、生产未变。评分加追问本次耗时约 4 分 42 秒，后续需优化延迟。记录见 [第六个切片验收](../railway-agent-sandbox-design.md#145-云端复验结果与交付边界)。

## 2. 所有阶段保持的边界

- FEMentor 校验用户与面试归属，实施预算和业务提交；director 路径由主 Agent 选择动作与专家，workflow 保留原规则流程。
- 关系数据、原始文件和派生索引遵循主方案的权威边界；Agent 和 OV 不直接写面试领域表。
- 保留 `experience_post -> question_group -> question_item`、现有 embedding 召回与知识图谱重排；Runtime 本身不决定题链；director 可从宿主提供的候选范围自主选择。
- 共享 Skill 描述任务方法，不替代服务端权限和业务 Validator。
- 外部 Agent 与自研 Agent 均先提交候选；执行完成、结果合法和业务提交三个状态分开。
- 文档验证、进程原型、端到端验收和线上启用分别记录，不互相代替。

## 3. 阶段 A：契约与部署准备

- [x] 核对现有 `AgentRuntime` 接口、评分/SSE 路径和审计表，记录可复用与需迁移部分。
- [ ] 定义 RuntimeProfile、TaskBundle、RunPolicy、ExecutionSession、CandidateResult，保持领域层不依赖厂商线程类型。
- [ ] 区分 Runtime、Model Provider、Sandbox Provider；预算能力报告区分支持、缺失和实际执行。
- [ ] 将 `codex/claude-code/fementor` 作为待启用 ID；只在对应适配器验收后加入可用列表。
- [ ] 服务端 Profile allowlist 限制执行器、固定版本、模型、工具和共享能力包，用户只选择获准 ID。
- [ ] 核对 Railway Sandbox 账户权限、区域、并发预算及主服务 Node.js 22+ / SDK 模块兼容性。
- [x] 固定 Codex/SDK 版本，确认托管模型认证方式；不复用开发者桌面登录态。
- [x] 更新实施期配置模板时明确旧 DSH/native 路径与新路径，不在实现前改变部署默认值。

完成标准：新契约、迁移范围与版本可以核对，现有面试流程行为保持；没有把新增 ID 当成已可运行的执行器。

## 4. 阶段 B：Railway Sandbox 与控制通道原型

本阶段只用合成材料，不连接业务库或真实用户资料。

- [ ] 新增 SandboxManager，封装 create/connect、文件交付、进程通道、健康检查和 destroy。
- [ ] 创建只含固定程序及共享包的干净模板；不包含用户文件、运行日志和认证凭证。
- [x] 设置当前任务只读材料目录、只读能力包和可写临时目录；验证无提权 Agent 身份。
- [x] 默认 `ISOLATED`，不发布域名，不向 Sandbox 下发 Railway/数据库/对象存储管理密钥。
- [x] 通过 SDK exec 的 stdin/stdout 驱动 `codex app-server --listen stdio://`，无需独立 HTTP Worker Server。
- [x] Adapter 完成握手、请求关联、JSONL 分帧、独立 stderr、输出上限、最终状态提取与取消。
- [x] 验证所选 SDK/宿主支持可写 stdin；不兼容时返回明确错误，不默默放开网络。
- [x] 验证外部模型入口认证及限额，真实长期密钥留在受控服务；不允许任意上游转发。（已实现请求次数与每次输出 token 限制；费用额度与总 usage 仍待采集。）
- [x] 验证 Agent 直接公网出站被内核阻断：独立 network namespace 仅 lo，无外部接口/路由，模型经 stdio 中继；`ISOLATED`、HTTP_PROXY 和 Prompt 不作为执行边界。
- [ ] 以 Agent 身份验证读取宿主/其他用户、修改权限、直连数据库/私网/任意外站均被拒绝。
- [ ] 验证 deadline、取消、进程组终止和 Sandbox 销毁确认；记录清理失败补偿。

完成标准：合成任务跑通且所需隔离有实测证据。若 Railway 无法满足网络限制，保持原型状态并更换可实现策略的 SandboxManager 后端，不以关闭约束继续真实数据灰度。

## 5. 阶段 C：共享能力包与 Codex 单轮评分

### C.1 共享包

- [ ] 以 Git 中版本化源文件维护 rubric、输入输出 Schema、Skill、规则和无特权辅助脚本。
- [ ] 从现有 `frontend-answer-evaluation` 提取同源素材，Codex/Claude/自研仅维护加载适配，不手工复制三份。
- [x] 记录共享包版本/hash 和加载清单，未知/未审核插件、任意脚本源和高权限 MCP 均不加载。（当前为宿主直接注入评分 Skill，不是原生插件发现验收。）
- [x] 首期不开放业务查询工具；主服务按身份/面试归属预取题目、回答、近期上下文、简历/JD；当前 evidenceRefs 保持空列表，不冒充已检索证据。
- [ ] 将记忆与事实证据分开标识；无证据时明确记录，不伪造引用。

### C.2 评分与输出

- [x] 复用现有 turn service 和 `evaluate-answer` 输入输出，不复制整套面试状态机。
- [ ] Native API、DSH、Codex 共用服务端 Validator：枚举、必填与条件字段、未知字段、长度、总分 0-100、维度 0-25、总分与维度和及引用范围。
- [ ] 用户输入、简历/JD、面经、记忆和工具结果作为不可信数据；忽略改分、越权、索答和伪造 system/tool 指令。
- [ ] 沿用场景级披露策略：面试进行中不向候选人返回参考答案及不应披露的内部依据；练习与复盘按各自策略输出。
- [x] Codex Schema 实际校验条件字段、未知字段、长度、四维与总分；无效候选不写库、不发评价 token，直接失败。
- [ ] Native/DSH 迁移至相同严格 Validator；按需增加最多一次无副作用修复。
- [x] Codex 保持 SSE `stage/token/result/error` 契约；进度与心跳可流式发送，评价仅在校验、清理与业务提交后发送，参考答案字段留空，不转发原始推理/工具事件。
- [x] Codex 在短事务校验业务快照、会话状态与取消信号，再原子提交评分和队列更新；重复/迟到候选被拒绝。
- [ ] 持久化幂等键、租约/fencing 和提交标记；重复请求读回已提交结果。
- [x] 新路径由部署者配置 `AGENT_RUNTIME=codex` 与启用开关，固定服务端 Profile；失败不自动跨模型或跨 Runtime 重试，浏览器字段不能覆盖配置。

完成标准：合法评分可被现有前端与复盘消费；无效输出、Prompt Injection、证据越界和 SSE 校验前泄露样例不能改变正式结果或披露策略。

## 6. 阶段 D：调度、恢复与真实数据启用

- [ ] 为执行环境、task/attempt、租约/generation、提交状态和回收记录新增 migration；复用而非覆盖现有审计表语义。
- [ ] 明确 migration 003 的状态 CHECK 与目标状态差异，不直接写入不存在的 `queued/committed` 状态。
- [ ] 基于 PostgreSQL 实现原子接单/领取、全局与用户并发、队列上限、排队过期和配额预留/结算。
- [ ] 同一面试顺序执行；一环境绑定一用户/面试/Runtime Profile，禁止跨用户复用历史工作区。
- [ ] 改造逐任务 start/close 语义，按需要复用执行会话；空闲或到达最大存活预算后销毁并从业务快照恢复。
- [ ] API 多实例以持久化租约领取任务，fencing token 拒绝旧 owner 的迟到提交；模型等待不占长事务。
- [ ] SDK 断线先核对旧任务与 Sandbox，再决定恢复/重建，防止同任务双实例执行。
- [ ] 验证 Railway 进程重连和 Codex 会话恢复的差异；不能仅凭重放日志声称无损恢复。
- [ ] 取消/超时先阻断提交，再中断任务并销毁；清理失败进入 cleanup_pending，重启后可补偿孤立环境。
- [ ] 设置 run deadline、环境最大存活预算和回收调度；不依赖长期进程可能绕过的 idle timeout。
- [ ] 记录 runtime/model/profile/Skill/策略版本、模板 hash、耗时、usage 与成本；不可得字段记录 unknown。
- [ ] 完成并发双提交、重启、断线、非法输出、迟到结果和回收失败演练，评分/配额只生效一次。
- [ ] 阶段 B/C/D 验收均通过后，才开启真实用户材料的有限灰度。

完成标准：执行结果和资源生命周期都可追踪；没有以“进程已退出”替代业务提交或资源销毁确认。

## 7. 阶段 E：Claude 接入与可选 Runtime

- [ ] Sandbox 内安装固定版本 Claude SDK/CLI 及最小适配进程，验证服务部署认证、流式输出、会话、取消和结构化结果。
- [ ] 实现 ClaudeAdapter，复用 SandboxManager、TaskBundle、共享包和 Validator；厂商协议留在 Adapter 内。
- [ ] 分别验证 Skill 加载与工具权限，不把某平台的允许列表直接视为另一平台的隔离实现。
- [ ] UI 只展示已验收的 Profile，说明不可用/认证失败状态，不允许浏览器覆盖命令、网络、工具、密钥或模型 Base URL。
- [ ] Runtime 切换在合法任务边界进行，创建新的执行上下文并从业务快照重建；不共享外部私有线程文件。
- [ ] 用同组评分/边界样例核对执行器差异，记录质量、延迟、成本和失败率，不假定能力完全相同。

完成标准：用户可以选择至少两个已验收执行器，业务契约、权限与评分提交规则保持一致。

## 8. 阶段 F：任务扩展、自研 Agent 与主动查询

- [ ] 依次为出题、追问建议、复盘增加独立 Schema/Skill/能力白名单；每个任务单独验收和灰度。
- [ ] 出题数量、去重、追问上限、题库回流、长期画像和练习计划仍由 FEMentor 持久化。
- [ ] 如出现专属上下文/循环/成本需求，实现 `FEMentorAgentRuntime`；直接复用共享定义与服务，不复制业务 Workflow。
- [ ] 自研 Loop 实现有界步骤、工具选择、错误处理、上下文裁剪和 usage 记录；不把 Native API 包装器改名即视为完成 Harness。
- [ ] 如需要主动检索，验证 Codex 动态工具或其他执行器的受控桥接；不支持时继续 TaskBundle 路径。
- [ ] 只开放 `retrieve_interview_evidence/read_allowed_memory/propose_memory` 等窄接口，服务端派生身份和资源范围。
- [ ] 共用记忆写入由主服务审核候选并幂等提交，不依赖厂商插件各自自动写入。

完成标准：新增任务不泄漏执行器内部对象；只有已验证的能力进入可选列表，自研 Agent 不是首期上线前提。

## 9. 并行数据主线：PostgreSQL 单库收敛

目标：与 Runtime 阶段 A-F 并行，在新增 OV 同步状态、资源映射和证据引用前结束 PostgreSQL/SQLite 双实现维护。PostgreSQL 作为本地与托管版唯一运行时业务库；SQLite 只作为一次性历史数据迁移源。详细任务以 [PostgreSQL 单库收敛实施清单](postgresql-single-database-convergence-todolist.md) 为准，本节只保留汇合门槛。

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
- [ ] 本数据主线不引入 OV、DSH、UI 或无关业务重构；它不阻塞合成材料的 Sandbox 原型，但未完成前不得进入正式 OV 资源映射。

## 10. OV-1：为 OpenViking 准备数据映射

目标：不改变现有业务存储的前提下，建立可重试、可审计的 OV 派生同步层。

进入条件：所接业务任务的输入输出及权限已稳定，且 PostgreSQL 数据主线 DB.4 全部通过。不要求 Claude、自研 Agent 或全部任务迁移完成；本节未勾选项需按当前代码重新核对，不能根据旧计划推断缺失或完成。

### OV-1.1 新增同步状态表

- [ ] 确认 PostgreSQL 已具备 `agent_runtime_session`、`agent_run`、`context_resource`、`context_resource_sync`、`context_sync_outbox` 和 `context_session_sync`。
- [ ] 同步表最少包含：稳定 resource ID、`source_type`、`source_key`、`owner_scope`、`owner_user_id`、`source_hash`、`ov_uri`、`status`、`task_id`、`last_error`、`indexed_at`、`created_at`、`updated_at`。
- [ ] `owner_scope` 固定为 `public|user`；分别为公共资源和 `owner_user_id` 非空的用户资源建立 partial unique index。
- [ ] 同步映射显式记录 `ov_target`，`resource_id + ov_target` 建唯一约束。
- [ ] 状态至少包含 `pending/processing/ready/failed/stale/deleted`。
- [ ] 同步记录只描述派生索引状态，不改变业务记录有效性。

### OV-1.2 资源标识

- [ ] 公共面经使用 `experience_post.id` 关联 OV，不依赖可变公司名或职位名拼路径。
- [ ] 建议 URI：`viking://resources/fementor/experiences/{experience_post_id}/`。
- [ ] 简历/JD 当前没有独立业务表 ID，由 `context_resource.id` 提供稳定资源 ID，再关联各目标同步记录。
- [ ] 简历/JD 的 `source_key` 指向现有本地文件或对象存储路径，URI 不暴露真实文件名和用户信息。
- [ ] 每个 OV 资源保留 `source_type/source_key/source_hash`，用于回查权威源。

### OV-1.3 同步触发

- [ ] 业务写事务只写数据库/对象存储和同步状态，不在事务内调用 OV。
- [ ] 事务提交后由后台 worker 导入 OV，并更新 `task_id/status`。
- [ ] 面经新增、重清洗、失效和删除分别产生 `pending/stale/deleted` 同步状态。
- [ ] 简历/JD 保存、覆盖和删除分别产生对应同步状态。
- [ ] 增加 reconciler，能够扫描 DB 与 OV 状态并补偿漏任务。
- [ ] 使用 `content_hash` 幂等去重；相同 hash 不重复导入。

### OV-1.4 完成标准

- [ ] OV 停机时业务写入仍成功，同步状态进入待处理或失败。
- [ ] OV 恢复后可重放，不重复创建多个有效 URI。
- [ ] 可以从任意 OV URI 回查业务 source ID、hash 和存储位置。
- [ ] 删除流程分别记录业务库、对象存储和 OV 的结果。

## 11. OV-2：接入 OpenViking Gateway 与资源同步

目标：先让 Backend 通过官方 SDK 管理资源，不把 OV 工具直接开放给 Agent。

### OV-2.1 服务与 SDK

- [ ] 本地启动 OV 服务并执行 `openviking-server doctor`。
- [ ] `/health` 只作为存活探测，不替代配置诊断。
- [ ] 接入官方 TypeScript SDK，封装薄 `OpenVikingGateway`。
- [ ] Gateway 统一处理身份、超时、错误、任务状态和 URI 前缀校验。
- [ ] 托管版使用 OV User 隔离用户；本地单用户版沿用相同 URI 结构。

### OV-2.2 导入内容

- [ ] 面经 `source.md` 由 `content_cleaned` 生成，并保留原业务引用。
- [ ] 面经 `normalized.md` 可包含 summary、公司、岗位、阶段和结构化题目导航，但数据库仍是真源。
- [ ] 简历/JD 从当前权威文件读取后导入用户私有 namespace。
- [ ] 默认异步导入并轮询 task；只有显式需要立即检索时有界等待。
- [ ] 导入完成前不把资源加入可检索白名单。

### OV-2.3 Skill 边界

- [ ] Git 中的 Skill 仍为权威版本。
- [ ] OV Skill 仅作为部署副本，不允许 Agent 自行新增或修改。
- [ ] 各 Runtime 与 OV 的 Skill 名称、版本和内容来源保持可追踪，不维护多份人工编辑副本。

### OV-2.4 完成标准

- [ ] 一份面经、一份简历和一份 JD 可以导入并按 URI 读取。
- [ ] 公共面经与用户私有资料不能跨 namespace 误读。
- [ ] OV 资源 hash 与数据库/对象存储 hash 一致。
- [ ] SDK 故障不会阻塞 API 启动和非 RAG 面试流程。

## 12. OV-3：数据库、知识图谱与 OV 混合 RAG

目标：使用现有结构化召回缩小候选范围，再让 OV 完成长文档语义定位和证据读取。

### OV-3.1 混合检索流程

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
  -> 当前已验收 Runtime 的评分 Worker
```

- [ ] 保留现有 embedding + graph rerank 作为结构化候选生成器。
- [ ] 只把 `is_valid` 且 OV 同步状态为 `ready` 的面经加入 OV 检索范围。
- [ ] `find()` 作为明确查询和严格限域的默认路径。
- [ ] 需要会话意图扩展时使用 `search(mode="list") + session_id + target_uri`。
- [ ] 首版不使用不支持 `target_uri` 的 context mode 生成正式评分证据。
- [ ] Agent 不能自行传 `target_uri`；范围由 Backend 根据业务候选生成。

### OV-3.2 Evidence Bundle

- [ ] 统一证据结构：`ov_uri`、`source_type`、`source_id`、`source_hash`、`level`、`score`、`excerpt`。
- [ ] 对 OV 返回 URI 再做前缀和 source mapping 校验。
- [ ] 评分结果中的引用必须来自本次 evidence bundle。
- [ ] `question_attempt.evidence_refs_json` 继续存结构化引用。
- [ ] 为 `interview_turn` 增加结构化 evidence refs 存储，不能只保存数量。
- [ ] 不把完整长文重复写入 turn 表，只存必要摘录和可回查引用。

### OV-3.3 降级

- [ ] OV 不可用时继续使用现有 DB、embedding 和知识图谱召回。
- [ ] 降级结果标记 `retrieval_source=legacy_graph` 或 `no_external_evidence`。
- [ ] OV 空结果不是业务错误，不触发无界重试。
- [ ] OV 与现有召回结果冲突时，以数据库有效性、题链和权限边界为准。

### OV-3.4 完成标准

- [ ] 正式评分证据可以回查到数据库记录和源文档 hash。
- [ ] 知识图谱仍负责相关知识点扩展，OV 负责文档定位与读取，职责无重叠真源。
- [ ] 用户 A 的简历/JD 不会进入用户 B 的 evidence bundle。
- [ ] 关闭 OV 后，现有面经召回和面试主流程仍可运行。

## 13. OV-4：共用长期记忆闭环

- [ ] 由主服务唯一负责业务会话与 OV session 映射、消息投影、outbox 和 commit 状态，不依赖 DSH Memory Plugin。
- [ ] 消息/事件同步有幂等 ID，执行器切换或 Sandbox 重建不产生重复会话与重复记忆。
- [ ] 只在明确复盘/学习节点接收 `propose_memory` 候选，校验后写入；稳定能力画像不被 Agent 自动记忆覆盖。
- [ ] 正式评分证据与偏好/执行经验分开，Agent 自动记忆不能作为判断回答正确的唯一依据。
- [ ] OV 故障时关闭辅助召回，保留既有业务流程与证据来源标记；恢复后可补偿同步。
- [ ] 进入实现时复核 OV SDK、URI、限域和 commit 的实际版本行为。

## 14. 后置项

- [ ] 质量金标、检索评测和模型路由；不推迟前述隔离/Schema/幂等的必要验收。
- [ ] 按容量需要拆独立 Coordinator 或升级队列实现，仍经 SandboxManager 执行 Agent。
- [ ] 公共资源 Watch、OV 生产备份和扩容。
- [ ] 用户自定义 Skill 的审核和发布机制。
- [ ] 多 Agent 并行协作：只有明确业务需要再设计，不因支持多个执行器而默认引入。

## 15. 阶段交付规则

- [ ] 更新实现/未实现边界，记录实际版本及静态、进程、端到端或线上验证层级。
- [ ] 根据实际代码改动运行相关检查；纯文档更新不声称运行时验证通过。
- [ ] 保存上一条已验收路径的显式回退配置，不混用业务 pipeline 和 Runtime 开关。
- [ ] 涉及 Agent 输出时验证越权、非法 Schema、敏感披露和流式输出边界；涉及沙箱时验证隔离与销毁。
- [ ] 阶段未通过验收时，不进入默认主流程；未经实测不写“已支持”或勾选完成。
