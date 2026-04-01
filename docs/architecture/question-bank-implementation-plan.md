# 题库三层模型实施方案

- 版本：v0.1
- 日期：2026-03-27
- 状态：待实现

## 1. 目标

把现有偏单表的 `question_bank`，平滑演进为：

1. `question_source`
2. `user_question_bank`
3. `question_attempt`

本方案只定义实现边界、SQL 结构、repository 接口和迁移步骤，不直接改现有业务逻辑。

## 2. 设计原则

1. 上层业务统一用“三层模型”语义，不直接感知 SQLite / PostgreSQL 差异。
2. 线上和本地共享同一套 repository 接口。
3. 短期保留 `question_bank` 读路径，避免一次性重写练习页。
4. 新题目优先进入 `question_source`，不再直接跳过公共题源写入用户题库。
5. 用户行为数据只写 `question_attempt`，不反向污染公共题定义。

## 3. 表结构草案

## 3.1 `question_source`

用途：公共题源层，表示系统识别出来的公共题目定义。

### 推荐字段

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text/uuid | 主键 |
| source_type | text | `experience/interview/resume/jd/manual/practice` |
| source_ref_id | text | 原始来源对象 ID |
| canonical_question | text | 规范题干 |
| question_text | text | 展示题干 |
| normalized_question | text | 用于归一化和检索的标准文本 |
| category | text | `javascript/react/vue/css/browser/network/project/behavioral/...` |
| difficulty | text | `easy/medium/hard` |
| track | text | 如 `frontend/backend/fullstack` |
| chapter | text | 如 `javascript/react/project` |
| knowledge_points_json | text/jsonb | 知识点数组 |
| expected_points_json | text/jsonb | 预期考点数组 |
| metadata_json | text/jsonb | 来源附加信息 |
| status | text | `active/merged/archived` |
| merged_into_source_id | text nullable | 归并目标 |
| created_at | text/timestamptz | 创建时间 |
| updated_at | text/timestamptz | 更新时间 |

### 唯一约束建议

1. `source_type + source_ref_id`
2. `canonical_question + track + chapter`

### SQL 草案

```sql
CREATE TABLE question_source (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_ref_id TEXT NOT NULL,
  canonical_question TEXT NOT NULL,
  question_text TEXT NOT NULL,
  normalized_question TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'medium',
  track TEXT NOT NULL DEFAULT '',
  chapter TEXT NOT NULL DEFAULT '',
  knowledge_points_json TEXT NOT NULL DEFAULT '[]',
  expected_points_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  merged_into_source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_question_source_source_ref
ON question_source(source_type, source_ref_id);

CREATE INDEX idx_question_source_track_chapter
ON question_source(track, chapter, updated_at DESC);
```

## 3.2 `user_question_bank`

用途：用户题库层，表示用户和公共题源之间的关系。

### 推荐字段

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text/uuid | 主键 |
| user_id | text/uuid | 用户 ID，本地可为 `local_dev_user` |
| question_source_id | text/uuid | 公共题源 ID |
| track | text | 用户题单所属 track |
| chapter | text | 用户题单所属 chapter |
| custom_question_text | text | 用户覆盖后的展示题干 |
| review_status | text | `pending/reviewing/done/archived` |
| mastery_level | integer | 0-5 |
| weakness_tag | text | 薄弱项标签 |
| next_review_at | text/timestamptz nullable | 下次复习时间 |
| last_practiced_at | text/timestamptz nullable | 最近练习时间 |
| is_favorited | integer/boolean | 是否收藏 |
| source_channel | text | `experience/interview/manual/recommendation` |
| created_at | text/timestamptz | 创建时间 |
| updated_at | text/timestamptz | 更新时间 |

### 唯一约束建议

1. `user_id + question_source_id`

### SQL 草案

```sql
CREATE TABLE user_question_bank (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  question_source_id TEXT NOT NULL,
  track TEXT NOT NULL DEFAULT '',
  chapter TEXT NOT NULL DEFAULT '',
  custom_question_text TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'pending',
  mastery_level INTEGER NOT NULL DEFAULT 0,
  weakness_tag TEXT NOT NULL DEFAULT '',
  next_review_at TEXT,
  last_practiced_at TEXT,
  is_favorited INTEGER NOT NULL DEFAULT 0,
  source_channel TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_user_question_bank_user_source
ON user_question_bank(user_id, question_source_id);

CREATE INDEX idx_user_question_bank_user_chapter
ON user_question_bank(user_id, chapter, updated_at DESC);
```

## 3.3 `question_attempt`

用途：练习记录层，表示用户每次围绕题库题目的作答行为。

### 推荐字段

| 字段 | 类型 | 说明 |
|---|---|---|
| id | text/uuid | 主键 |
| user_id | text/uuid | 用户 ID |
| user_question_bank_id | text/uuid | 用户题库 ID |
| session_type | text | `practice/interview/review` |
| session_id | text nullable | 可关联面试会话或练习会话 |
| answer | text | 用户回答 |
| score | integer | 0-100 |
| strengths_json | text/jsonb | 优点数组 |
| weaknesses_json | text/jsonb | 缺点数组 |
| evidence_refs_json | text/jsonb | 证据引用数组 |
| feedback | text | 反馈 |
| mastered | integer/boolean | 本次是否掌握 |
| next_review_at | text/timestamptz nullable | 下次复习时间 |
| created_at | text/timestamptz | 创建时间 |

### SQL 草案

```sql
CREATE TABLE question_attempt (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_question_bank_id TEXT NOT NULL,
  session_type TEXT NOT NULL,
  session_id TEXT,
  answer TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  strengths_json TEXT NOT NULL DEFAULT '[]',
  weaknesses_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  feedback TEXT NOT NULL DEFAULT '',
  mastered INTEGER NOT NULL DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_question_attempt_user_bank_created
ON question_attempt(user_question_bank_id, created_at DESC);
```

