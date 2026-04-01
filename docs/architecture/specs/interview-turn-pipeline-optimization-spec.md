# 面试流程优化 Spec（v3）

> **当前状态：尚未实施（v3 方案重写于 2026-04-01）。** v2 的单轮链路优化（统一 LLM 调用 + 流式 content 分割器）已实现代码骨架。v3 在此基础上将面试流程从"预生成 5 题队列"改为"关键词队列驱动 + 逐题召回"，并新增关键词级掌握度评估和最终面试报告。

## 一、整体流程

```
简历 + JD
  ↓
LLM 分析 → 关键词队列（带简历条目映射）
  ↓
┌─────────────────────────────────────────────┐
│ 循环：取当前关键词 → 面经库召回 → 提问       │
│                                             │
│  用户回答                                    │
│    ↓                                        │
│  LLM 统一调用：评分 + 判断下一步             │
│    │                                        │
│    ├─ 期望点未命中 → 追问期望点              │
│    ├─ 面经库有 followup → LLM 验证后采用     │
│    └─ 当前关键词验证完毕                     │
│         → 记录该关键词掌握情况               │
│         → 取下一个未覆盖的关键词             │
│                                             │
│  直到：题数满 / 关键词用完                    │
└─────────────────────────────────────────────┘
  ↓
汇总所有关键词掌握情况 → 生成最终评估报告
```

## 二、关键词队列生成

### 2.1 输入

- `resumeStructured`：现有 `summarizeResumeWithLLM` 的输出（summary、projects、all_tech_entities）
- `jobDescription`：JD 原文
- `level2Vocabulary`：从知识图谱骨架（`data/knowledge-graph-skeleton.json`）提取的 Level 2 词表，约 40-50 个词

Level 2 词表提取方式：

```js
function getLevel2Vocabulary(graph) {
  const level2 = [];
  for (const [name, node] of Object.entries(graph)) {
    if (node.children && node.children.length > 0) {
      level2.push(...node.children);
    }
  }
  return [...new Set(level2)];
}
```

### 2.2 关键词粒度

对齐知识图谱 Level 2（子话题）：

```
Level 1 (大类)        Level 2 (子话题)         Level 3 (知识点)
─────────────        ──────────────          ──────────────
JavaScript     →     闭包                →   词法作用域、内存泄漏、柯里化
                     原型链              →   原型继承、构造函数、class语法
                     事件循环            →   宏任务、微任务、requestAnimationFrame
React          →     Hooks原理           →   useState、useEffect、useMemo、useCallback
                     Fiber架构           →   虚拟DOM、Diff算法
                     性能优化            →   React.memo、懒加载
CSS            →     BFC                →   ...
                     Flex布局            →   ...
浏览器          →     HTTP缓存            →   强缓存、协商缓存
                     跨域方案            →   CORS、代理
工程化          →     Webpack             →   Tree Shaking、代码分割
                     微前端              →   Module Federation
性能优化        →     首屏优化            →   懒加载、SSR、CDN
```

- Level 1 太粗（"React" 召回范围太广）
- Level 3 太细（"词法作用域" 只能问一题）
- Level 2 刚好能撑起一个考察回合（2-3 题）

### 2.3 Prompt 设计

