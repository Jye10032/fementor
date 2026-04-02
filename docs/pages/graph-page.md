# 知识图谱页

- 版本：v1.0
- 日期：2026-04-02
- 路径：`/graph`
- 对应文件：
  - 前端：`apps/web/app/graph/page.tsx`
  - 后端：`apps/api/src/experience/knowledge-graph.js`
  - 骨架数据：`apps/api/data/knowledge-graph-skeleton.json`

## 1. 图谱构建流程

图谱由三步构建，结果存在后端内存变量 `globalGraph` 中：

### 1.1 加载静态骨架

从 `knowledge-graph-skeleton.json` 读取预定义的分类树，包含：

- 一级分类（JavaScript、React、Vue 等）
- 二级知识点的父子关系
- 手动标注的 related 关联边

### 1.2 计算共现权重

`buildCooccurrenceFromStore` 遍历数据库中所有面经帖子，提取每组问答的知识点标签，两两配对计算共现次数。

共现权重含义：两个知识点在同一组面试问答里一起出现的次数。权重越高说明在真实面试中关联越紧密。

### 1.3 合并与推断

1. `mergeSkeletonWithCooccurrence`：将骨架和共现数据合并。骨架已有节点补充共现权重，共现中出现的新节点也会被创建。
2. `inferOrphanParents`：对合并后仍无 parent 的孤儿节点，按三级策略挂靠：
   - 查骨架子节点表直接匹配
   - 通过 `normalizeKnowledgePoint` 做文本归一化后再匹配（去空格/连字符/转小写）
   - 按最高共现权重的邻居的 parent 推断

父子关系主要来自骨架，共现数据贡献的是 related 边（横向关联）。

## 2. 调用时机

- 服务启动：调用 `buildKnowledgeGraph(store)` 全量构建一次
- 新面经入库：调用 `updateGraphIncremental(groups)` 增量追加共现关系到内存
- 前端请求：`GET /v1/knowledge-graph` 返回内存中的 `globalGraph`

## 3. 知识点扩展

`expandWithGraph` 用于面试出题。根据用户简历中的知识点，沿图谱共现边扩展关联知识点加入候选题池。

参数：

- `maxDepth`：扩展跳数
- `maxPerNode`：每个节点最多扩展的邻居数
- `minWeight`：过滤共现权重低于此值的弱关联

## 4. 前端渲染

### 4.1 分类配色

- `PINNED_COLORS`：已知一级分类的固定配色，保证颜色稳定
- `EXTRA_PALETTE`：新增一级分类按名称排序后从备用调色板分配
- `buildCategoryColors`：从图谱数据中提取无 parent 的节点作为一级分类，构建完整的分类→颜色映射

### 4.2 D3 力导向图渲染步骤

`renderGraph` 函数按以下步骤渲染：

1. 清空容器，获取画布尺寸
2. 创建 SVG 画布和 g 容器（用于整体缩放/平移）
3. 绑定缩放行为（0.2x ~ 4x）
4. 初始化力模拟：link 弹簧力、charge 斥力、center 居中、collision 碰撞检测
5. 绘制连线：父子关系实线，共现关联虚线
6. 绘制节点圆形：半径/透明度按层级递减，颜色按分类着色，支持拖拽
7. 绘制文字标签：显示在节点上方
8. 创建悬浮提示框（tooltip）
9. 节点 hover 交互：高亮描边 + 显示关联信息
10. 点击高亮：只显示被点击节点及其直接相连节点，其余淡化
11. tick 回调：每帧更新连线端点、节点位置、标签位置

### 4.3 知识点归一化

`normalizeKnowledgePoint` 将 LLM 提取的碎片化标签归一化到骨架中的标准知识点名称，避免同一概念产生多个节点。流程：

1. `normalizeText` 做格式清洗（去空格、去连字符、转小写），与骨架词表精确匹配
2. `fuzzyMatchSkeleton` 兜底，对未命中的标签做子串匹配，尝试关联到骨架中已有的知识点
3. 都未命中则保留原文

#### 历史：SYNONYMS 同义词表

早期版本使用硬编码的 `SYNONYMS` 映射表做归一化（如 "防抖与节流" → "防抖节流"、"let与const" → "变量声明"），将 LLM 提取出的各种表述变体手动映射到标准知识点名称。

去除原因：同义词表需要人工维护，每次 LLM 提取出新的表述变体都要手动添加映射，无法自动适应。改为基于骨架词表的文本归一化 + 子串模糊匹配后，只要骨架中定义了标准知识点名称，格式变体（空格、连字符、大小写差异）和包含关系都能自动处理，不再需要逐条维护映射。
