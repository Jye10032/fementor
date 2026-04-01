# 面经库与模拟面试联动方案

- 版本：v0.24
- 日期：2026-03-27
- 状态：设计中

## 1. 目标

### 1.1 功能目标

新增 `面经库` 模块，支持用户按关键词获取牛客近 7 日面经，并把结果清洗为可检索、可浏览、可联动模拟面试的结构化数据。

### 1.2 产品目标

该功能不是孤立的“爬虫页”，而是为现有训练闭环新增一个外部真实题源：

1. 面试前调研：查看近期真实高频面经。
2. 面试中增强：把真实面经作为出题、追问、评分的参考来源。
3. 面试后补练：把面经问题转成训练候选题。

## 2. 用户流程

### 2.1 主流程

1. 用户进入 `面经库` 页面。
2. 输入关键词，例如 `前端实习`、`React 面经`、`腾讯 前端`。
3. 点击 `获取近 7 日面经`。
4. 后端启动同步任务：
   - 运行牛客抓取脚本。
   - 过滤近 7 日内容。
   - 跳过已入库内容。
   - 最多保留 10 条。
   - 把内容送入 LLM 做结构化清洗。
   - 入库并建立检索索引。
5. 前端展示同步状态和结果列表。
6. 用户可搜索、筛选、查看详情、加入练习或用于模拟面试。

### 2.2 页面形态

建议新增一级导航：`面经库`

页面主要区域：

1. 搜索与同步区
   - 关键词输入框
   - `获取近 7 日面经` 按钮
   - 示例提示
2. 同步状态区
   - `检索牛客 -> 去重 -> 清洗 -> 入库`
   - 新增 / 跳过 / 失败数量
3. 结果列表区
   - 标题、公司、岗位、发布时间、标签、摘要、高频问题数
4. 筛选区
   - 关键词
   - 时间
   - 公司 / 岗位
   - 技术主题
   - 是否仅看结构化完成
5. 详情区
   - 原文
   - 清洗版
   - 问题组
   - 可联动入口

## 3. 与现有项目的关系

### 3.1 在产品中的位置

推荐主导航顺序：

1. 档案管理
2. 模拟面试
3. 面经库
4. 章节练习 / 题库

### 3.2 与现有闭环的联动

1. `面经库 -> 模拟面试`
   - 面经作为近期真实题源。
2. `面经库 -> 练习`
   - 面经问题可转成练习题候选。
3. `面经库 -> 检索`
   - 面经清洗结果成为统一 retrieval 的新 source。

## 4. 同步与入库规则

## 4.1 同步规则

用户点击 `获取近 7 日面经` 后，系统执行以下规则：

1. 仅抓取指定关键词。
2. 仅保留近 7 日内容。
3. 仅保留未入库内容。
4. 单次最多新增 10 条。
5. 若抓取到更多候选，先进入候选池，再按相关性和质量筛选。

### 4.2 入库前清洗

每条候选内容都需要进入 LLM 结构化清洗流程，目标：

1. 删除广告、内推码、无关表情、噪声文本。
2. 提取公司、岗位、轮次等显式信息。
3. 抽取问题组、问题项、知识点。
4. 给每条问题建立规范化问法。
5. 生成可用于检索和模拟面试的结构化结果。

## 5. 数据模型

建议采用三层结构，不保存为无限嵌套 JSON 树。

### 5.1 experience_post

一篇面经一条记录。

建议字段：

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
17. `created_at`
18. `updated_at`

唯一键建议：

1. `source_platform + source_post_id`

### 5.2 experience_question_group

一篇面经里的一组相关问题，表达一个主题簇或追问链。

建议字段：

1. `id`
2. `post_id`
3. `topic_cluster`
4. `canonical_question`
5. `group_order`
6. `group_type`
7. `frequency_score`
8. `created_at`
9. `updated_at`

### 5.3 experience_question_item

问题组里的单个问题项，是模拟面试联动和检索的核心粒度。

