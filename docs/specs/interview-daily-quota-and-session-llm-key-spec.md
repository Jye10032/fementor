# 模拟面试每日额度与会话级 LLM Key 方案 Spec

> **当前状态：已完成。** 后端每日免费额度判定 + `NEED_USER_LLM_KEY` 错误码已上线，会话级 Key 存储 (`session-llm-config-store.js`) 已实现 TTL 2h 内存态，前端 `runtime-config.tsx` 已移除 localStorage `llmApiKey`，改为通过后端 `/v1/runtime/session-llm-config` 系列接口管理。

- 版本：v0.1
- 日期：2026-03-30
- 状态：已完成

## 1. 背景

当前前端运行配置允许用户在浏览器内填写 `llmApiKey`，并由前端直接测试供应商连通性。这个方案适合本地调试，但不适合作为线上正式能力边界，主要问题包括：

1. 浏览器端会持有并持久化敏感凭证，暴露面过大。
2. 前端直接承担供应商适配和校验职责，后续难以统一治理。
3. 平台默认 LLM 成本缺少产品化额度边界。
4. 用户自带 Key 的产品规则不清晰，免费额度和 BYOK 模式混在一起。

本次方案要解决的不是“完全不让用户使用自己的 Key”，而是把线上模拟面试能力收敛为：

1. 每个登录用户每天默认只有 1 次免费模拟面试。
2. 超出免费次数后，必须提供自己的 LLM Key 才能继续发起模拟面试。
3. 用户自带 Key 只保存在后端会话内存中，不写数据库，不回传前端，不落浏览器持久化存储。

## 2. 目标

本次方案目标：

1. 明确线上模拟面试的免费额度规则：`每用户每天 1 次`。
2. 明确超额后的解锁方式：用户提交自己的 Key，按当前会话临时生效。
3. 前端不再持久化 `llmApiKey`，也不再直连供应商做 ping。
4. 后端统一负责：
   - 免费额度判断
   - 用户会话级 LLM 配置保存
   - 供应商调用与连通性校验
5. 为后续审计、限流、来源归因保留稳定扩展点。

## 3. 非目标

本次不做：

1. 不把用户自带 Key 持久化到数据库。
2. 不引入复杂计费系统或套餐系统。
3. 不在本期支持多供应商完整抽象，只先覆盖 OpenAI 兼容接口。
4. 不把前端整体目录一次性迁移到 `features/` 结构。

## 4. 核心原则

1. 平台免费额度和用户自带 Key 是两条不同能力链路。
2. 前端不保存可恢复的明文 Key。
3. 后端允许在受控内存中短暂持有明文 Key，但不持久化、不写日志。
4. 所有供应商调用都从后端发起，前端不直接请求 OpenAI。
5. 业务规则要靠稳定错误码和状态接口表达，而不是只靠页面文案。

## 5. 产品规则

### 5.1 免费额度规则

线上登录用户每天可免费发起 1 次模拟面试。

定义建议：

1. 按服务端时区的自然日计算。
2. 统计口径为“成功发起 session”，而不是“是否完成整场面试”。
3. 当日免费次数用完后，平台默认 Key 不再为该用户继续兜底。

### 5.2 超额解锁规则

当用户当日已使用免费次数后：

1. 若当前会话未配置用户自带 Key，则拒绝继续发起模拟面试。
2. 若当前会话已配置用户自带 Key，则允许继续发起模拟面试。

### 5.3 用户自带 Key 展示规则

前端遵循“仅更新、不回填”：

1. Key 输入框仅用于新增或替换。
2. 已配置时不返回明文，不回填原值。
3. 页面只显示脱敏值，例如 `sk-***abcd`。
4. 允许用户执行：
   - 更新密钥
   - 验证连接
   - 清除当前会话密钥

## 6. 高层架构

### 6.1 前端职责

前端只负责：

1. 展示今日免费额度状态。
2. 展示当前会话是否已配置用户 Key。
3. 收集用户输入的 `api_key/base_url/model`。
4. 调用后端接口保存、验证、删除当前会话 Key。

前端不再负责：

1. `localStorage` 持久化 `llmApiKey`
2. 直连供应商 `/chat/completions`
3. 根据页面状态自行判断供应商调用来源

### 6.2 后端职责

后端统一负责：

1. 判断用户今日是否还有免费模拟面试额度。
2. 管理当前会话的临时 LLM 配置。
3. 在调用供应商前从会话存储中读取 Key。
4. 返回脱敏状态、错误码和可供前端展示的业务状态。

## 7. 后端会话级 LLM Key 设计

### 7.1 存储形式

用户自带 Key 采用“后端会话内存态”，即：

1. 前端提交 Key 给后端。
2. 后端把 Key 放入进程内存或 Redis TTL 中。
3. 不写数据库、不写文件。
4. 超时、登出、服务重启后自动失效。

### 7.2 当前阶段推荐实现

单机阶段先使用进程内存 `Map`，按以下标识组织：

- `userId + auth session id`

建议结构：

```ts
type SessionLlmConfig = {
  provider: "openai"
  baseUrl: string
  model: string
  apiKey: string
  maskedKey: string
  expiresAt: number
  createdAt: number
  updatedAt: number
}
```

说明：

1. `apiKey` 在后端内存中仍是明文，这是为了后端后续代调用供应商。
2. 这份明文不允许进入日志、错误对象和持久化层。
3. 如果后续进入多实例部署，再迁移到 Redis TTL。

### 7.3 生命周期

建议默认 TTL 为 `2 小时`：

1. 用户保存 Key 后开始计时。
2. 用户活跃调用面试相关接口时可续期。
3. 用户主动删除时立即失效。
4. 服务重启后配置自然丢失，可视为正常行为。