```js
const buildKeywordQueuePrompt = ({ resumeStructured, jobDescription, level2Vocabulary }) => ({
  system: [
    '你是前端面试规划师。',
    '你的任务是分析候选人简历和目标岗位 JD，提取一组面试考察关键词队列。',
    '',
    '## 关键词粒度',
    '关键词必须对齐 Level 2（子话题）粒度，不要太粗（如"React"）也不要太细（如"useState"）。',
    '参考词表（优先使用，但不限于此）：',
    level2Vocabulary.join('、'),
    '',
    '## 提取规则',
    '1. 每个关键词必须能追溯到简历中的具体描述，在 resume_anchor 中给出原文片段',
    '2. 同一段简历描述可以拆出多个关键词',
    '3. JD 中明确要求但简历未提及的技能，也要提取，resume_anchor 标记为 "JD要求，简历未提及"',
    '4. 按面试价值排序：JD 强相关 + 简历有深度描述的排前面',
    '5. 总数控制在 6-10 个',
    '',
    '## 输出格式',
    '只输出 JSON，不要输出其他内容。',
  ].join('\n'),

  user: JSON.stringify({
    resume: {
      summary: resumeStructured.summary,
      projects: resumeStructured.projects.map(p => ({
        name: p.name,
        description: p.original_description,
        tech_entities: p.tech_entities,
        key_features: p.key_features,
      })),
      all_tech_entities: resumeStructured.all_tech_entities,
    },
    job_description: String(jobDescription || '').slice(0, 2000),
    output_contract: {
      keywords: [{
        keyword: "Level 2 子话题名称",
        category: "Level 1 大类名称",
        resume_anchor: "简历中的原文片段，或 'JD要求，简历未提及'",
        jd_relevance: "high|medium|low",
        interview_angle: "建议的提问切入角度",
      }]
    },
  }),
});
```

### 2.4 输出结构

```json
{
  "keywords": [
    {
      "keyword": "Hooks原理",
      "category": "React",
      "resume_anchor": "使用 React 18 + Hooks 重写状态管理层",
      "jd_relevance": "high",
      "interview_angle": "你简历里提到用 Hooks 重写了状态管理层，能讲讲具体怎么做的吗"
    },
    {
      "keyword": "首屏优化",
      "category": "性能优化",
      "resume_anchor": "将首屏 LCP 从 3.2s 降至 1.1s",
      "jd_relevance": "high",
      "interview_angle": "你提到 LCP 从 3.2s 降到了 1.1s，具体用了哪些优化手段"
    },
    {
      "keyword": "微前端",
      "category": "工程化",
      "resume_anchor": "主导微前端改造，接入 Module Federation",
      "jd_relevance": "medium",
      "interview_angle": "你们为什么选择 Module Federation 做微前端，有没有考虑过其他方案"
    },
    {
      "keyword": "TypeScript",
      "category": "工程化",
      "resume_anchor": "JD要求，简历未提及",
      "jd_relevance": "high",
      "interview_angle": "JD 里要求 TypeScript，你在项目中用过吗"
    }
  ]
}
```

### 2.5 运行时结构

关键词队列在 session 中的运行时状态：

```json
{
  "keyword": "Hooks原理",
  "category": "React",
  "resume_anchor": "使用 React 18 + Hooks 重写状态管理层",
  "jd_relevance": "high",
  "interview_angle": "...",
  "max_turns": 3,
  "asked_turns": 0,
  "status": "pending",
  "proficiency_snapshot": null,
  "covered_by_other_turns": false
}
```

- `max_turns`：固定值（所有关键词统一）
- `status`：`pending` → `in_progress` → `completed`
- `proficiency_snapshot`：当前关键词验证完毕时由 LLM 输出，如 "了解 Hooks 基本用法，对性能优化相关 Hooks 掌握较浅"
- `covered_by_other_turns`：通过知识图谱判断该关键词是否已被其他轮次的 followup 覆盖

## 三、面试会话流程

### 3.1 Session 初始化

1. LLM 生成关键词队列（1 次 LLM）
2. 生成开场自我介绍题（固定模板，0 次 LLM）
3. 用第一个关键词从面经库 embedding 召回首题（非 LLM）
4. 返回 session 信息 + 自我介绍题

开场题固定为自我介绍，不消耗关键词队列的 `max_turns`。自我介绍结束后进入第一个关键词的考察。

### 3.2 逐轮流程

