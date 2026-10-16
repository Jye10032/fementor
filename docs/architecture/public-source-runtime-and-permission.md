# 公共题源运行模式与权限方案

- 版本：v0.3
- 日期：2026-10-10
- 状态：权限模型保留，存储方案已更新为 PostgreSQL 单库

## 1. 目标

把公共题源能力分成两套运行模式：

1. `cloud`
2. `local`

并明确：

1. 谁能触发题源抓取
2. 抓取后写到哪里
3. 谁只能查看
4. 模拟面试检索读哪一套数据

## 2. 核心结论

### 2.1 线上模式

线上模式下：

1. 只有登录且具备 `admin` 权限的账号，才能执行题库拉取 / 面经抓取 / 公共题源同步
2. 拉取后写入远程数据库
3. 普通用户和未登录用户都只能查看远程数据库里的公共题源结果
4. 普通用户不能触发任何写入远程库的动作

### 2.2 线下模式

线下自部署模式下：

1. 默认本机即为 `admin`
2. 可以执行题库拉取 / 面经抓取 / 公共题源同步
3. 拉取后只写本地 PostgreSQL
4. 不写远程数据库

## 3. 运行模式

只保留运行形态变量：

1. `APP_RUNTIME_MODE=cloud|local`

现有 DSH 路径的配置示例（不代表新架构已经实现）：

### 线上

```env
APP_RUNTIME_MODE=cloud
AGENT_RUNTIME=dsh
```

### 线下

```env
APP_RUNTIME_MODE=local
AGENT_RUNTIME=dsh
```

`APP_RUNTIME_MODE` 决定产品形态和用户配置权限，现有 `AGENT_RUNTIME` 由部署环境选择执行器；二者相互独立。当前代码只接受 `native-api|dsh`，代码缺省为 `native-api`，环境模板配置为 `dsh`。

2026-10-10 的 [多 Runtime 方案](agent-runtime-openviking-preliminary-design.md) 取代“线上/本地均默认 DSH”的长期选型：未来用户可以选择服务端已开放的 Codex、Claude 或 FEMentor Agent Profile，不能覆盖其命令、模型入口、凭证、工具、网络与资源权限。该选择能力待实现，不改变公共题源的 admin/user 权限，也不在本次修改部署环境变量。

存储目标保持 PostgreSQL 单库，`PUBLIC_SOURCE_DRIVER` 不再作为目标架构中的运行时选库入口；迁移状态以单库专项清单和源码验证为准。本地和线上区别在连接目标、身份和权限策略。

## 4. 权限模型

## 4.1 最小角色模型

线上用户增加最小角色字段：

1. `admin`
2. `user`

建议 `users` 表增加：

| 字段 | 类型 | 说明 |
|---|---|---|
| role | text | `admin/user` |

默认所有用户为 `user`。

## 4.2 admin 识别方式

推荐通过白名单自动授予：

```env
ADMIN_EMAILS=admin@example.com,owner@example.com
```

登录后：

1. 如果用户 email 命中 `ADMIN_EMAILS`
2. 自动把 `users.role` 设置为 `admin`
3. 否则为 `user`

## 4.3 本地权限

本地模式下无需真实登录角色判断，默认：

1. 当前本机视为 `admin`
2. 允许执行公共题源写操作

可选环境变量：

```env
LOCAL_DEFAULT_ADMIN=1
```

## 5. 权限矩阵

| 场景 | 登录状态 | 角色 | 可查看公共题源 | 可拉取题源 | 可同步公共题源 | 可写数据库 |
|---|---|---|---|---|---|---|
| cloud | 未登录 | 无 | 是 | 否 | 否 | 否 |
| cloud | 已登录 | user | 是 | 否 | 否 | 否 |
| cloud | 已登录 | admin | 是 | 是 | 是 | 远程数据库 |
| local | 可无登录 | 本机 admin | 是 | 是 | 是 | 本地数据库 |

