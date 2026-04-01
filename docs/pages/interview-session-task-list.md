# 模拟面试会话页任务清单

- 版本：v1.0
- 日期：2026-03-23
- 对应方案：
  - `docs/pages/interview-session-implementation-plan.md`
  - `docs/pages/interview-session-optimization-spec.md`
- 对应实现：
  - `apps/web/components/interview-session-room.tsx`
  - `apps/web/app/interview/session/page.tsx`

## 1. 使用方式

这份清单不是 PRD，而是实现落地清单。

使用原则：

1. 默认按 `P0 -> P1 -> P2` 顺序执行。
2. 每完成一项，都需要检查是否影响 SSE、队列同步和切题逻辑。
3. 第一版未稳定前，不向页面继续堆叠新操作入口。

## 2. P0 任务清单

### 2.1 页面结构重构

- [x] 把当前双栏布局改为单主区布局，移除常驻右侧栏。
- [x] 保留顶部状态栏，但弱化现有过多字段展示。
- [x] 固定顶部题目区，保证聊天滚动时题目仍然可见。
- [x] 固定底部回答区，保证回答入口位置稳定。
- [x] 让聊天区在中间区域独立滚动。

### 2.2 组件拆分

- [x] 从 `InterviewSessionRoom` 中拆出 `SessionTopBar`。
- [x] 从 `InterviewSessionRoom` 中拆出 `CurrentQuestionCard`。
- [x] 新增 `StageStatusBar`。
- [x] 保留并瘦身 `ConversationTranscript`。
- [x] 调整 `Composer`，让它适配固定底部和多种禁用态。
- [x] 新增 `InterviewPanelDrawer`。
- [x] 新增 `InterviewPanelTabs`。
- [x] 新增 `InterviewProgressTab`。
- [x] 新增 `InterviewQuestionTab`。
- [x] 新增 `InterviewRetrospectTab`。
- [x] 新增 `InterviewCompletionReport`。

### 2.3 题目展示职责迁移

- [x] 停止把当前题自动追加到 `conversationRows`。
- [x] 删除或重写 `askedQuestionIdsRef` 相关逻辑。
- [x] 让当前题只由 `CurrentQuestionCard` 承载。
- [x] 聊天区只保留 AI 评价、用户回答、系统提示。

### 2.4 切题状态机

- [x] 新增 `pendingNextQuestion` 状态。
- [x] 新增 `questionCardMode` 状态。
- [x] 新增 `stageLabel` 和 `stageStep` 状态。
- [x] 在 `result` 到达后不立即 `setCurrentQuestionId(next_question.id)`。
- [x] 评分完成后把下一题先放入 `pendingNextQuestion`。
- [x] 在题目卡片中展示 `进入下一题` 按钮。
- [x] 增加 `1000ms` 自动切题定时器。
- [x] 用户点击 `进入下一题` 时立即切题并清理定时器。
- [x] 自动切题和手动切题共用同一套状态流转方法。
- [x] 切题完成后恢复输入区可编辑状态。

### 2.5 SSE 阶段展示

- [x] 让 `stage` 事件更新顶部阶段条，而不是评价气泡正文。
- [x] 保持 `token` 事件继续写入 AI 评价气泡。
- [x] `result` 到达后固化评价文本。
- [x] 如果追问仍在生成且无原因字段，显示 `正在生成`。

### 2.6 抽屉改造

- [x] 把 `StatusPanel` 内容迁移到 `当前进展` tab。
- [x] 把 `QueuePanel` 内容迁移到 `题目` tab。
- [x] 把 `RetrospectPanel` 内容迁移到 `复盘` tab。
- [x] 抽屉默认关闭。
- [x] 点击 `面试面板` 按钮打开抽屉。
- [x] 默认 tab 设置为 `当前进展`。
- [x] 移动端采用半屏覆盖样式。

### 2.7 完成态报告页

- [x] 当题目全部完成时，切换到 `InterviewCompletionReport`。
- [x] 完成态隐藏当前题卡片、聊天区、输入区。
- [x] 总结页展示现有后端字段和已有右侧指标。
- [x] 完成态展示 `生成复盘` 按钮。
- [x] 完成态展示 `结束面试` 按钮。
- [x] 不保留返回历史聊天的主入口。

### 2.8 文案收口

- [x] `Live Transcript` 改为中文产品文案。
- [x] `证据命中` 改为 `资料佐证`。
- [x] `刷新队列` 改为 `同步题目状态`，并下沉到抽屉内。
- [x] `source llm`、`medium` 等内部字段改为中文化标签。
- [x] 输入区提示改为更接近真实面试回答引导。

### 2.9 开发隔离

- [x] `DebugPanel` 默认不在普通用户视图出现。
- [x] 仅开发模式保留调试信息可见能力。

