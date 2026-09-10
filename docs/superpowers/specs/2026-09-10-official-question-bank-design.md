# 远端官方题库模块设计

- 日期：2026-09-10
- 状态：待实现
- 范围：官方题库只读浏览、搜索、导入本地题库，以及本地免登录身份隔离

## 1. 背景与目标

当前项目已经有三层题库模型：`question_source` 保存题目定义，`user_question_bank` 保存用户题单关系，`question_attempt` 保存练习记录。但现有实现只有一个数据库连接，题库页面只读取当前用户的本地题单，且本地未登录模式没有稳定的匿名用户身份。

本次改动建立两套明确的数据边界：

1. 远端官方数据库只提供公共题目查询，使用 Supabase 上的只读角色连接。
2. 本地数据库保存用户自己的题库关系、导入后的题目快照和练习记录。
3. 普通用户可以浏览、搜索和使用官方题目，但不能修改远端数据。
4. 用户可以把官方题目导入自己的题库，导入后所有复习、收藏、作答和编辑都只影响本地数据。
5. 本地模式无需登录，不同浏览器通过持久匿名身份隔离数据。

官方题库第一版以远端 `question_source` 表中 `status = 'active'` 的记录为准，不直接从 `experience_question_item` 拼接题目。

## 2. 非目标

本次不包含：

1. 远端数据库的抓取、清洗、审核后台。
2. 远端题目的写入、编辑、删除、合并或 migration。
3. 将所有历史 `experience` 数据立即改造成按用户拥有的完整副本。
4. 新增复杂的协作、评论、点赞和审核流程。

远端题库中的数据生产仍沿用现有管理员同步链路；本模块只消费其已发布的 active 题源。

## 3. 方案选择

### 3.1 采用：双数据源 + 导入快照

API 进程保留现有本地数据库连接，并新增独立的远端 PostgreSQL 连接池。远端连接串只存在于服务端环境变量 `REMOTE_DATABASE_URL`，账号使用 `fementor_remote_reader`。远端 repository 只提供查询方法，并在连接初始化后设置 `default_transaction_read_only = on`；不复用本地写 repository，也不运行远端 migration。

用户点击导入时，服务端执行以下步骤：

1. 使用远端 repository 按远端 ID 查询 active 题源。
2. 在本地事务中以 `source_type = 'official_remote'`、`source_ref_id = 'remote:<remote-id>'` 写入或更新题源快照。
3. 在本地 `user_question_bank` 中按 `(user_id, question_source_id)` 幂等创建用户题库关系。
4. 返回本地题库项和 `created` 状态。

导入快照保留 `remote_source_id`、`remote_updated_at` 和来源标识。重复导入不会创建重复题目，也不会清空用户的复习状态、收藏或自定义题面。远端题目更新时只更新公共快照字段，不覆盖用户层字段；用户后续对题目的任何本地题库操作都只作用于本地副本。

### 3.2 备选方案

1. 定期全量同步到本地：实现简单、离线可用，但运行时看不到真实远端状态，数据新鲜度和“只读官方库”的边界不清晰。
2. 通过官方 HTTP API 代理：权限隔离更强，但需要额外部署官方 API、鉴权和版本管理，当前项目没有必要引入这条新链路。

采用双数据源是因为它同时满足实时浏览、数据库级只读和本地副本可编辑三个要求，且不会改变现有用户题库的三层模型。

## 4. 后端架构

### 4.1 远端连接与配置

新增服务端变量：

```env
REMOTE_DATABASE_URL=postgresql://<readonly-user>:<password>@<host>:<port>/<database>
REMOTE_DATABASE_SSL=true
REMOTE_DATABASE_CONNECT_TIMEOUT_MS=5000
```

变量不进入 `NEXT_PUBLIC_*`，不通过 API 返回完整连接串，也不记录密码或 token。未配置远端连接时，官方题库接口返回明确的 `official_source_unavailable`，本地题库仍可正常使用。

远端连接模块单独维护 pool、连接健康状态和关闭逻辑，并提供：

- `listOfficialQuestionSources(filters)`：只执行 `SELECT`，支持关键词、track、chapter、difficulty、category、limit、offset。
- `getOfficialQuestionSourceById(id)`：只返回 active 记录。
- `getOfficialQuestionSourceStatus()`：返回 configured、reachable、last_error，不泄露连接细节。

查询只能访问白名单字段和 `question_source` 表，所有输入使用参数化 SQL。远端池的连接建立后执行 `SET default_transaction_read_only = on`，应用层再对 repository 做只读方法约束，形成数据库和代码两层保护。

### 4.2 API

