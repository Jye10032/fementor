# 面经库开发任务清单

- 版本：v0.1
- 日期：2026-03-27
- 关联方案：[面经库与模拟面试联动方案](/Users/user/vscode/fementor/docs/pages/experience-library-spec.md)
- 目标：把“牛客面经抓取 -> LLM 清洗 -> 入库 -> 面经库页 -> 模拟面试联动”拆成可执行任务

## 1. MVP 范围

### 1.1 本期必须完成

1. 用户可在前端输入关键词并点击 `获取近 7 日面经`
2. 后端触发同步任务，抓取牛客近 7 日未入库的该关键词面经，最多 10 条
3. 每条面经 `content` 进入 LLM 清洗并输出统一结构
4. 清洗结果入库
5. 新增 `面经库` 页面，可查看列表、搜索和详情
6. 模拟面试启动前可选择引入近期面经作为额外题源

### 1.2 本期不做

1. 多平台抓取
2. 自动定时同步
3. 完整向量检索 / reranker
4. 自动把面经题写入正式 `question_bank`
5. 完整回答驱动追问图

## 2. 任务分期

## Phase 1. 数据层与同步任务骨架

### 2.1 新增数据表

1. `experience_sync_job`
2. `experience_post`
3. `experience_question_group`
4. `experience_question_item`

### 2.2 建表任务

1. 在 `apps/api/src/db.js` 增加建表 SQL
2. 增加索引与唯一键
3. 为新表补充基础 CRUD 方法

### 2.3 建议字段

#### `experience_sync_job`

1. `id`
2. `user_id`
3. `keyword`
4. `status`
5. `requested_limit`
6. `created_count`
7. `skipped_count`
8. `failed_count`
9. `started_at`
10. `finished_at`
11. `error_message`
12. `created_at`
13. `updated_at`

#### `experience_post`

1. `id`
2. `source_platform`
3. `source_post_id`
4. `source_url`
5. `keyword`
6. `title`
7. `author_name`
8. `published_at`
9. `content_raw`
10. `content_cleaned`
11. `summary`
12. `company_name`
13. `role_name`
14. `interview_stage`
15. `quality_score`
16. `is_valid`
17. `clean_status`
18. `crawl_job_id`
19. `created_at`
20. `updated_at`

唯一键：

1. `source_platform + source_post_id`

#### `experience_question_group`

1. `id`
2. `post_id`
3. `topic_cluster`
4. `canonical_question`
5. `group_order`
6. `group_type`
7. `frequency_score`
8. `created_at`
9. `updated_at`

#### `experience_question_item`

1. `id`
2. `group_id`
3. `post_id`
4. `question_text_raw`
5. `question_text_normalized`
6. `question_role`
7. `order_in_group`
8. `parent_item_id`
9. `category`
10. `difficulty`
11. `follow_up_intent`
12. `expected_points_json`
13. `knowledge_points_json`
14. `created_at`
15. `updated_at`

### 2.4 验收标准

1. 本地启动 API 后数据库自动建表
2. 可插入一条测试面经与其问题组、问题项
3. 唯一键能阻止同一牛客帖子重复入库

## Phase 2. 抓取、去重与清洗链路

### 3.1 新增服务层

建议新增文件：

1. `apps/api/src/experience/service.js`
2. `apps/api/src/experience/cleaner.js`
3. `apps/api/src/experience/mapper.js`

### 3.2 实现任务

1. 封装现有 `niuke-crawler` 为服务层调用
2. 支持按关键词运行抓取
3. 仅保留近 7 日数据
4. 仅保留未入库帖子
5. 仅保留最多 10 条
6. 调用 LLM 输出统一 JSON
7. 把帖子、问题组、问题项落库
8. 更新同步任务状态

### 3.3 LLM 清洗输出要求

统一输出：

1. `company_name`
2. `role_name`
3. `interview_stage`
4. `experience_summary`
5. `topic_groups`
6. `cleaned_content`
7. `quality_score`
8. `is_valid`

### 3.4 失败回退策略

1. LLM 失败时保留原始面经，但 `clean_status=failed`
2. 单条失败不影响其他条入库
3. 任务状态需要记录失败数
4. JSON 校验失败时允许重试 1 次

### 3.5 验收标准

1. 输入一个关键词后，能落库至少 1 条结构化面经
2. 近 7 日之外的内容不会入库
3. 已存在帖子不会重复入库
4. 单次任务最多新增 10 条

## Phase 3. API 契约

### 4.1 新增接口

#### `POST /v1/experiences/sync`

作用：

1. 创建同步任务
2. 触发抓取与清洗

请求体：

```json
{
  "keyword": "前端 面经",
  "days": 7,
  "limit": 10
}
```

返回：

```json
{
  "job_id": "exp_sync_xxx",
  "status": "pending"
}
```

#### `GET /v1/experiences/sync/:jobId`

作用：

1. 查询同步任务状态

返回字段：

1. `status`
2. `created_count`
3. `skipped_count`
4. `failed_count`
5. `error_message`

#### `GET /v1/experiences`

作用：

1. 面经列表查询

建议参数：

1. `query`
2. `days`
3. `company`
4. `role`
5. `page`
6. `page_size`
7. `only_valid`
8. `sort`

#### `GET /v1/experiences/:id`

作用：

1. 查看单条面经详情
2. 返回问题组和问题项

### 4.2 后端文件建议

1. `apps/api/src/routes/experience-routes.js`
2. `apps/api/src/app.js` 注册新路由

### 4.3 验收标准

1. 前端可创建同步任务并轮询状态
2. 列表接口返回分页结构
3. 详情接口返回帖子 + 问题组 + 问题项

