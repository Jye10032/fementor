# FEMentor

FEMentor 是一个面向前端求职场景的 AI 面试训练系统。围绕「简历解析 → 岗位理解 → 模拟面试 → 题库沉淀」构建完整训练闭环，支持 SSE 流式输出与检索增强评分。

## 进度

- [x] 简历上传与 LLM 结构化摘要
- [x] JD 上传与岗位理解
- [x] 模拟面试（逐轮出题、SSE 流式输出、追问）
- [x] 面试会话历史记录
- [x] 项目经历库管理与面试上下文检索
- [x] 前端运行时 LLM 配置同步
- [x] 本地模式 / 云端模式双运行态
- [ ] 检索增强评分（Sirchmunk 证据链路接入评分流程）
- [ ] 薄弱项追踪与针对性推题
- [ ] 公共题源同步与题库沉淀
- [ ] 练习模式完善

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 15 · React 18 · Tailwind CSS 4 · TypeScript |
| 后端 | Node.js · Fastify |
| 数据库 | PostgreSQL（推荐本地与云端统一） / SQLite（兼容旧本地模式） |
| 认证 | Clerk |
| 检索 | Sirchmunk（本地检索引擎） |
| 文档解析 | pdf-parse · Mammoth · 火山引擎 OCR |
| LLM | OpenAI 兼容接口 · SSE 流式输出 |

## 项目结构

```
fementor/
├── apps/
│   ├── api/          # 后端 API 服务
│   │   ├── src/
│   │   │   ├── routes/           # 路由层
│   │   │   ├── interview/        # 面试上下文、出题、评分
│   │   │   ├── experience/       # 项目经历同步与检索
│   │   │   ├── question-bank/    # 题库管理
│   │   │   ├── retrieval/        # 检索适配层
│   │   │   └── db/               # 数据库初始化与迁移
│   │   └── scripts/              # 工具脚本
│   └── web/          # Next.js 前端
│       ├── app/
│       │   ├── resume/           # 简历解析
│       │   ├── interview/        # 模拟面试
│       │   ├── experience/       # 项目经历库
│       │   ├── bank/             # 题库
│       │   └── practice/         # 刷题练习
│       ├── components/           # 公共组件
│       └── lib/                  # 工具函数
├── data/             # 本地数据（SQLite、用户文档、记忆）
├── docs/             # 需求、架构、API 文档
└── scripts/          # 根级工具脚本
```

## 产品说明

FEMentor 解决的核心问题是：前端候选人缺少一个能「理解自己背景」的练习环境。市面上的面试题库是通用的，但真实面试官会根据你的简历和目标岗位来提问。FEMentor 把你的简历、JD、项目经历串联起来，生成贴合个人背景的面试训练流程。

### 训练闭环

```
简历 / JD 上传  →  岗位画像生成  →  模拟面试（逐轮出题）  →  评分与追问  →  薄弱项沉淀  →  针对性练习
       ↑                                                                              |
       └──────────────────────── 项目经历补充 · 题库积累 ────────────────────────────────┘
```

### 简历 / JD 管理

上传 PDF 或 DOCX 格式的简历，系统自动提取正文并通过 LLM 生成结构化摘要，包括技术栈、项目经验、工作年限等关键维度。同时支持上传目标岗位的 JD，生成岗位理解摘要。简历与 JD 的解析结果会作为后续面试出题和评分的基础上下文。

### 模拟面试

基于已解析的简历和 JD，系统通过关键词队列驱动面试流程，逐题召回与生成，模拟真实面试官的提问节奏。

#### 面试流程

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

#### 知识分类体系

面经库和知识图谱采用三层分类，关键词队列对齐 Level 2（子话题）粒度：

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

每轮回答后实时给出评分与反馈，并根据回答质量决定是否追问。整个过程通过 SSE 流式输出，面试体验接近实时对话。支持查看历史面试会话，对比不同场次的表现。

### 项目经历库

独立管理你的项目经历条目。面试过程中，系统会自动检索与当前问题相关的项目经历，作为出题和评分的补充上下文，让追问更贴近你的实际工作内容。

### 题库与练习

维护个人题库，支持从公共题源（如牛客等）远程同步题目。系统根据历史评分追踪薄弱知识点，在练习模式中优先推送你尚未掌握的题目，形成有针对性的刷题路径。

#### 牛客面经爬取

系统内置牛客网面经爬虫，可从牛客讨论区批量抓取前端面经帖，提取面试题目并入库。

**CLI 调用：**

```bash
npm run crawl:niuke -- --keyword "前端 面经" --pages 3 --max-items 30
```