新增官方题库路由，同时兼容项目当前的 Fastify 和 legacy HTTP 注册方式：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/v1/official-question-bank` | 公开 | 搜索、筛选、分页官方 active 题源 |
| `GET` | `/v1/official-question-bank/:id` | 公开 | 查看官方题目详情 |
| `GET` | `/v1/official-question-bank/status` | 公开 | 查看官方库是否可用及统计摘要 |
| `POST` | `/v1/official-question-bank/:id/import` | 本地匿名身份或登录用户 | 将官方题目导入当前用户题库 |

列表返回 `items`、`total`、`filters`、`source: 'remote_official'` 和 `read_only: true`。详情返回题面、题型、难度、知识点、预期考察点、来源元数据和当前用户是否已导入；未登录的公开浏览不返回其他用户数据。

导入接口不接受客户端传入的 `user_id`。服务端从 Clerk 身份或本地匿名 Cookie 解析用户，远端 ID 先校验为 active，再执行本地事务。远端不存在或已下线返回 `404 official_question_not_found`；远端不可用返回 `503 official_source_unavailable`；导入成功返回本地 `user_question_bank` 项、`created` 和 `source_snapshot_id`。

### 4.3 本地身份

在 `local` 运行模式且未启用 Clerk 时，后端为浏览器签发 `fementor_local_user` 持久 Cookie：

- 值为服务端生成的 UUID，格式严格校验；
- `HttpOnly`、`SameSite=Lax`、按当前站点设置 `Path=/`；
- 生产 HTTPS 时设置 `Secure`；
- 所有私有题库、导入、练习和复习接口只使用服务端解析出的 Cookie 身份，忽略前端传入的 `user_id`；
- 已登录 Clerk 用户优先使用 Clerk user id；
- cloud 模式下未登录用户只能浏览官方公开题目，不能导入或修改个人题库。

现有 `getResolvedUserContext` / `getResolvedViewerAccessContext` 统一接入该身份解析，避免每条路由自行判断本地或登录状态。创建本地用户档案仍复用现有 `users` facade。

### 4.4 本地快照与权限

本地 `question_source` 继续由现有 SQLite/PostgreSQL facade 操作。官方快照使用：

- `source_type = 'official_remote'`
- `source_ref_id = 'remote:<remote-id>'`
- `metadata_json.origin = 'remote_official'`
- `metadata_json.remote_source_id`
- `metadata_json.remote_updated_at`

`user_question_bank` 和 `question_attempt` 永远带当前用户条件。所有更新类方法先校验记录的 `user_id`，任何用户都不能通过官方题源 ID 直接更新 `question_source`。

## 5. 前端体验

题库页改成任务优先的 C 端工作台，不再把“官方库”和“我的题库”混在同一个列表里：

1. 顶部使用紧凑的分段控件：`我的题库` / `官方题库`，并在官方标签旁显示“远程只读”。
2. 官方页首屏先显示搜索框、章节/题型/难度筛选和结果数量，下面是可扫描的题目列表。
3. 每条官方题目显示题面、章节、难度、知识点和状态标签；主操作是“导入我的题库”，次操作是“查看详情”或“用于模拟面试”。
4. 已导入题目显示“已在我的题库”，按钮变为不可重复导入或“打开我的题库”。
5. 官方详情页明确显示“官方题目 · 远程只读”，不显示删除、编辑、标记完成等本地操作。
6. 我的题库保留复习统计、薄弱项、收藏和标记完成；这些操作只调用现有本地题库接口。
7. 官方库未配置、加载失败、空结果和导入失败分别提供可理解的状态，不影响另一标签页。
8. 模拟面试入口允许从官方题目开始；若要记录复习进度，先自动导入或提示导入，记录只落本地。

前端只请求 API，不接触远端数据库变量。列表、筛选和导入状态通过 hook 管理，避免在页面组件中混入权限和数据源判断。

## 6. 数据流

### 浏览官方题目

浏览器 -> `GET /v1/official-question-bank` -> 远端只读 pool -> `question_source(status=active)` -> 返回官方题目。

### 导入官方题目

浏览器 -> `POST /v1/official-question-bank/:id/import` -> 解析 Clerk/Cookie 用户 -> 远端读取 active 题源 -> 本地事务写入官方快照 -> 本地创建用户题库关系 -> 返回本地项。

### 练习与复习

浏览器 -> 现有 `/v1/question-bank`、`/v1/question-attempts` 和 `/v1/practice/next` -> 只读/写本地 `user_question_bank` 与 `question_attempt`。任何答案、评分、复习状态都不写远端。

## 7. 错误处理与可观测性

需要区分以下错误：

- `official_source_not_configured`：没有 `REMOTE_DATABASE_URL`；
- `official_source_unavailable`：远端连接超时、认证失败或查询失败；
- `official_question_not_found`：题目不存在或已不是 active；
- `official_import_requires_identity`：cloud 未登录时尝试导入；
- `official_import_failed`：本地快照或用户题库事务失败。

服务端日志只记录错误类型、请求路径和耗时，不记录连接串、密码、查询参数中的敏感字段或完整题面。状态接口返回最近一次错误的安全摘要，前端显示可行动的提示。

## 8. 测试与验收

### 后端

1. 远端 repository 的 SQL 只包含允许的 `SELECT`，连接初始化开启 read-only。
2. 未配置远端时，官方列表返回可识别错误，本地题库接口仍通过。
3. 官方列表支持关键词、章节、难度和分页，并只返回 active 记录。
4. 导入成功创建本地快照和用户题库关系；重复导入幂等。
5. 两个匿名 Cookie 用户导入同一题目后，各自只有自己的 `user_question_bank` 和练习状态。
6. cloud 未登录可浏览但不能导入；普通用户不能调用任何远端写路径。
7. 模拟面试和作答记录只写本地数据库。
8. 远端超时、题目下线、本地事务失败均返回稳定的错误码。

### 前端

1. 官方/我的题库切换不丢筛选和加载状态。
2. 官方题目显示只读标识，已导入状态正确更新。
3. 本地模式未登录也能导入、复习和记录作答。
4. 官方库不可用时页面仍能使用我的题库。
5. 在桌面和移动宽度下检查首屏层级、按钮可用性、空状态、错误状态和详情页，不出现溢出或错把官方题目当成本地题目操作。

## 9. 配置与发布顺序

1. 在 API 环境中配置 `REMOTE_DATABASE_URL`（使用只读角色），先运行连接健康检查。
2. 执行本地数据库 migration，确保官方快照元数据和匿名身份兼容现有 schema。
3. 发布 API，再发布题库页；未配置远端时页面仍保持本地题库可用。
4. 用只读角色验证官方列表、详情和导入；尝试写远端表应被数据库拒绝。
5. 通过 API 测试和浏览器测试后，再将官方题库入口加入导航或默认入口。
