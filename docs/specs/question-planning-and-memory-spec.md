# 逐题生成与检索规划 Spec

> **当前状态：部分实施。** 会话级上下文窗口 (`context-service.js` 的 `buildInterviewContextWindow` + `summarizeLongTermMemory`) 已实现，但题目级元数据字段 (`retrieval_query` / `keywords` / `topic`) 尚未加入数据库 schema，展示题与检索 query 尚未分离，仍依赖 `answer_keyword_summary` 作为主路径。

## 背景

当前面试链路中，题目文本主要面向用户展示，属于自然语言面试问句，例如“在 NewsSystemPro 中，你是怎么实现 RBAC 权限控制的？”。这类问句适合对话和展示，但不适合直接作为 Sirchmunk 的主检索输入。

在当前实现中，系统已经通过 `answer_keyword_summary` 对回答进行本地规则压缩，降低长回答直接送检索器的噪音。但近期验证表明：

- 长回答原文直接送 Sirchmunk 时，更容易触发 `DocQA`
- 即使前面显式写了“检索与 xxx 相关的证据片段”，如果后面继续附带完整长回答原文，Sirchmunk 仍可能将整体输入判定为 `explain`
- 当前 `answer_keyword_summary` 可以缓解这个问题，但它只是规则压缩，不理解语义边界，容易保留残句与噪音片段

因此需要调整方案，把“展示题目”和“检索查询”彻底分离，并将面试调度从“整场预生成”改为“逐题生成 + 逐题检索规划 + 逐轮短期记忆更新”。

## 核心目标

- 让用户看到的仍然是自然语言面试题
- 系统内部为每一题单独生成一份适合检索的 `retrieval_query`
- 不再依赖整段面试问句直接触发 Sirchmunk
- 不再在进入页面时一次性生成整场题目与全部检索规划
- 逐轮积累候选人画像和短期记忆，用于下一题动态生成

## 当前问题

### 1. 面试题原文天然更像 DocQA 输入

面试题通常包含“怎么做”“详细讲讲”“为什么这样设计”等表达，这类句式更像解释性问答，而不是检索表达。

当系统把以下内容直接送给 Sirchmunk 时：

- 面试题原文
- 长回答原文
- 补充上下文

Sirchmunk 更容易进入：

- `doc_level: true`
- `op: explain`

从而走 DocQA，而不是先严格找证据。

### 2. 当前 `answer_keyword_summary` 只是规则压缩

当前函数会：

- 清洗文本
- 取前几句
- 用标点拆片段
- 抽短语
- 去停用词
- 拼成一段关键词串

问题在于：

- 不理解语义完整性
- 偏重回答前半段
- 对中文长句不稳定
- 会保留“先把权限挂到角”这类残句

### 3. 开局一次性生成全部题目和规划会拖慢入口

如果在进入页面时一次性生成：

- 当前题
- 后续题
- 每题检索 query
- 追问链
- 评分锚点
- 话题规划

会导致：

- 首屏等待变长
- 很多尚未使用的题目规划提前计算，造成浪费
- 题目无法根据前一轮真实表现动态调整

## 目标方案

## 一题一规划

每一题生成时，同步生成一组题目级元数据，而不是整场一次性生成。

建议结构：

```json
{
  "display_question": "在 NewsSystemPro 中，你是怎么实现 RBAC 权限控制的？",
  "retrieval_query": "检索 NewsSystemPro 中与 RBAC 权限模型、角色分配、用户授权、Express 前置鉴权相关的证据片段",
  "keywords": ["NewsSystemPro", "RBAC", "角色分配", "用户授权", "Express", "鉴权"],
  "topic": "rbac_authorization"
}
```

字段说明：

- `display_question`
  用户看到的自然语言题目
- `retrieval_query`
  检索器使用的内部查询表达
- `keywords`
  供本地检索和 Sirchmunk 查询补强使用
- `topic`
  当前题目的知识点或能力标签

## 逐轮更新短期记忆

每轮回答结束后，不只存 `question/answer/score`，还维护当前 session 的短期记忆。

建议结构：

```json
{
  "current_focus": "rbac_authorization",
  "covered_topics": ["project_overview", "rbac_authorization"],
  "open_points": ["role_permission_model", "why_not_assign_permissions_directly"],
  "observed_strengths": ["能解释 RBAC 的设计动机"],
  "observed_weaknesses": ["缺少表结构和鉴权链路细节"]
}
```

这份短期记忆用于：

- 决定下一题或追问方向
- 控制同一知识块内是否继续追问
- 为块级 compact 提供输入

## 分离入口阻塞与后台准备

### 页面进入时

首屏只保证以下内容 ready：

- session 基础信息
- 当前题目文本
- 当前进度状态

### 进入页面后异步准备

后台异步生成当前题的：

- `retrieval_query`
- `keywords`
- `topic`
- 可选的 follow-up seed

这样：

- 不阻塞页面进入
- 用户可以先思考和输入
- 检索元数据稍后准备完成即可

### 提交回答时兜底

如果题目元数据尚未准备好，提交回答时需要临时补生成一次，不能因为预生成失败而阻断主流程。

## 检索链路建议

