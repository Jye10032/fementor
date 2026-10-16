# DSH Worker Pool 并发与故障恢复设计（历史方案）

- 版本：v1.0
- 日期：2026-08-27
- 状态：未实现；2026-10-10 已由通用 Sandbox 运行设计取代
- 当前方案：[多 Agent Runtime 与共享能力方案](agent-runtime-openviking-preliminary-design.md)
- 当前清单：[多 Runtime 分阶段实施清单](todolists/agent-runtime-openviking-implementation-todolist.md)

> 下文保存当时的 DSH 专属进程池设计，不是当前待执行任务。新方向使用 FEMentor 主服务管理按需 Railway Sandbox；有界调度、会话顺序、幂等、租约和故障回收的要求已迁入 [Railway Sandbox 运行设计](railway-agent-sandbox-design.md)。旧 `DshRuntime` 代码仍保留，本次仅更新方案。

## 1. 文档边界

本文记录 FEMentor 从当前单个 DSH Runtime 演进到 Worker Pool 的设计，不代表当前系统已经支持多人排队、Worker Pool 或多 API 实例调度。

当前实现仍是：API 进程共享一个 `DshRuntime`，`DSH_MAX_CONCURRENT_RUNS=1`；当已有任务运行时，新的任务直接返回 `runtime_busy`，不会自动排队。

本文只讨论 DSH 进程调度和运行可靠性，不改变业务状态所有权：

- FEMentor 负责用户权限、`interview_session` 归属、题目、回答、评分和整场面试状态。
- DSH 负责 Agent Session、模型调用、事件流、checkpoint 和运行审计。
- PostgreSQL 是业务状态和调度元数据的权威存储；DSH 不直接修改面试领域表。

## 2. 目标与非目标

### 2.1 目标

- 单个 API 实例支持有限并发，并通过 FIFO 队列吸收短时突发。
- 同一面试 Session 的任务保持顺序和 Worker 粘性，避免上下文分裂。
- Worker 崩溃后可以被检测、销毁、重建，并按任务幂等性决定是否恢复或重试。
- 对前端暴露明确的 `queued/running/completed/failed/cancelled` 状态。
- 后续可以平滑升级到多个 API 实例和共享队列。

### 2.2 非目标

- 首版不使用 Node `worker_threads` 承载 DSH。DSH 是外部 Agent 运行时，进程隔离比线程隔离更清晰。
- 首版不引入 Redis、BullMQ 或独立调度服务。
- 首版不让 DSH 接管整场面试 Workflow，也不让 DSH 成为业务状态真源。
- 首版不自动重试具有副作用的任务，不承诺跨进程的任意 Session 恢复。

## 3. 单实例 Worker Pool

### 3.1 进程模型

API 进程内维护固定数量的 Worker，每个 Worker 包含：

```text
Worker
  -> 一个 DshRuntime
  -> 一个独立 DSH 子进程
  -> active run = 0 或 1
```

Worker 不共享 DSH 子进程、stdio 通道或内存 Session。`DSH_WORKER_COUNT` 默认为 2，可按部署资源调整；每个 Worker 继续限制一个 active run，避免把并发压力隐藏在单个 DSH Session 内。

### 3.2 请求生命周期

```text
请求进入
  -> 校验用户与 interview_session
  -> 取得 session -> worker 映射
  -> 有空闲 Worker：立即运行
  -> 无空闲 Worker：进入 FIFO 队列
  -> Worker 完成/失败/取消
  -> 释放 Worker，调度下一个任务
```

队列任务必须包含 `request_id`、`interview_session_id`、任务类型、幂等键、创建时间、deadline 和业务输入引用。队列只保存可重建的任务描述，不把完整敏感上下文长期复制到内存队列中。

### 3.3 Session 粘性与顺序

使用 `interview_session_id -> worker_id` 的粘性路由。同一面试的后续轮次必须回到原 Worker；如果该 Worker 当前忙，同一 Session 的任务按顺序等待，不能被其他 Worker 越过执行。

映射不能只存内存，至少需要 PostgreSQL 调度元数据记录：Worker 标识、租约时间、Session 版本和最后一次运行 ID。进程重启后可以据此重建路由，但不能信任过期租约，必须重新探活 Worker。

同一 Session 需要业务级并发锁或版本检查：两个 Tab 同时提交同一轮时，只有一个请求可以推进版本，另一个返回可识别的冲突或排队状态，不能产生两条互相覆盖的评分结果。

## 4. Worker 生命周期

### 4.1 启动与健康

Worker 启动时创建 `DshRuntime`，完成 DSH handshake、Provider 认证检查和版本记录。只有健康状态的 Worker 才能接收任务。

