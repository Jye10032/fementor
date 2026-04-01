# 题库三层模型方案

- 版本：v0.1
- 日期：2026-03-27
- 状态：设计中

## 1. 目标

把当前偏“用户私有题单”的 `question_bank` 语义，收敛为更稳定的三层模型：

1. 公共题源层
2. 用户题库层
3. 练习记录层

该模型既服务线上登录态 + PostgreSQL，也服务本地免登录 + SQLite，不再让“本地/线上差异”侵入题库业务本身。

## 2. 为什么要拆三层

当前系统里的 `question_bank` 同时承担了三件事：

1. 题目定义
2. 用户自己的练习状态
3. 题目的来源追溯

这会带来几个问题：

1. 同一道题无法被多个用户稳定复用。
2. 面经题、模拟面试题、文档抽取题缺少统一题源模型。
3. 用户状态和题目定义混在一起，后续扩展检索、高频统计、题目合并会很难。

因此需要拆成三层。

## 3. 三层模型

## 3.1 公共题源层

### 定位

公共题源层是“题目素材池”，记录系统已经识别出来的公共题目定义，不直接等于某个用户的个人题库。

### 来源

题源可以来自：

1. 面经问题项
2. 模拟面试生成题
3. 练习沉淀题
4. 简历 / JD / 文档抽取题
5. 手工添加题

### 设计目标

1. 同一道题只定义一次。
2. 多个用户可以引用同一个公共题源。
3. 题源要能回溯到原始来源。

### 推荐表：`question_source`

建议字段：

1. `id`
2. `source_type`
   - `experience/interview/resume/jd/manual`
3. `source_ref_id`
   - 对应 `experience_question_item.id` 或其他源对象 ID
4. `canonical_question`
5. `question_text`
6. `category`
7. `difficulty`
8. `knowledge_points_json`
9. `expected_points_json`
10. `created_at`
11. `updated_at`

### 设计规则

1. `canonical_question` 是公共题目归一化锚点。
2. `source_type + source_ref_id` 用于回溯题源。
3. 题源层不存用户自己的掌握状态和复习进度。

## 3.2 用户题库层

### 定位

用户题库层是“某个用户的题单”，描述用户和公共题源之间的关系。

### 作用

同一道公共题源，可以被不同用户各自：

1. 收藏
2. 加入练习
3. 标记难度
4. 标记薄弱项
5. 设置复习计划

### 推荐表：`user_question_bank`

建议字段：

1. `id`
2. `user_id`
3. `question_source_id`
4. `chapter`
5. `custom_question_text`
6. `review_status`
7. `mastery_level`
8. `weakness_tag`
9. `next_review_at`
10. `is_favorited`
11. `created_at`
12. `updated_at`

### 设计规则

1. `user_question_bank` 是真正意义上的“用户题库”。
2. 同一 `question_source_id` 可以被多个用户各自拥有。
3. 用户层允许覆盖部分展示字段，例如 `custom_question_text`。
4. 复习计划和掌握度只存在这一层，不污染公共题源。

## 3.3 练习记录层

### 定位

练习记录层描述用户每次作答的行为数据，是题库之外的“行为历史”。

### 作用

记录：

1. 回答内容
2. 分数
3. 优点 / 缺点
4. 错因
5. 是否掌握
6. 下次复习时间

### 推荐表：`question_attempt`

建议字段：

1. `id`
2. `user_id`
3. `user_question_bank_id`
4. `mode`
   - `practice/interview`
5. `answer`
6. `score`
7. `strengths_json`
8. `weaknesses_json`
9. `feedback`
10. `next_review_at`
11. `mastered`
12. `created_at`

### 设计规则

1. 一次作答就是一条 attempt。
2. 题目定义和练习历史必须分离。
3. 用户是否掌握，不应该写回 `question_source`。

## 4. 当前系统与目标系统的关系

## 4.1 当前状态

当前系统更接近“用户私有题库”：

1. `interview_question`
   - 一场面试里的队列题
2. `interview_turn`
   - 用户在面试中的作答记录
3. `question_bank`
   - 复盘后直接沉淀为用户题单

### 当前缺失

1. 没有公共题源层。
2. 没有“一个题源被多个用户复用”的模型。
3. 面经题、模拟面试题、文档题没有统一汇流入口。

## 4.2 目标状态

目标数据流：

1. 面经 / 模拟面试 / 文档题 -> `question_source`
2. 用户收藏 / 加入练习 -> `user_question_bank`
3. 用户每次练习或面试作答 -> `question_attempt`

## 5. 与本地 / 线上部署的关系

## 5.1 原则

题库不能按“本地一套、线上一套”设计，而应按：

1. 同一套业务模型
2. 两种身份解析方式
3. 两种存储实现方式

### 线上

1. 走登录态
2. 用户信息写 PostgreSQL
3. 题库数据写 PostgreSQL

### 本地

1. 默认本地用户，例如 `local_dev_user`
2. 不要求登录
3. 题库数据写本地 SQLite

### 关键结论

本地不是“无用户模式”，而是“默认本地用户模式”。

这样上层业务逻辑不需要到处判断：

1. 当前是不是本地
2. 当前有没有用户
3. 当前该写哪张不同语义的表

## 5.2 推荐实现方式

为题库增加 repository 抽象：

1. `questionSourceRepo`
2. `userQuestionBankRepo`
3. `questionAttemptRepo`

底层实现两套：

1. SQLite repository
2. PostgreSQL repository

运行时按环境变量切换。

## 6. 与面经模块的关系

面经模块当前已经有：

1. `experience_post`
2. `experience_question_group`
3. `experience_question_item`

这些对象目前属于“外部题源素材层”，但还没有进入正式题库。

### 推荐接入方式

1. `experience_question_item` 经过去重 / 规范化后，生成或命中 `question_source`
2. 当用户点击“加入练习”或系统推荐补练时，再生成 `user_question_bank`
3. 用户作答后再写 `question_attempt`

### 设计原则

不要让面经题直接跳过 `question_source` 写入用户题库。

否则：

1. 无法复用公共题
2. 无法稳定聚合同题
3. 无法做高频题统计

## 7. 与现有 `question_bank` 的关系

## 7.1 短期策略

短期不立即推翻现有 `question_bank`，而是把它视为：

1. `user_question_bank` 的早期版本

建议先补充语义：

1. `source_type`
2. `source_ref_id`
3. `canonical_question`

## 7.2 长期策略

后续逐步拆成：

1. `question_source`
2. `user_question_bank`
3. `question_attempt`

这样迁移成本更可控。

## 8. 推荐落地顺序

### Phase A

先写清统一语义，不改线上功能：

1. 文档层确认三层模型
2. 确认本地 / 线上统一用户上下文

### Phase B

新增公共题源表：

1. `question_source`
2. 从面经题、模拟面试题生成题源

### Phase C

把现有 `question_bank` 过渡为用户题库：

1. 逐步映射到 `user_question_bank`
2. 保持现有练习页可用

### Phase D

统一练习记录：

1. 新增 `question_attempt`
2. 练习页和面试页都写到统一行为层

## 9. 验收标准

1. 同一道公共题可被多个用户复用。
2. 用户自己的复习计划和掌握状态不污染公共题定义。
3. 面经题、模拟面试题、文档题都能汇流到统一题源层。
4. 本地和线上共享同一套题库业务语义。
5. 题库、练习记录、来源追溯三者边界清晰。

## 10. 实施文档

实现层细节见：

1. `docs/architecture/question-bank-implementation-plan.md`
2. `docs/数据库字段级设计.md`
3. `docs/最小API契约.md`