```
用户回答
  ↓
1. 证据检索 buildEvidenceBundle（非 LLM）
2. 搜索候选追问（面经库 embedding，非 LLM）
3. 统一 LLM 调用 processInterviewTurnWithLLM（1 次 LLM，流式）
   输出：评分 + next_action + follow_up_validation + keyword_proficiency_snapshot + content
  ↓
根据 next_action 分支：
  │
  ├─ "follow_up_expected_point"
  │   期望点未命中，需要追问
  │   → 面经库有 followup 且 LLM 验证 suitable → adaptFollowUp（1 次 LLM）
  │   → 面经库无 followup → generateFollowUpQuestion（1 次 LLM）
  │   → 当前关键词 asked_turns++
  │
  ├─ "follow_up_from_bank"
  │   面经库有相关 followup，LLM 验证可用
  │   → adaptFollowUp（1 次 LLM）
  │   → 当前关键词 asked_turns++
  │
  └─ "new_keyword"
      当前关键词验证完毕
      → 记录 proficiency_snapshot
      → 标记当前关键词 status = completed
      → 用知识图谱检查剩余关键词是否已被覆盖
      → 取下一个未覆盖的关键词
      → 面经库 embedding 召回该关键词的首题（非 LLM）
      → 若面经库未命中，LLM 生成题目（1 次 LLM）
```

### 3.3 next_action 判定逻辑

统一 LLM 调用输出 `next_action`，取值：

| 值 | 含义 | 触发条件 |
|---|---|---|
| `follow_up_expected_point` | 追问期望点 | expected_points 有明显未命中项 |
| `follow_up_from_bank` | 采用面经库 followup | 候选 followup 与薄弱点匹配 |
| `new_keyword` | 进入下一个关键词 | 当前关键词的核心点已验证 |

LLM 判断时需要考虑：
- 当前关键词已问了几轮（`asked_turns`），是否接近 `max_turns`
- `expected_points_hit` 和 `expected_points_missed` 的比例
- `knowledge_boundary` 中是否还有值得追问的点
- 当 `asked_turns >= max_turns` 时，强制输出 `new_keyword`

### 3.4 关键词覆盖判断

当一个关键词的 followup 涉及了其他关键词的知识点时，通过知识图谱判断覆盖关系：

```js
function checkKeywordCoverage(keywordQueue, turnKnowledgePoints, graph) {
  for (const kw of keywordQueue) {
    if (kw.status !== 'pending') continue;
    const kwL3Points = graph[kw.keyword]?.children || [];
    const covered = kwL3Points.filter(point =>
      turnKnowledgePoints.some(tp => tp === point || isGraphNeighbor(graph, tp, point))
    );
    if (covered.length >= kwL3Points.length * 0.6) {
      kw.covered_by_other_turns = true;
    }
  }
}
```

选下一个关键词时跳过已覆盖的：

```js
function pickNextKeyword(keywordQueue) {
  return keywordQueue.find(kw =>
    kw.status === 'pending' && !kw.covered_by_other_turns
  );
}
```

### 3.5 面试结束条件

满足以下任一条件时结束面试：

1. 所有关键词 `status === 'completed'` 或 `covered_by_other_turns === true`
2. 总轮次达到上限
3. 用户主动结束

## 四、统一 LLM 调用（v3 扩展）

### 4.1 输出结构

在 v2 基础上新增 `next_action`、`expected_points_hit/missed`、`keyword_proficiency_snapshot` 字段：

```json
{
  "intent": "answer",
  "intent_confidence": 94,
  "question_type": "project",
  "question_type_reason": "...",
  "score": 74,
  "dimension_scores": {
    "technical_depth": 18,
    "structure_clarity": 20,
    "evidence_grounding": 16,
    "role_fit": 20
  },
  "strengths": ["回答结构完整"],
  "weaknesses": ["技术取舍不够具体"],
  "feedback": "建议补充方案验证和量化结果。",
  "standard_answer": "...",
  "knowledge_boundary": {
    "mentioned_but_shallow": ["缓存策略"],
    "conspicuously_absent": ["接口级鉴权"]
  },
  "expected_points_hit": ["Hooks 状态管理", "useCallback"],
  "expected_points_missed": ["useMemo 与 React.memo 区别"],
  "next_action": "follow_up_expected_point",
  "next_action_reason": "候选人没有区分 useMemo 和 React.memo，需要追问",
  "follow_up_validation": {
    "suitable": true,
    "reason": "候选追问聚焦 React.memo 适用场景，与当前薄弱点匹配"
  },
  "keyword_proficiency_snapshot": null,
  "content": "你对 Hooks 的基本用法掌握得不错..."
}
```