建议字段：

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
14. `embedding_id`
15. `created_at`
16. `updated_at`

说明：

1. `question_role` 建议取值：`main | follow_up | probe | compare | scenario`
2. `parent_item_id` 用于表达追问树，不建议存 children JSON

### 5.4 experience_knowledge_point

可选拆表，用于更细粒度的知识点召回和评分覆盖分析。

建议字段：

1. `id`
2. `question_item_id`
3. `knowledge_point`
4. `weight`
5. `created_at`

## 6. LLM 结构化清洗

### 6.1 必要输出

建议固定输出 JSON，至少包含：

```json
{
  "company_name": "",
  "role_name": "",
  "interview_stage": "",
  "experience_summary": "",
  "topic_groups": [
    {
      "topic_cluster": "",
      "canonical_question": "",
      "items": [
        {
          "question_text_raw": "",
          "question_text_normalized": "",
          "question_role": "main|follow_up|probe|compare|scenario",
          "parent_ref": null,
          "category": "",
          "difficulty": "easy|medium|hard",
          "follow_up_intent": "clarify|deepen|compare|verify|scenario",
          "knowledge_points": [],
          "expected_points": []
        }
      ]
    }
  ],
  "cleaned_content": "",
  "quality_score": 0,
  "is_valid": true
}
```

### 6.2 抽取原则

1. 不编造公司、岗位、轮次。
2. 不改写原意，只做规范化整理。
3. 广告、内推码、无关评论不进入结构化正文。
4. 问题抽取应保留题目上下文顺序。
5. 如果无法确认主问题和追问关系，允许降级为同组平级问题。

## 7. 高频判断与问题簇

### 7.1 高频不是按原文字符串判断

高频统计不能按“问题文本出现次数”做，而应按以下层级统计：

1. `canonical_question`
2. `topic_cluster`
3. 问题共同出现关系

### 7.2 高频指标

建议至少维护 3 类频次：

1. `question_frequency`
   - 同一规范问题近 7 日 / 30 日出现次数
2. `cluster_frequency`
   - 同一主题簇近 7 日 / 30 日出现次数
3. `co_occurrence_frequency`
   - 两个问题或知识点在同一题组中共同出现的次数

### 7.3 高频评分建议

可采用加权热度分：

```text
hot_score =
  0.40 * frequency_7d +
  0.25 * frequency_30d +
  0.15 * company_diversity +
  0.10 * recency_boost +
  0.10 * co_occurrence_strength
```

## 8. 问题切分与追问关系

### 8.1 原则

追问关系的主判断应交给 LLM，而不是靠固定字符串规则硬编码。

### 8.2 推荐方案

采用三段式：

1. 规则切片
   - 只负责把长文本切成候选问题片段
   - 不做追问关系判断
2. LLM 判关系
   - 判断主问题、追问、探针问题
   - 归纳 topic cluster 和 canonical question
3. 规则校验
   - 校验输出结构
   - 做低置信度降级和失败回退

### 8.3 追问关系输出建议

LLM 应输出：

1. 哪个是 `main`
2. 哪些是 `follow_up`
3. 哪些是 `probe`
4. 每个关系的置信度

低置信度时可以回退为：

1. 同组平级问题
2. 或直接按独立问题入库

## 9. 检索召回方案

### 9.1 目标

检索不能停留在 `LIKE` 或简单标签匹配，而要支持：

1. 面经库搜索
2. 模拟面试题目召回
3. 追问候选召回
4. 评分覆盖参考

### 9.2 召回对象

建议分三层索引：

1. 文档级：`experience_post`
2. 问题级：`experience_question_item`
3. 知识点级：`experience_knowledge_point`

### 9.3 生产化检索链路

查询阶段建议采用：

1. Query Understanding
   - 从用户 query / JD / 简历 / 当前题中抽取结构化检索意图
2. 结构化过滤
   - 岗位、轮次、时间、有效状态