| 参数 | 说明 | 默认值 |
|---|---|---|
| `--keyword` | 搜索关键词 | `前端 面经` |
| `--pages` | 爬取列表页数 | 3（上限 100） |
| `--max-items` | 最大抓取文章数 | 30（上限 500） |
| `--delay-ms` | 请求间隔（ms） | 1200 |
| `--timeout-ms` | 单次请求超时 | 15000 |
| `--article-url` | 直接指定文章 URL（可多次使用） | — |
| `--output` | 输出 JSON 路径 | `data/crawled/niuke-experiences.json` |
| `--verbose` | 详细日志 | false |

**爬取流程：**

1. **列表发现** — 尝试多种牛客搜索 URL 模式（`/search`、`/discuss`），提取文章链接并去重
2. **正文提取** — 对每篇文章解析标题、作者、发布时间、正文内容和标签。正文优先取 `.feed-content-text` 等结构化节点，其次尝试页面内嵌 JSON，兜底取最大文本块
3. **相关性评分** — 对关键词分词后在标题（3x）、摘要（2x）、正文（1x）、标签中加权匹配，过滤无关文章
4. **输出** — 生成结构化 JSON，包含文章元信息、正文、相关性评分和爬取统计

**面经入库流程：**

爬取结果通过经历同步任务（`POST /v1/experience-sync/jobs`）进入数据库：

```
爬取 JSON → 按日期过滤 → 去重（source_platform + source_post_id）
         → LLM 清洗（提取公司、岗位、面试阶段、题目分组）
         → 写入 experience_post / experience_question_group / experience_question_item
```

清洗阶段会对面经原文做结构化拆解：识别公司名称和岗位、划分面试阶段（一面/二面/HR 面等）、按知识领域对题目分组，并对内容质量评分。

#### 三层题库架构

题目从爬取到用户练习经过三层流转：

```
question_source（公共题源层）
    ↓  用户收录
user_question_bank（个人题库层，含复习状态和掌握度）
    ↓  练习作答
question_attempt（练习记录层，含评分和间隔复习调度）
```

- **公共题源**（`question_source`）：存放从牛客爬取或远程同步的题目，按 `(source_type, source_ref_id)` 去重，支持相同题目合并
- **个人题库**（`user_question_bank`）：用户从公共题源收录题目后生成，追踪复习状态（`review_status`）、掌握度（`mastery_level` 0-100）、下次复习时间（`next_review_at`），支持收藏标记
- **练习记录**（`question_attempt`）：每次作答记录答案、评分、优缺点和证据引用，作答后自动更新间隔复习调度

#### 远程题源同步

除本地爬取外，支持从远程 API 增量同步公共题源：

```bash
# 环境变量配置
PUBLIC_SOURCE_REMOTE_BASE_URL=https://your-source-server.com
PUBLIC_SOURCE_REMOTE_API_KEY=your-api-key
```

| 接口 | 说明 |
|---|---|
| `GET /v1/public-question-sources/local-status` | 查看本地同步状态 |
| `POST /v1/public-question-sources/check-update` | 检查远程是否有更新 |
| `POST /v1/public-question-sources/sync` | 触发增量同步 |

同步机制基于 `last_server_time` 做增量拉取，每次仅获取上次同步之后变更的题目，避免全量重复同步。

### 检索增强评分

回答评分不只依赖 LLM 的通用判断。系统通过本地检索引擎（Sirchmunk）在你的文档和项目经历中查找相关证据，辅助评分和生成追问，减少 LLM 幻觉对评分准确性的影响。

## 快速启动

### 本地 PostgreSQL（推荐）

```bash
cp apps/api/.env.example apps/api/.env
npm install
npm run db:up
npm run db:migrate
npm run db:seed:dev
npm run dev
```

#### 数据库命令

```bash
# 启动本地 Docker Postgres
npm run db:up

# 查看 migration 状态
npm run db:migrate:status

# 执行 migration
npm run db:migrate

# 写入开发示例数据
npm run db:seed:dev
```

### `migration` / `seed` / `init` 分工

- `migration`
  负责数据库结构版本管理。当前 SQL 文件位于 [`apps/api/migrations`](/Users/user/vscode/fementor/apps/api/migrations)，通过 [`apps/api/scripts/migrate.js`](/Users/user/vscode/fementor/apps/api/scripts/migrate.js) 顺序执行，并记录到 `schema_migrations`。
- `seed`
  负责写入开发环境示例数据。当前脚本是 [`apps/api/scripts/seed-dev.js`](/Users/user/vscode/fementor/apps/api/scripts/seed-dev.js)，默认写入几条 `question_source` 示例题目。
- `init`
  负责应用启动时的兜底自举。当前仍保留 [`apps/api/src/postgres.js`](/Users/user/vscode/fementor/apps/api/src/postgres.js) 里的 `initPostgres()`，避免旧环境尚未跑 migration 时直接启动失败。