当 `next_action === 'new_keyword'` 时，`keyword_proficiency_snapshot` 输出当前关键词的掌握情况总结：

```json
{
  "next_action": "new_keyword",
  "next_action_reason": "Hooks 相关核心点已验证完毕",
  "keyword_proficiency_snapshot": "了解 Hooks 基本用法，useCallback/useMemo 使用正确，但对 React.memo 的适用场景理解不够深入",
  "content": "..."
}
```

### 4.2 Prompt 扩展

在 v2 统一 prompt 基础上，新增以下输入：

- `current_keyword`：当前考察的关键词及 resume_anchor
- `keyword_asked_turns`：当前关键词已问轮次
- `keyword_max_turns`：当前关键词最大轮次
- `expected_points`：当前题目的期望点列表

新增以下输出规则：

- `expected_points_hit`：候选人回答命中的期望点
- `expected_points_missed`：候选人回答未命中的期望点
- `next_action`：下一步动作（`follow_up_expected_point` / `follow_up_from_bank` / `new_keyword`）
- `next_action_reason`：决策原因
- 当 `keyword_asked_turns >= keyword_max_turns` 时，必须输出 `next_action: "new_keyword"`
- 当 `next_action === 'new_keyword'` 时，必须输出 `keyword_proficiency_snapshot`

## 五、逐题召回机制

### 5.1 关键词首题召回

每个关键词开始考察时，从面经库 embedding 召回最相关的题目：

```js
async function recallQuestionForKeyword({ keyword, resumeAnchor, graph, sessionContext }) {
  // 1. 知识图谱展开：keyword → 相关 Level 3 知识点
  const expandedTerms = expandWithGraph([keyword], graph);

  // 2. 构建增强 query：resume_anchor + 展开词
  const query = buildEnhancedQuery(resumeAnchor, expandedTerms);

  // 3. embedding 召回
  const embedding = await embeddingCompletion(query, sessionContext);
  const hits = searchByEmbedding(embedding, 10);

  // 4. 图谱重排
  const ranked = rerankWithGraph(hits, expandedTerms);

  // 5. 返回最佳匹配的 group（带 follow_up chain）
  return ranked[0] || null;
}
```

若面经库未命中，使用关键词的 `interview_angle` + `resume_anchor` 调用 LLM 生成题目（1 次 LLM）。

### 5.2 追问题来源

追问题按优先级：

1. 当前题目的 `_follow_up_chain`（面经库已有追问链）
2. 面经库 embedding 检索相关追问
3. LLM 生成新追问（fallback）

## 六、最终评估报告

### 6.1 输入

面试结束后，汇总所有关键词的轮次数据：

```json
{
  "keyword_results": [
    {
      "keyword": "Hooks原理",
      "category": "React",
      "resume_anchor": "使用 React 18 + Hooks 重写状态管理层",
      "turns": [
        { "turn_index": 2, "score": 72, "strengths": [...], "weaknesses": [...] },
        { "turn_index": 3, "score": 68, "strengths": [...], "weaknesses": [...] }
      ],
      "proficiency_snapshot": "了解 Hooks 基本用法，对性能优化相关 Hooks 掌握较浅"
    }
  ]
}
```

### 6.2 输出

LLM 生成结构化面试报告（1 次 LLM）：

```json
{
  "overall_score": 72,
  "overall_assessment": "候选人前端基础扎实，项目经验丰富，但在性能优化深度和工程化细节上有提升空间",
  "keyword_assessments": [
    {
      "keyword": "Hooks原理",
      "category": "React",
      "proficiency": "掌握良好",
      "detail": "Hooks 基本用法熟练，useCallback/useMemo 使用正确，但对 React.memo 的适用场景理解不够深入",
      "avg_score": 70
    },
    {
      "keyword": "首屏优化",
      "category": "性能优化",
      "proficiency": "了解基础",
      "detail": "了解基本的性能优化手段（懒加载、代码分割），但对 LCP 指标的深层优化掌握欠缺",
      "avg_score": 58
    }
  ],
  "cross_keyword_observations": [
    "连续三题缺少量化指标，建议练习用数据支撑回答",
    "项目经历描述偏重实现细节，缺少业务价值和技术取舍的表达"
  ],
  "recommended_focus": ["React.memo 与性能优化", "首屏 LCP 深层优化", "技术方案取舍表达"]
}
```