## 3. P1 任务清单

### 3.1 过渡体验

- [x] 给题目卡片切换增加轻位移动画。
- [x] 给 `进入下一题` 过渡态增加更明确的视觉反馈。
- [x] 优化自动切题和手动切题之间的视觉衔接。

### 3.2 焦点与滚动

- [x] 切题后自动聚焦输入框。
- [x] 切题后视图自动回到题目区附近。
- [x] 避免用户停留在上一轮 AI 评价的滚动位置。

### 3.3 阶段感增强

- [x] 将单行阶段文案升级为更稳定的阶段展示。
- [x] 明确区分：
  - `正在接收回答`
  - `正在检索资料`
  - `正在生成评分`
  - `正在判断是否追问`

### 3.4 移动端优化

- [x] 优化抽屉的半屏高度和内容滚动。
- [x] 优化移动端固定题目区与固定输入区的可用空间。
- [x] 检查移动端键盘弹起时的布局稳定性。

## 4. P2 任务清单

### 4.1 字段产品化

- [ ] 后端补充 `follow_up_reason` 后接入原因映射。
- [ ] 后端补充 `retrieval_strategy_label` 后去掉前端硬编码映射。
- [ ] 后端补充 `session_stage_label` 后统一替换本地阶段映射。

### 4.2 复盘体验增强

- [x] 优化总结页和复盘结果的视觉衔接。
- [x] 把 `复盘` 从字段堆叠升级为更行动导向的结构。
- [x] 统一完成态报告页与抽屉 `复盘` tab 的表达。

### 4.3 交互扩展

- [ ] 评估是否开放 `要求澄清题意`。
- [ ] 评估是否开放 `跳过此题`。
- [ ] 评估是否开放 `追问面试官`。
- [ ] 评估是否支持题目详情展开。

## 5. 状态改造清单

这些状态建议直接列为实现任务，避免做到一半继续把逻辑塞回旧状态里。

- [x] 新增 `pendingNextQuestion: InterviewQuestion | null`
- [x] 新增 `questionCardMode: "active" | "transition" | "completed"`
- [x] 新增 `stageStep`
- [x] 新增 `stageLabel`
- [x] 新增 `isPanelOpen`
- [x] 新增 `panelTab`
- [x] 新增 `showCompletionReport`
- [x] 新增自动切题 timer ref
- [x] 清理旧的“题目写入聊天流”依赖状态

## 6. 需要重点检查的旧逻辑

- [x] `loadQuestionQueue()` 是否会覆盖本地 `pendingNextQuestion`
- [x] `interviewCompleted` 判断是否需要纳入过渡态条件
- [x] `Composer` 的禁用逻辑是否覆盖：
  - `submittingTurn`
  - `transition`
  - `completed`
- [x] `result` 到达后是否仍有重复题目展示
- [x] 抽屉打开关闭时是否影响主区域宽度和滚动

## 7. 验收任务清单

### 7.1 进行中态

- [ ] 进入页面后 3 秒内可识别当前题、当前进度、主操作。
- [ ] 顶部题目卡片始终固定可见。
- [ ] 聊天区独立滚动，不卡住输入区。
- [ ] 用户提交回答后，页面持续展示“系统正在处理”。

### 7.2 切题态

- [ ] 评分完成后不再立刻把下一题塞进聊天流。
- [ ] 评分完成后卡片内出现 `进入下一题`。
- [ ] 用户不操作时，约 `1000ms` 自动切题。
- [ ] 自动切题和手动切题结果一致。
- [ ] 切题后输入区恢复并可直接继续作答。

### 7.3 抽屉态

- [ ] 抽屉默认关闭。
- [ ] 打开后默认是 `当前进展` tab。
- [ ] `题目` tab 能清晰区分当前题、已完成题、追问题。
- [ ] `复盘` tab 未生成时显示空态，生成后显示内容。

### 7.4 完成态

- [ ] 全部题目完成后，页面切换为总结报告页。
- [ ] 总结页只保留 `生成复盘 / 结束面试` 主动作。
- [ ] 点击 `生成复盘` 后可在同页更新结果。
- [ ] 不再保留历史聊天作为主视图。

### 7.5 开发约束

- [ ] 不改接口契约。
- [ ] 不破坏现有 SSE 流式链路。
- [ ] 不破坏现有题目队列同步逻辑。
- [ ] 调试信息默认不出现在普通用户视图。

## 8. 推荐开发顺序

1. 先重构状态机和题目卡片，不先动抽屉细节。
2. 再移除题目写入聊天流的旧逻辑。
3. 再做抽屉替代右栏。
4. 最后做完成态报告页。
5. P0 稳定后，再补动画、焦点和移动端细节。
