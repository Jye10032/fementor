# 模拟面试每日额度与会话级 LLM Key Todo List

> **当前状态：已完成（以后端内存态 + 前端接口驱动方式实现）。** 每日免费额度判定、`NEED_USER_LLM_KEY` 错误码、会话级 Key 内存存储 (`session-llm-config-store.js`)、前端 session-llm-config 系列接口、localStorage `llmApiKey` 移除均已上线。

- 日期：2026-03-30
- 状态：已完成
- 对应方案：
  - `docs/architecture/specs/interview-daily-quota-and-session-llm-key-spec.md`

## 1. 使用方式

这份文档是实施清单，不是架构说明。

使用原则：

1. 先收敛后端规则，再接前端配置面板。
2. 每个阶段结束后都要验证“免费次数”和“会话 Key”两条链路。
3. 优先保证错误码与状态接口稳定，再考虑 UI 细节。

## 2. 目标结果

本次改造的目标结果：

1. 每个用户每天只有 1 次免费模拟面试。
2. 超额后未配置会话 Key 时，返回 `NEED_USER_LLM_KEY`。
3. 用户 Key 只保存在后端会话内存中，不落库。
4. 前端不再把 `llmApiKey` 写入本地持久化存储，也不再直连供应商。

## 3. Phase 0：基线确认

### 目标

先确认当前免费次数统计入口、面试发起入口和运行配置代码位置。

### TODO

- [ ] 确认 `POST /v1/interview/sessions/start` 的当前实现文件
- [ ] 确认当前是否已有用户维度面试次数统计字段或查询路径
- [ ] 确认前端 `runtime-config` 当前对 `llmApiKey` 的持久化与 ping 逻辑
- [ ] 确认当前登录态可用于稳定标识 `userId + session`

### 验收

- [ ] 能明确列出后端要改的路由、service、存储文件
- [ ] 能明确列出前端要删掉的本地 Key 逻辑

## 4. Phase 1：接入每日免费额度判断

### 目标

先把“每天 1 次免费模拟面试”的业务规则落到后端。

### TODO

- [ ] 定义“免费次数”的统计口径
- [ ] 统一服务端时区或自然日计算方式
- [ ] 在发起模拟面试前查询今日已使用次数
- [ ] 若次数未超限，允许继续使用平台默认能力
- [ ] 若次数超限，进入会话 Key 判定流程

### 建议文件

- [ ] `apps/api/src/routes/interview-routes.js`
- [ ] `apps/api/src/interview/*`
- [ ] `apps/api/src/db/*`

### 验收

- [ ] 同一用户当天第一次可成功发起
- [ ] 同一用户当天第二次会进入超额分支

## 5. Phase 2：新增稳定错误码

### 目标

将“免费次数已用完但未配置用户 Key”的状态收敛为稳定错误码。

### TODO

- [ ] 定义错误码 `NEED_USER_LLM_KEY`
- [ ] 统一错误返回结构
- [ ] 在 `start session` 入口接入该错误码
- [ ] 前端补充对此错误码的识别逻辑

### 验收

- [ ] 前端无需靠文案判断是否应弹出 Key 配置面板

## 6. Phase 3：实现后端会话级 Key 存储

### 目标

新增会话级内存存储，不落数据库。

### TODO

- [ ] 新增 `session llm config store`
- [ ] 设计存储 key：`userId + auth session`
- [ ] 定义 TTL，例如 `2 小时`
- [ ] 支持 `set/get/delete`
- [ ] 支持过期清理
- [ ] 确保日志不打印明文 `apiKey`

### 建议文件

- [ ] `apps/api/src/lib/session-llm-config-store.*`

### 验收

- [ ] 保存后可读取脱敏状态
- [ ] TTL 到期后自动失效
- [ ] 服务重启后自然失效

## 7. Phase 4：补齐会话级 Key 接口

### 目标

提供前端可消费的最小状态接口。

### TODO

- [ ] `GET /v1/runtime/session-llm-config`
- [ ] `PUT /v1/runtime/session-llm-config`
- [ ] `POST /v1/runtime/session-llm-config/validate`
- [ ] `DELETE /v1/runtime/session-llm-config`
- [ ] 返回值统一为脱敏结构

### 验收

- [ ] 接口不返回明文 Key
- [ ] 校验请求由后端发起，不是浏览器直连供应商

## 8. Phase 5：将面试发起链路接入来源解析

### 目标

统一决定本次调用走平台免费额度还是用户会话 Key。

### TODO

- [ ] 定义 `platform-free-quota / user-session-key / blocked` 三态
- [ ] 在发起模拟面试前解析来源
- [ ] 将来源写入 session 或相关记录
- [ ] 保证后续 turn 流程能继续复用同一来源

### 验收

- [ ] 免费额度链路可正常发题
- [ ] 用户会话 Key 链路可正常发题

## 9. Phase 6：前端移除本地明文持久化

### 目标

把当前前端 `llmApiKey` 的浏览器持久化能力下线。

### TODO

- [ ] 删除 `localStorage` 中 `llmApiKey` 的读写
- [ ] 删除浏览器直连供应商 ping
- [ ] 新增会话 Key 状态读取 hook / api 封装
- [ ] 新增“更新密钥 / 验证连接 / 清除当前会话密钥”交互
- [ ] 收到 `NEED_USER_LLM_KEY` 时弹出配置面板

### 建议文件

- [ ] `apps/web/components/runtime-config.tsx`
- [ ] `apps/web/lib/api.ts`
- [ ] `apps/web/app/interview/page.tsx`
- [ ] 新增会话级 LLM 配置相关 hook / panel

### 验收

- [ ] 浏览器 `localStorage` 中不再出现 `llmApiKey`
- [ ] 浏览器不会再直接请求 OpenAI `/chat/completions`

## 10. Phase 7：回归验证与文档回写

### 目标

确保两条能力链路都可工作，并将实现状态回写文档。

### TODO

- [ ] 验证当天第一次免费发起
- [ ] 验证当天第二次无 Key 被拦截
- [ ] 验证配置会话 Key 后可继续发起
- [ ] 验证清除会话 Key 后重新被拦截
- [ ] 验证 TTL 过期后的失效行为
- [ ] 在 `docs/mvp-方案记录.md` 回写实施结果

### 验收

- [ ] 产品规则与代码行为一致
- [ ] 前后端不再出现“浏览器长期保存明文 Key”的路径