## Phase 4. 前端面经库页面

### 5.1 页面与组件

建议新增：

1. `apps/web/app/experience/page.tsx`
2. `apps/web/app/experience/[id]/page.tsx`
3. `apps/web/app/experience/_components/ExperienceSearchBar.tsx`
4. `apps/web/app/experience/_components/ExperienceSyncStatus.tsx`
5. `apps/web/app/experience/_components/ExperienceList.tsx`
6. `apps/web/app/experience/_components/ExperienceDetail.tsx`
7. `apps/web/app/experience/_lib/experience.types.ts`
8. `apps/web/app/experience/_hooks/use-experience-sync.ts`
9. `apps/web/app/experience/_hooks/use-experience-list.ts`

### 5.2 页面任务

1. 新增导航入口 `面经库`
2. 支持输入关键词
3. 点击按钮创建同步任务
4. 页面展示同步状态
5. 列表支持搜索和筛选
6. 点击进入详情页
7. 详情页展示：
   - 标题
   - 来源
   - 发布时间
   - 清洗摘要
   - 原文
   - 问题组

### 5.3 验收标准

1. 用户可从导航进入面经库
2. 同步任务过程可见
3. 新同步结果能自动出现在列表中
4. 搜索结果与详情展示正常

## Phase 5. 检索 MVP

### 6.1 本期目标

不做 demo 级 `LIKE`，但也不一步上到完整生产架构。

本期先做：

1. 结构化字段过滤
2. 基于 `canonical_question` 和 `question_text_normalized` 的问题级查询
3. 标题、摘要、规范问题的统一搜索入口

### 6.2 实现任务

1. 列表接口支持查帖子
2. 详情页可查看问题组
3. 后端新增问题级召回函数
4. 为后续 embedding 预留字段与 service 接口

### 6.3 验收标准

1. 搜索 `Promise` 能命中相关问题项对应的帖子
2. 搜索 `前端实习` 能命中岗位相关面经
3. 问题项检索结果能回溯到原帖

## Phase 6. 模拟面试联动 MVP

### 7.1 联动范围

本期只做“启动前召回面经题源”，不做完整动态追问。

### 7.2 实现任务

1. 在面试启动逻辑中加入可选开关：
   - `参考近期真实面经`
2. 根据 JD / 简历摘要 / 用户关键词召回相关 `experience_question_item`
3. 把召回结果作为额外题源混入问题队列
4. 在问题来源字段中增加 `experience`

### 7.3 题源配比建议

默认：

1. 40% JD
2. 35% 简历
3. 25% 面经

### 7.4 验收标准

1. 开启面经增强后，队列中可出现 `experience` 来源题
2. 关闭增强时，原有逻辑不受影响
3. 问题来源在前端可区分展示

## Phase 7. 追问联动增强

### 8.1 目标

让后续追问和用户回答联动，而不是固定顺序问完整个问题簇。

### 8.2 实现任务

1. 为 `experience_question_item` 增加：
   - `question_role`
   - `parent_item_id`
   - `follow_up_intent`
   - `expected_points_json`
2. 新增回答分析器，输出：
   - `coverage_points`
   - `missed_points`
   - `mentioned_topics`
   - `weak_claims`
   - `answer_depth`
3. 从当前 group 里计算候选追问分数
4. 选择最合适的一条追问

### 8.3 追问打分建议

1. `gap_score`
2. `depth_score`
3. `error_alignment_score`
4. `topic_continuity_score`
5. `repetition_penalty`

### 8.4 验收标准

1. 用户回答较浅时，系统能选择组内更深入的 follow-up
2. 用户已完整覆盖某点时，不再重复问相同问题
3. 问题簇关系可用于恢复追问链

## Phase 8. 生产化检索增强

### 9.1 后续方向

第二阶段再推进：

1. PostgreSQL
2. `tsvector` 全文检索
3. `pgvector` 向量检索
4. 高频问题簇统计
5. 混合召回
6. reranker

### 9.2 当前预埋

本期先预留：

1. `embedding_id` 或向量字段
2. 问题规范化字段
3. 主题簇字段
4. 高频分数字段

## 3. 建议 PR 切分

### PR1. 数据层

1. 新表
2. 新 CRUD
3. 测试数据插入

### PR2. 同步与清洗

1. 同步任务
2. 抓取封装
3. LLM 清洗
4. 入库

### PR3. 面经 API

1. 同步接口
2. 列表接口
3. 详情接口

### PR4. 面经库前端

1. 导航入口
2. 搜索页
3. 同步状态
4. 详情页

### PR5. 模拟面试联动

1. 启动前召回
2. 题源混入队列
3. 来源展示

### PR6. 追问联动

1. 回答分析
2. 候选追问打分
3. 动态选题

### PR7. 检索增强

1. 全文索引
2. 向量索引
3. 混合召回
4. 重排

## 4. 验收检查表

### 功能验收

1. 面经库可同步近 7 日牛客面经
2. 单次最多新增 10 条未入库数据
3. 每条面经能输出统一结构
4. 列表页可搜索和查看详情
5. 模拟面试可选接入面经题源

### 数据验收

1. 同一帖子不会重复入库
2. 每条面经至少能关联 1 个问题组或 1 个问题项
3. 问题项能回溯到原帖

### 体验验收

1. 用户能理解同步进度
2. 失败和跳过原因可解释
3. 面经增强对原有面试流程无破坏

### 技术验收

1. 抓取失败不导致整任务崩溃
2. LLM 清洗失败有回退策略
3. 新增接口与现有 API 风格一致