## 6. 接口权限边界

## 6.1 只读接口

这些接口为查看能力：

1. `GET /v1/experiences`
2. `GET /v1/experiences/:id`
3. `GET /v1/public-question-sources/list`
4. `GET /v1/public-question-sources/local-status`

规则：

1. `cloud` 下允许普通用户和未登录用户查看公开数据
2. `local` 下默认允许查看本地数据

## 6.2 写接口

这些接口为管理能力：

1. `POST /v1/experiences/sync`
2. `POST /v1/public-question-sources/check-update`
3. `POST /v1/public-question-sources/sync`
4. `POST /v1/question-sources/promote`

规则：

1. `cloud` 下只有 `admin` 可调用
2. `local` 下默认允许

## 7. 存储路由规则

不要让 route 层自己决定写哪套数据库。

应统一由 service / repository 层决定：

1. 当前是 `cloud` 还是 `local`
2. 当前 PostgreSQL 连接目标属于本地还是托管环境

## 7.1 云端写入

当：

1. `APP_RUNTIME_MODE=cloud`
2. 当前用户 `role=admin`

则：

1. 抓取牛客
2. 清洗结构化
3. 写入远程 PostgreSQL

## 7.2 本地写入

当：

1. `APP_RUNTIME_MODE=local`

则：

1. 抓取牛客
2. 清洗结构化
3. 写入本地 PostgreSQL

## 8. 统一判断函数

建议新增两个统一 helper。

## 8.1 `getRuntimeStorageTarget()`

返回：

1. `hosted_postgres`
2. `local_postgres`

示例规则：

1. `cloud` -> `hosted_postgres`
2. `local` -> `local_postgres`

## 8.2 `canManagePublicSources(context)`

返回布尔值。

规则：

1. `local` 模式下恒为 `true`
2. `cloud` 模式下只有 `admin` 才为 `true`

## 9. 业务链路

## 9.1 线上 admin

1. 登录
2. 后端识别为 `admin`
3. 触发牛客抓取或公共题源同步
4. 数据写入远程 PostgreSQL
5. 全站用户后续读取远程公共题源

## 9.2 线上普通用户

1. 登录或未登录
2. 只能查看远程公共题源结果
3. 不能触发抓取
4. 不能触发同步
5. 不能写远程数据库

## 9.3 线下本地用户

1. 默认本机管理员
2. 触发牛客抓取或公共题源同步
3. 数据写入本地 PostgreSQL
4. 模拟面试与检索只查本地库

## 10. 前端表现

## 10.1 admin 用户

显示：

1. `拉取面经`
2. `同步公共题源`
3. `检查更新`

## 10.2 普通用户

只显示：

1. 列表查看
2. 详情查看

不显示：

1. 抓取按钮
2. 同步按钮

## 10.3 未登录用户

只显示公开内容。

如点击受限入口，提示：

1. `请先登录管理员账号`
2. 或 `仅管理员可同步公共题源`

## 11. 实施顺序

### Phase 1

1. 增加 `APP_RUNTIME_MODE`
2. 增加 `users.role`
3. 增加 `ADMIN_EMAILS`

### Phase 2

1. 登录后自动识别并写入 `role`
2. 增加 `canManagePublicSources`
3. 给公共题源写接口加 `admin` 校验

### Phase 3

1. 公共题源统一通过 PostgreSQL repository 写入
2. `cloud` 连接托管 PostgreSQL
3. `local` 连接本地 PostgreSQL

### Phase 4

1. 前端根据 `viewer.role` 展示管理入口
2. 普通用户只保留只读能力

## 12. 验收标准

1. 线上普通用户无法触发公共题源写操作。
2. 线上 `admin` 可成功拉取并写入远程数据库。
3. 线下本地部署默认可拉取并写入本地数据库。
4. 线下拉取不会写远程数据库。
5. 模拟面试读取的数据源与当前运行模式一致。