## 七、LLM 调用次数汇总

| 时机 | 调用次数 | 说明 |
|------|---------|------|
| 简历分析 + 关键词提取 | 1 次 | 可合并到现有 `summarizeResumeWithLLM`，或独立调用 |
| 开场自我介绍题 | 0 次 | 固定模板 |
| 关键词首题 | 0-1 次 | 面经库命中则 0，否则 1 |
| 每轮评分 + 下一步决策 | 1 次 | 统一调用 `processInterviewTurnWithLLM` |
| 追问改写 | 0-1 次 | `adaptFollowUp`，面经库命中时 |
| 新关键词首题 | 0-1 次 | 面经库命中则 0 |
| 最终报告 | 1 次 | 汇总所有关键词评分 |

大部分轮次 1 次 LLM，偶尔 2 次。

## 八、流式 JSON 分割器

（与 v2 相同，已实现）

位置：`apps/api/src/interview/content-stream-splitter.js`

职责：接收 LLM 流式输出，将 `content` 字段之前的结构化 JSON 缓冲在后端，检测到 `"content":"` 后将后续 token 通过 SSE 推送给前端。

Fallback：若 LLM 未按顺序输出，等整个 JSON 完成后一次性推送 content。

## 九、SSE 事件

与 v2 相同：`meta` / `stage` / `token` / `result` / `done` / `error` 不变。

`stage.step` 枚举：`retrieval` → `evaluation` → `persist` → `planning`。

## 十、迁移计划

### Phase 1：关键词队列生成

- 新增 `generateKeywordQueue` 函数
- 实现 `getLevel2Vocabulary` 从知识图谱骨架提取词表
- 改造 session start 流程：生成关键词队列 → 存入 session → 召回首题

### Phase 2：逐题召回

- 新增 `recallQuestionForKeyword` 函数
- 改造 turn-service：每轮结束后根据 `next_action` 决定下一题来源
- 实现关键词覆盖判断（知识图谱距离）

### Phase 3：统一 LLM 调用扩展

- 扩展 `processInterviewTurnWithLLM` prompt，新增 `next_action` / `expected_points_hit` / `keyword_proficiency_snapshot`
- 传入 `current_keyword` / `keyword_asked_turns` / `keyword_max_turns`

### Phase 4：最终报告

- 新增面试结束报告生成
- 汇总关键词级掌握度 → LLM 生成结构化报告
- 前端展示报告页面

### Phase 5：清理

- 移除旧的 `generateInterviewQuestionQueue`（一次性生成 5 题）
- 移除旧的 session start 批量出题逻辑
- 更新文档

## 十一、风险与应对

### 1. LLM 不遵守字段顺序

应对：分割器 fallback — 整个 JSON 完成后一次性推送 content。

### 2. 关键词提取质量不稳定

应对：提供 Level 2 词表作为参考；输出数量限制 6-10 个；保留人工调整入口。

### 3. 面经库覆盖不足导致频繁 LLM 生成

应对：面经库数据越多，LLM 生成越少；生成的追问异步回写面经库（待实现）。

### 4. max_turns 固定值可能不适合所有关键词

应对：先用固定值验证流程，后续可按 jd_relevance 动态分配。

### 5. 上下文压缩的额外 LLM 调用

`buildInterviewContextWindow` 在历史轮次较多时会触发 `summarizeInterviewOverflow`（1 次 LLM），不计入主链路预算。

## 十二、验收标准

1. 面试流程由关键词队列驱动，不再一次性预生成 5 题。
2. 每个关键词考察不超过 `max_turns` 轮。
3. 正式回答（无追问）1 次 LLM 调用。
4. 正式回答（有追问）不超过 2 次 LLM 调用。
5. 面经库追问复用能力不丢失。
6. 流式 content 输出体验不变。
7. 面试结束后生成关键词级掌握度评估报告。
8. 通过 feature flag 可回退到旧链路。