## 4. Repository 接口

## 4.1 `questionSourceRepo`

### 需要的方法

1. `findById(id)`
2. `findBySourceRef(sourceType, sourceRefId)`
3. `findByCanonicalQuestion({ canonicalQuestion, track, chapter })`
4. `upsertFromSource(input)`
5. `mergeSources({ sourceId, targetSourceId })`
6. `listByIds(ids)`

### `upsertFromSource(input)` 输入建议

```ts
type UpsertQuestionSourceInput = {
  sourceType: string;
  sourceRefId: string;
  canonicalQuestion: string;
  questionText: string;
  normalizedQuestion?: string;
  category?: string;
  difficulty?: string;
  track?: string;
  chapter?: string;
  knowledgePoints?: string[];
  expectedPoints?: string[];
  metadata?: Record<string, unknown>;
};
```

## 4.2 `userQuestionBankRepo`

### 需要的方法

1. `findById(id)`
2. `findByUserAndSource({ userId, questionSourceId })`
3. `addToBank(input)`
4. `listByUser(input)`
5. `updateReviewState(input)`
6. `updateFavorite(input)`

### `addToBank(input)` 输入建议

```ts
type AddToUserQuestionBankInput = {
  userId: string;
  questionSourceId: string;
  track?: string;
  chapter?: string;
  customQuestionText?: string;
  sourceChannel?: string;
};
```

## 4.3 `questionAttemptRepo`

### 需要的方法

1. `createAttempt(input)`
2. `listByUserQuestionBankId(userQuestionBankId)`
3. `getLatestByUserQuestionBankId(userQuestionBankId)`
4. `summarizeMasteryByUserQuestionBankId(userQuestionBankId)`

### `createAttempt(input)` 输入建议

```ts
type CreateQuestionAttemptInput = {
  userId: string;
  userQuestionBankId: string;
  sessionType: 'practice' | 'interview' | 'review';
  sessionId?: string;
  answer: string;
  score: number;
  strengths?: string[];
  weaknesses?: string[];
  evidenceRefs?: Array<Record<string, unknown>>;
  feedback?: string;
  mastered?: boolean;
  nextReviewAt?: string | null;
};
```

## 5. 环境适配

## 5.1 本地模式

1. 用户上下文解析为固定 `local_dev_user`
2. repository 实现绑定 SQLite
3. 时间字段允许继续使用 ISO 文本
4. 先不引入复杂迁移框架

## 5.2 线上模式

1. 用户上下文解析为登录用户对应的 `users.id`
2. repository 实现绑定 PostgreSQL
3. 时间字段建议使用 `timestamptz`
4. 建议通过迁移脚本维护 schema

## 6. 从现有 `question_bank` 的迁移方案

## 6.1 迁移目标

把现有 `question_bank` 视为早期 `user_question_bank`，补出缺失的公共题源层和练习记录层。

## 6.2 推荐阶段

### Phase 1：补新表，不切旧读路径

1. 新增 `question_source`
2. 新增 `user_question_bank`
3. 新增 `question_attempt`
4. 保持现有 `question_bank` 和练习页继续工作

### Phase 2：双写

1. 面试复盘沉淀题目时：
   - 先写 `question_source`
   - 再写 `user_question_bank`
2. 继续兼容写 `question_bank`
3. 校验两边题量和主字段是否一致

### Phase 3：读切换

1. 练习页改读 `user_question_bank + question_source`
2. 题目详情优先展示 `custom_question_text || question_source.question_text`
3. 历史做题记录改读 `question_attempt`

### Phase 4：旧表收口

1. `question_bank` 只保留兼容只读或导出用途
2. 新业务不再直接写 `question_bank`

## 6.3 旧字段映射

| 旧表 `question_bank` | 新结构 | 说明 |
|---|---|---|
| `user_id` | `user_question_bank.user_id` | 直接映射 |
| `chapter` | `question_source.chapter` + `user_question_bank.chapter` | 公共语义和用户语义都保留 |
| `question` | `question_source.question_text` | 标准题干 |
| `difficulty` | `question_source.difficulty` | 题目定义字段 |
| `tags_json` | `question_source.knowledge_points_json` | 先做弱映射 |
| `weakness_tag` | `user_question_bank.weakness_tag` | 用户语义 |
| `next_review_at` | `user_question_bank.next_review_at` | 用户复习计划 |
| `review_status` | `user_question_bank.review_status` | 用户状态 |
| `source_question_id` | `question_source.source_ref_id` | 来源追溯 |
| `source_question_source` | `question_source.source_type` | 来源类型 |

## 7. API 影响面

## 7.1 可继续兼容的旧接口

1. `GET /v1/question-bank`
2. `GET /v1/practice/next`
3. `POST /v1/question-bank/:id/review`

短期可以内部继续读旧表或从新模型做兼容转换。

## 7.2 推荐新增接口

1. `POST /v1/question-sources/promote`
   - 用途：把面经题、面试题或手工题提升为公共题源
2. `POST /v1/user-question-bank`
   - 用途：把某公共题加入当前用户题库
3. `GET /v1/user-question-bank`
   - 用途：读取当前用户题库
4. `POST /v1/question-attempts`
   - 用途：记录一次练习行为

## 8. 验收检查

1. 同一道面经题可被两个不同用户加入各自题库。
2. 两个用户对同一道题的 `review_status/mastery_level/next_review_at` 互不影响。
3. 面试复盘沉淀的新题先能命中或创建 `question_source`。
4. 本地模式不登录也能完整走 `question_source -> user_question_bank -> question_attempt`。
5. 线上模式用户切换后，题库和练习记录严格隔离。