脚本和运行时都会优先读取 `DATABASE_URL`，没有时回退到历史变量 `SUPABASE`。

推荐用法是：

1. 本地和部署前先跑 `migration`
2. 开发环境需要样例题时再跑 `seed`
3. `init` 只保留为过渡期兜底，不作为长期 schema 管理方案

### 环境要求

- Node.js >= 18
- npm
- Docker Desktop（推荐，用于本地 PostgreSQL）

### 安装与运行

```bash
npm install
npm run db:up
npm run dev
```

默认同时启动：

- API：`http://localhost:3300`
- Web：`http://localhost:3000`

单独启动：

```bash
npm run dev:api
npm run dev:web
```

### 环境变量

复制 `apps/api/.env.example` 为 `apps/api/.env`，按需配置：

```bash
cp apps/api/.env.example apps/api/.env
```

如果你希望本地直接统一走 PostgreSQL，建议额外确认这几个值：

```bash
DATABASE_URL=postgresql://fementor:fementor@localhost:55432/fementor
APP_RUNTIME_MODE=local
PUBLIC_SOURCE_DRIVER=postgres
```

常用数据库命令：

```bash
npm run db:up
npm run db:logs
npm run db:down
```

**必须配置（LLM 相关功能）：**

| 变量 | 说明 | 默认值 |
|---|---|---|
| `OPENAI_API_KEY` | LLM API Key | — |
| `OPENAI_BASE_URL` | LLM 接口地址 | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名称 | `gpt-4o-mini` |

**可选配置：**

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串（不配置则使用本地 SQLite） |
| `CLERK_SECRET_KEY` / `CLERK_JWT_KEY` | Clerk 认证（不配置则使用本地模式） |
| `VOLC_ACCESSKEY` / `VOLC_SECRETKEY` | 火山引擎 OCR（简历 PDF 解析） |
| `SIRCHMUNK_BIN` / `SIRCHMUNK_MODE` | Sirchmunk 检索引擎 |
| `PUBLIC_SOURCE_REMOTE_BASE_URL` | 公共题源远程同步地址 |

### 运行模式

- **本地模式**（默认）：`APP_RUNTIME_MODE=local`，推荐连接本地 Docker PostgreSQL；也兼容旧 SQLite 模式
- **云端模式**：`APP_RUNTIME_MODE=cloud`，PostgreSQL + Clerk 认证

## 主要 API 路由

| 路径 | 说明 |
|---|---|
| `GET /health` | 健康检查（含 LLM / Sirchmunk 状态） |
| `POST /v1/resume/parse` | 简历解析 |
| `POST /v1/jd/upload` | JD 上传 |
| `POST /v1/interview/sessions/start` | 开始面试会话 |
| `POST /v1/retrieval/search` | 统一检索 |
| `POST /v1/scoring/evaluate` | 答题评分 |
| `GET /v1/question-bank` | 题库查询 |
| `GET /v1/experiences` | 项目经历列表 |
| `POST /v1/experience-sync/jobs` | 触发牛客面经爬取与入库 |
| `POST /v1/question-sources/promote` | 将题目提升至公共题源 |
| `POST /v1/user-question-bank` | 收录题目到个人题库 |
| `GET /v1/user-question-bank` | 查询个人题库 |
| `GET /v1/practice/next` | 获取下一道待复习题目 |
| `POST /v1/question-attempts` | 提交练习作答记录 |
| `POST /v1/public-question-sources/sync` | 远程题源增量同步 |
| `POST /v1/runtime/llm-config` | 前端同步 LLM 配置 |

## 数据库表

| 表 | 用途 |
|---|---|
| `user_profile` | 用户信息、简历/JD 摘要 |
| `interview_session` / `interview_turn` / `interview_question` | 面试会话、轮次、题目队列 |
| `attempt` | 练习记录 |
| `score_report` | 评分报告 |
| `weakness_tag` | 薄弱项标签 |
| `question_bank` | 个人题库（旧版） |
| `question_source` | 公共题源（牛客爬取 / 远程同步） |
| `user_question_bank` | 个人题库（新版，含掌握度和复习调度） |
| `question_attempt` | 练习作答记录 |
| `public_source_sync_state` | 远程题源同步状态 |
| `experience_sync_job` | 面经爬取同步任务 |
| `experience_post` / `experience_question_group` / `experience_question_item` | 面经帖 / 题目分组 / 题目条目 |
| `evidence_ref` | 证据引用 |

## 页面入口

| 路径 | 说明 |
|---|---|
| `/` | 首页总览 |
| `/resume` | 简历解析与管理 |
| `/interview` | 模拟面试 |
| `/experience` | 项目经历库 |
| `/bank` | 题库 |
| `/practice` | 刷题练习 |

## License

Private