建议状态：`starting`、`idle`、`busy`、`draining`、`unhealthy`、`stopped`。

### 4.2 超时与销毁

每个任务有独立 deadline。超时或协议传输异常时：

1. 将运行记录标记为 `runtime_unavailable` 或 `timeout`。
2. 停止接收该 Worker 的新任务。
3. 关闭并清理整个 DSH 子进程树及 stdio 通道。
4. 创建新 Worker 并重新 handshake。
5. 仅对无副作用、幂等的任务评估自动重试。

### 4.3 崩溃恢复

如果 DSH 支持 resume，使用其 checkpoint 恢复 Agent Session；如果不支持，则从 PostgreSQL 的结构化 `InterviewState`、最近已提交轮次和显式上下文引用重建输入。

恢复期间不重复提交已经写入业务库的评分。提交必须使用幂等键和事务边界：只有 FEMentor 完成 Schema 校验并提交领域事务后，`agent_run` 才能标记为 `committed`。

## 5. 队列与前端状态

### 5.1 队列策略

单实例首版采用进程内 FIFO 队列，设置最大长度和等待超时。超过上限返回 `queue_full`；超过等待时间返回 `queue_timeout`。服务重启会丢失内存队列，因此客户端必须能够安全重试未开始的任务。

推荐配置：

```env
AGENT_RUNTIME=dsh
DSH_WORKER_COUNT=2
DSH_MAX_CONCURRENT_RUNS=1
DSH_QUEUE_MAX_SIZE=20
DSH_QUEUE_WAIT_TIMEOUT_MS=30000
```

### 5.2 对外状态

API/SSE 统一返回：

- `queued`：已入队，带队列位置或预计等待信息。
- `running`：已分配 Worker，开始接收事件。
- `completed`：任务结果已通过业务校验并提交。
- `failed`：运行失败、超时、Schema 无效或队列超时。
- `cancelled`：用户主动取消或 Session 被终止。

前端不展示 Worker 内部编号，也不把 DSH Session ID 当作业务 ID；只使用 `request_id`、`interview_session_id` 和业务结果。

## 6. 多 API 实例演进

当 API 扩容到多个实例时，进程内队列不再足够。可选方案是 Redis/BullMQ 或 PostgreSQL Queue，二者都必须补充：

- 任务租约、可见性超时和超时回收。
- Worker 心跳、实例注册和故障摘除。
- `interview_session_id` 的分布式锁与顺序保证。
- 幂等键、结果去重和提交事务。
- 取消任务、重试次数和死信记录。

在没有这些机制前，不应宣称支持多实例下的稳定 Session 调度。

## 7. 安全与隔离

- 每个任务进入队列前重新校验用户对 `interview_session_id` 的访问权。
- Worker 内部状态、DSH Session ID 和模型凭证不能返回给浏览器。
- 队列和审计记录避免保存不必要的简历、回答原文；使用数据库引用或脱敏摘要。
- Worker 只能使用按任务类型配置的 DSH profile 和工具白名单。
- 运行时状态异常时 fail closed，不因 Worker 重建而切换到未知 Provider 或用户自定义 Base URL。

## 8. 分阶段实施清单

### 阶段 A：单实例

- [ ] 抽象 `DshWorker`，一个实例持有一个 `DshRuntime`。
- [ ] 增加固定数量 Worker 的启动、健康检查、优雅退出和重建。
- [ ] 增加进程内 FIFO 队列、最大长度和等待超时。
- [ ] 为 `interview_session_id` 增加粘性路由和同 Session 并发锁。
- [ ] 将 queued/running/completed/failed/cancelled 接入现有 API/SSE。

### 阶段 B：可靠性

- [ ] 持久化 Worker 租约、Session 路由和任务幂等键。
- [ ] 接入 Worker 崩溃恢复、checkpoint/resume 或结构化状态重建。
- [ ] 为无副作用任务增加有限次数自动重试和失败原因审计。
- [ ] 增加并发、超时、崩溃、重复提交和双 Tab 冲突测试。

### 阶段 C：多实例

- [ ] 选择 Redis/BullMQ 或 PostgreSQL Queue，并完成技术验证。
- [ ] 实现分布式租约、锁、心跳、死信和顺序调度。
- [ ] 在压测和故障演练通过后，再开放多 API 实例部署。

## 9. 验收口径

在阶段 A 完成前，只能描述为“单 API 实例、有限 DSH Worker Pool 设计”；阶段 A 完成后才能宣称支持进程内排队；阶段 C 完成并经故障演练后，才能宣称支持多实例 Worker Pool。任何阶段都不改变 FEMentor 对面试业务状态的最终控制权。