3. 全文召回
   - 对标题、清洗正文、规范问题做全文检索
4. 向量召回
   - 对规范问题、摘要、知识点做 embedding 检索
5. 高频补强
   - 对高频问题簇做额外召回
6. 重排
   - 综合 lexical / vector / recency / frequency / role match 做打分

### 9.4 推荐技术方向

若向生产靠拢，建议逐步迁移为：

1. PostgreSQL
2. `tsvector` 做全文检索
3. `pgvector` 做向量检索
4. 后续引入 reranker 做 Top-K 重排

## 10. 模拟面试联动

### 10.1 联动定位

面经不是旁路展示信息，而是模拟面试的动态题源和证据源。

### 10.2 联动阶段

1. 启动前联动
   - 根据 JD / 简历 / 用户关键词召回相关面经问题
2. 出题联动
   - 把面经问题作为问题队列来源之一
3. 追问联动
   - 根据题组中的 follow-up / probe 做追问候选
4. 评分联动
   - 参考近期真实高频考点做覆盖度判断

### 10.3 出题来源建议配比

默认模式可采用：

1. 40% JD 题
2. 35% 简历题
3. 25% 面经题

若开启 `近期面经强化模式`：

1. 30% JD 题
2. 25% 简历题
3. 45% 面经题

## 11. 后续追问如何和用户回答联动

### 11.1 核心原则

追问不是按问题组顺序机械推进，而是根据用户当前回答动态选下一问。

### 11.2 推荐流程

1. 取当前主问题所属 group 的候选追问项
2. 对用户回答做结构化分析
3. 根据分析结果给每个候选追问打分
4. 选分数最高的一条进入下一问

### 11.3 回答分析建议输出

```json
{
  "coverage_points": [],
  "missed_points": [],
  "mentioned_topics": [],
  "weak_claims": [],
  "answer_depth": "shallow|medium|deep",
  "confidence": "low|medium|high"
}
```

### 11.4 追问打分要素

建议综合：

1. `gap_score`
   - 是否覆盖用户遗漏点
2. `depth_score`
   - 是否可以沿已提到但讲得浅的点继续深挖
3. `error_alignment_score`
   - 是否能验证或纠正用户错误理解
4. `topic_continuity_score`
   - 是否和当前上下文自然衔接
5. `repetition_penalty`
   - 是否与已经问过的内容重复

### 11.5 联动方式

推荐做法不是让 LLM 自由生成下一问，而是：

1. 先由检索系统给出当前题组的追问候选
2. 再由 LLM 基于用户回答，从候选中选择最合适的一条

这样比“完全自由生成追问”更稳定、可控、可追溯。

## 12. API 建议

### 12.1 同步任务

1. `POST /v1/experiences/sync`
2. `GET /v1/experiences/sync/:jobId`

### 12.2 面经库查询

1. `GET /v1/experiences`
2. `GET /v1/experiences/:id`

### 12.3 联动入口

1. `POST /v1/experiences/:id/generate-practice`
2. `POST /v1/interview/experience-retrieval/preview`

## 13. MVP 边界

第一版建议只做：

1. 只支持牛客
2. 只支持手动同步
3. 只支持近 7 日最多 10 条
4. 只支持单关键词
5. 只做本地库搜索
6. 只把面经作为模拟面试的可选增强源

暂不做：

1. 多平台抓取
2. 自动定时同步
3. 自动写入正式 question_bank
4. 全量 reranker 服务
5. 多租户复杂推荐

## 14. 风险与约束

1. 内容来源需要保留平台、原文链接、抓取时间和作者信息。
2. 清洗结果不能覆盖原文，必须保留 `content_raw`。
3. 追问关系由 LLM 判断时存在波动，需要置信度和回退策略。
4. 检索系统的核心对象应是 `question_item`，而不是整篇帖子。
5. 如果未来接入真正生产检索能力，建议优先升级存储与索引层，而不是继续堆叠规则搜索。