## 展示题与检索 query 分离

后续 Sirchmunk 主查询不直接使用展示题原文，而使用：

- `retrieval_query`
- `keywords`
- 轻量回答摘要

而不是：

- 面试题原文
- 完整长回答原文

## 检索链路的职责边界

逐题检索规划需要区分两条链路：

### 1. 评分链路

输入：

- `display_question`
- 用户回答
- 题目级 `expected_points`
- 题型 rubric

用途：

- 生成标准化评分
- 判断标准点覆盖情况
- 输出 strengths / weaknesses / follow-up focus

约束：

- 评分链路不依赖用户上传文档作为标准依据
- 用户资料命中不能直接等价为“回答正确”

### 2. 用户知识比对链路

输入：

- `retrieval_query`
- `keywords`
- `answer_summary`

用途：

- 检索用户笔记、项目总结、知识文档中是否已有相关记录
- 判断当前回答与历史知识记录是否一致
- 判断用户知识库是否存在缺漏或与标准点冲突
- 为 `suggested_note` 生成提供输入

约束：

- Sirchmunk 在该链路中只承担“用户知识证据检索”角色
- 用户知识比对结果只能影响学习反馈，不能替代评分标准

## 回答摘要策略升级

保留当前 `answer_keyword_summary` 作为低成本 fallback，但不建议继续作为主路径。

建议分层如下：

### 主路径

使用 LLM 生成轻量结构化检索规划：

```json
{
  "need_retrieval": true,
  "retrieval_query": "检索与 RBAC 权限控制相关的证据片段",
  "keywords": ["RBAC", "角色分配", "权限分配", "Express 鉴权"],
  "answer_summary": "权限先挂到角色，再把角色分配给用户，并通过 Express 前置鉴权统一校验接口权限"
}
```

### 第一层兜底

如果 JSON 解析失败或字段缺失：

- 本地归一化字段名
- 必要时发一次 repair prompt

### 第二层兜底

如果 repair 仍失败：

- `retrieval_query = display_question` 或预设 query
- `keywords = []`
- `answer_summary = answer_keyword_summary(answer)`

## 面试 orchestrator 调整

当前建议从“整场预生成”改成“逐题 orchestrator”。

新的基本流程：

1. 生成当前题目
2. 同步或异步生成当前题的检索元数据
3. 用户作答
4. 先走评分链路，基于 `rubric + expected_points + answer` 生成标准化评分
5. 再走用户知识比对链路，基于当前题的 `retrieval_query + keywords + answer_summary` 检索用户知识证据
6. 合并输出：
   - 评分结果
   - 缺失点
   - 冲突提示
   - 候选建议笔记
7. 更新短期记忆与用户画像
8. 判断当前知识块是否结束
9. 若未结束，生成同块追问
10. 若已结束，compact 当前块并进入下一题

## 输出结构补充建议

为了避免后续实现把两类证据混用，建议逐题结果结构中显式区分：

```json
{
  "score_result": {
    "score": 7,
    "rubric_refs": [],
    "covered_points": [],
    "missing_points": []
  },
  "note_compare_result": {
    "note_refs": [],
    "note_match_status": "missing|matched|conflicting",
    "conflict_flags": [],
    "suggested_note": null
  }
}
```

约束：

- `rubric_refs` 只服务于评分解释
- `note_refs` 只服务于知识比对与学习反馈
- 前端展示时，两类信息要分块呈现，避免用户误以为“命中笔记 = 回答正确”

## 上下文管理建议

### 长期记忆

保留稳定信息：

- 候选人背景
- 反复出现的优势
- 反复出现的短板
- 已确认的项目事实

### 短期记忆

保留当前面试进展：

- 当前块考察主题
- 已问到哪些点
- 还欠哪些细节
- 当前轮的评分观察

### 块级 compact

同一 topic 的若干 turn 结束后，将其压缩为一条块摘要，再进入下一个 topic。

这比简单按 token 长度截断更符合面试场景。

## 预期收益

- 降低 Sirchmunk 误入 DocQA 的概率
- 降低长回答原文直接参与检索的噪音
- 提升题目与检索目标的一致性
- 提升入口加载速度
- 让下一题真正受前一题表现影响
- 为后续块级上下文管理打基础

## 风险与注意事项

- 如果结构化规划完全依赖 LLM，需配套 repair 和 fallback，不能让 JSON 格式成为单点故障
- 题目生成与 query 生成不要强耦合在首屏阻塞链路
- `retrieval_query` 不能只是“把面试题换个说法”，需要更明确地体现证据目标
- 负例场景需要单独约束：
  当 `evidence_refs` 为空或相关性不足时，不允许输出事实判断

## 实施顺序建议

1. 题目模型增加题目级元数据输出：
   `display_question + retrieval_query + keywords + topic`
2. 调整 turn / question 数据结构，支持保存题目级检索元数据
3. 页面进入后异步准备当前题元数据，不阻塞入口
4. 检索主链路优先使用题目级 `retrieval_query`
5. 保留 `answer_keyword_summary` 作为 fallback
6. 每轮评分后更新短期记忆
7. 引入块级 compact 和 topic-based orchestrator
