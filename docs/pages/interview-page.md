# 模拟面试页

- 版本：v1.0
- 日期：2026-03-17
- 路径：
  - `/interview`
  - `/interview/session`

## 1. 页面拆分

当前模拟面试相关页面分两层：

### `/interview`

作用：

1. 选择当前简历
2. 选择当前 JD
3. 上传新的简历或 JD
4. 启动一场新的模拟面试

对应文件：

- `apps/web/app/interview/page.tsx`

### `/interview/session`

作用：

1. 展示当前题目队列
2. 展示面试对话主区域
3. 提交回答并接收流式评价
4. 结束会话与生成复盘

对应文件：

- `apps/web/app/interview/session/page.tsx`
- `apps/web/components/interview-session-room.tsx`

## 2. `/interview` 当前职责

### 数据准备

页面会并行加载：

1. `GET /v1/resume/library`
2. `GET /v1/jd/library`

### 用户操作

1. 选择已有简历 / 上传新简历
2. 选择已有 JD / 上传新 JD
3. 调用：
   - `POST /v1/resume/parse`
   - `POST /v1/jd/upload`
   - `POST /v1/resume/select`
   - `POST /v1/jd/select`
4. 最后启动：
   - `POST /v1/interview/sessions/start`

### 页面当前技术点

1. 本地 `useState`
2. `FormData` 上传文件
3. `apiRequest()` 统一请求
4. 启动后用 query 参数跳转到 `/interview/session`

## 3. `/interview/session` 当前职责

### 组件核心

主逻辑集中在：

- `InterviewSessionRoom`

它负责：

1. 加载题目队列
2. 维护聊天流
3. 发起流式答题请求
4. 在右侧展示题目队列、状态统计、复盘结果、调试输出

### 当前主要状态

包括：

1. `turns`
2. `conversationRows`
3. `queueItems`
4. `currentQuestionId`
5. `retrospect`
6. `output`
7. `submittingTurn`
8. `retrospecting`
9. `finishing`

## 4. 聊天区实现

### ConversationTranscript

负责把以下消息按统一时间流插入：

1. AI 问题
2. 用户回答
3. AI 评价
4. 系统提示

### Composer

负责：

1. 输入回答
2. 发送回答
3. 根据当前题目状态启用或禁用提交

## 5. 流式评分实现

答题优先调用：

- `POST /v1/interview/sessions/:session_id/turns/stream`

前端会消费 SSE：

1. `stage`
   - 在评价真正开始流式返回前，先显示阶段提示
2. `token`
   - 把增量文本持续拼接到同一个评价气泡中
3. `result`
   - 收到最终结构化结果后更新 turn、队列和下一个题目
4. `error`
   - 流式失败时抛错

### 当前回退策略

如果 SSE 半路失败：

1. 前端会显示“正在回退到普通评分”
2. 再调用非流式：
   - `POST /v1/interview/sessions/:session_id/turns`

## 6. 队列与追问展示

右侧 `QueuePanel` 会展示：

1. 当前题
2. 已回答题
3. `follow_up`
4. 新插入的追问高亮

说明：

1. 队列不是纯静态列表。
2. 当前题答完后，后端可能动态插入 1 道追问。
3. 前端通过 `reconcileQueueItems()` 把队列和当前题状态对齐。

## 7. 状态面板与复盘面板

### StatusPanel

展示：

1. 已答题数
2. 平均得分
3. 最近一轮证据命中数和检索策略

### RetrospectPanel

展示：

1. 会话平均分
2. 回流题目数
3. `long_term_memory`
4. `memory_path`

## 8. 当前页面依赖的后端能力

### 会话能力

1. `start`
2. `questions`
3. `turns`
4. `turns/stream`
5. `finish`
6. `retrospect`

### 编排能力

后端负责：

1. intent 判断
2. question_type 判断
3. 检索规划
4. 评分
5. 生成自然语言评价
6. follow_up 插入

## 9. 当前已知限制

1. 当前聊天区消息累积后还没有做分段折叠或更细的历史管理。
2. 调试输出仍直接展示 JSON，适合开发，不够产品化。

## 10. 示例文案

### 10.1 通用 JD 概览

```markdown
岗位职责包括梳理用户体验链路、与产品/设计/后端协作推进可量化交付、并在项目中扮演技术负责人角色。期望候选人熟悉
现代前端框架（React/Next.js）、状态管理、API 设计，以及前端构建/部署流水线；能够以数据观点衡量体验质量并推动自动化回归。
```

### 10.2 核心能力与成果参考

- 具备组件化与微前端经验，能将碎片化需求整合成可复用的交互模式，缩短新功能交付周期 25%。
- 熟练掌握 TypeScript、GraphQL/REST 与前沿响应式布局，在跨平台 UI 项目中保障一致性与性能。
- 建立可视化指标体系（LCP、FCP、交互延迟、错误率），驱动常态化优化与快速定位问题。
3. 当前只对评价文本做流式渲染，不是对所有中间状态都做细粒度可视化。

## 10. 后续建议

1. 把调试输出收敛到折叠面板。
2. 在头部或状态面板里明确展示：
   - 当前题型
   - 当前解析阶段
   - 是否插入追问
3. 后续如果上下文继续增长，可再补“会话上下文管理方案”文档并与编排架构联动。