## 8. 配额与来源决策模型

后端在发起模拟面试前，需统一解析本次 LLM 来源：

```ts
type InterviewLlmAccess =
  | { mode: "platform-free-quota" }
  | {
      mode: "user-session-key"
      provider: "openai"
      baseUrl: string
      model: string
      apiKey: string
    }
  | { mode: "blocked"; reason: "need_user_llm_key" }
```

判定顺序：

1. 检查今天免费次数是否已用完。
2. 若未用完，走 `platform-free-quota`。
3. 若已用完，再检查当前会话是否已有用户 Key。
4. 若有，走 `user-session-key`。
5. 若无，返回 `blocked`。

## 9. API 设计

### 9.1 获取当前会话 LLM 配置状态

`GET /v1/runtime/session-llm-config`

返回示例：

```json
{
  "configured": true,
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "masked_key": "sk-***abcd",
  "expires_at": "2026-03-30T12:00:00.000Z",
  "status": "ready",
  "message": "当前会话已配置用户 Key。"
}
```

约束：

1. 永远不返回明文 `api_key`。
2. 若未配置，返回 `configured: false`。

### 9.2 保存或替换当前会话 LLM 配置

`PUT /v1/runtime/session-llm-config`

请求示例：

```json
{
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "api_key": "sk-xxxx"
}
```

返回示例：

```json
{
  "configured": true,
  "provider": "openai",
  "base_url": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "masked_key": "sk-***abcd",
  "expires_at": "2026-03-30T12:00:00.000Z",
  "status": "ready",
  "message": "当前会话 Key 已更新。"
}
```

### 9.3 验证当前会话 Key 连通性

`POST /v1/runtime/session-llm-config/validate`

规则：

1. 后端读取当前会话中的 Key 发起最小供应商请求。
2. 返回 `ready / warning / error` 状态。
3. 前端不直接请求供应商。

### 9.4 清除当前会话 Key

`DELETE /v1/runtime/session-llm-config`

规则：

1. 清除内存中的配置。
2. 后续若无免费额度则不能继续发起模拟面试。

### 9.5 发起模拟面试

`POST /v1/interview/sessions/start`

新增行为：

1. 发起前检查免费额度和会话 Key 状态。
2. 若免费额度已耗尽且未配置会话 Key，则返回稳定错误码。

错误返回示例：

```json
{
  "error": "NEED_USER_LLM_KEY",
  "message": "今日免费模拟面试次数已用完，请配置你自己的 LLM Key 后继续。"
}
```

## 10. 数据记录与统计

虽然用户 Key 不落库，但模拟面试发起记录仍需要记录来源，用于后续运营和排障。

建议在 `interview_session` 或相关统计层补充：

1. `llm_access_mode`
   - `platform_free_quota`
   - `user_session_key`
2. `quota_charge_date`
3. `quota_charge_user_id`

这样可以支持：

1. 统计平台补贴成本。
2. 统计用户使用自带 Key 的比例。
3. 排查“为什么该用户今天被要求配置 Key”。

## 11. 前端改造策略

### 11.1 `runtime-config` 降级

[`apps/web/components/runtime-config.tsx`](/Users/user/vscode/fementor/apps/web/components/runtime-config.tsx) 不再持有：

1. `llmApiKey` 的本地持久化逻辑
2. 浏览器直连供应商的 ping 逻辑

后续应拆分为：

1. 环境配置层：`apiBase`
2. 会话级 LLM 配置层：通过后端接口读取状态

### 11.2 `/interview` 页面交互

页面建议新增：

1. 今日免费额度状态
2. 当前会话 Key 状态卡片
3. 当收到 `NEED_USER_LLM_KEY` 时弹出配置面板

交互规则：

1. 用户成功保存 Key 后，立即清空输入框。
2. 页面只显示脱敏 Key。
3. 用户可以清除当前会话 Key，恢复到“仅免费额度可用”状态。

## 12. 安全要求

1. `api_key` 禁止进入应用日志。
2. `api_key` 禁止作为错误信息拼接返回。
3. 前端状态接口禁止回传明文 Key。
4. 浏览器不再将用户 Key 写入 `localStorage/sessionStorage`。
5. 若后端后续迁移到 Redis，也禁止将明文 key 暴露到可被业务随意遍历的调试接口。

## 13. 验收标准

### 13.1 免费额度

1. 新用户当天第一次发起模拟面试可直接成功。
2. 同一用户当天第二次发起模拟面试，若未配置会话 Key，则返回 `NEED_USER_LLM_KEY`。

### 13.2 会话级 Key

1. 用户保存会话 Key 后，可继续发起第二次及更多次模拟面试。
2. 页面刷新后，只要服务端会话仍在且 TTL 未过，状态仍能通过 `GET /v1/runtime/session-llm-config` 读取。
3. 服务重启或 TTL 到期后，状态失效，用户需重新配置。

### 13.3 前端安全边界

1. `localStorage` 中不再存在 `llmApiKey`。
2. 浏览器网络请求不再直接打到 OpenAI `/chat/completions`。
3. 页面不回填明文 Key。

## 14. 分阶段实施建议

### Phase 1

1. 后端接入每日免费额度判定。
2. 后端补充 `NEED_USER_LLM_KEY` 错误码。
3. 前端处理超额后的状态提示。

### Phase 2

1. 后端新增会话级 Key 存储与状态接口。
2. 前端新增会话级 Key 配置面板。
3. 前端移除本地持久化 `llmApiKey`。

### Phase 3

1. 面试链路统一从后端解析 `platform-free-quota / user-session-key`。
2. 补充来源记录、状态文案和回归验证。
