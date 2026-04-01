# Next.js 页面结构规范

## 核心原则

`page.tsx` 默认是 Server Component，不要加 `"use client"`。把交互逻辑下沉到子组件。

```
app/experience/[id]/
  page.tsx              ← Server Component: 数据获取、metadata、布局
  _components/
    DetailClient.tsx    ← "use client": 交互状态、浏览器 API、事件处理
```

---

## Server / Client 边界

### 放在 Server Component（page.tsx）

- 路由参数解析（params, searchParams）
- 数据获取（fetch / db query）
- metadata 导出（SEO title, description）
- 静态布局结构
- 权限校验（服务端 auth）

### 放在 Client Component（子组件）

- `useState` / `useEffect` / `useRef` 等 hooks
- 事件处理（onClick, onChange, onSubmit）
- 浏览器 API（localStorage, window, navigator）
- Context 消费（useRuntimeConfig, useAuthState）
- 动画、拖拽等交互行为

### 判断标准

问自己：这段逻辑需要浏览器才能跑吗？

- 需要 → Client Component
- 不需要 → 留在 Server Component

---

## 渲染策略选择

### SSG（静态生成）— 构建时生成 HTML

适用条件：
- 内容公开，不依赖用户身份
- 数据变化频率低（天级别以上）
- 可以枚举所有页面路径

```tsx
// app/experience/[id]/page.tsx
export async function generateStaticParams() {
  const res = await fetch(`${API_BASE}/v1/experiences?limit=500`)
  const { items } = await res.json()
  return items.map((item: { id: string }) => ({ id: item.id }))
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await fetch(`${API_BASE}/v1/experiences/${id}`)
  const { item } = await res.json()
  return <DetailClient item={item} id={id} />
}
```

项目中适合 SSG 的页面：
- `/experience/[id]` — 面经详情，公开内容，写入后基本不变

### SSR（服务端渲染）— 每次请求时生成

适用条件：
- 内容依赖请求上下文（用户身份、cookie、header）
- 数据实时性要求高
- 无法枚举所有路径

```tsx
// 强制 SSR
export const dynamic = 'force-dynamic'
```

项目中适合 SSR 的页面：
- `/interview/session` — 已经是 SSR，依赖 searchParams

### CSR（客户端渲染）— 浏览器端获取数据

适用条件：
- 页面高度交互（表单、实时筛选、流式响应）
- 数据完全依赖客户端状态（localStorage 配置、用户操作）
- 首屏内容不重要（登录后的工具页面）

项目中适合 CSR 的页面：
- `/interview` — 面试准备页，重交互，依赖多个客户端状态
- `/resume` — 文件上传 + 表单操作
- `/bank` — 筛选 + 标记操作
- `/practice` — 实时问答交互

### 混合模式 — 推荐的默认方式

大多数页面应该是混合模式：Server Component 外壳 + Client Component 交互区。

```tsx
// page.tsx — Server Component
import { ClientSection } from './_components/ClientSection'

export default async function Page() {
  const data = await fetchSomeData()  // 服务端获取
  return (
    <PageShell>
      <h1>静态标题</h1>           {/* 服务端渲染 */}
      <ClientSection data={data} /> {/* 客户端交互 */}
    </PageShell>
  )
}
```

---

## 数据获取模式

### 服务端获取（优先）

```tsx
// page.tsx 内直接 fetch，Next.js 自动处理缓存
const res = await fetch(`${process.env.API_BASE}/v1/experiences/${id}`)
```

前提：API 地址通过环境变量 `API_BASE` 注入，不依赖 localStorage。

### 客户端获取

```tsx
// _components/SomeClient.tsx
"use client"
const { apiBase } = useRuntimeConfig()
useEffect(() => { apiRequest(apiBase, '/v1/...') }, [])
```

当数据获取依赖浏览器状态（localStorage 中的 apiBase、用户交互触发）时使用。

### 当前项目的特殊情况

`apiBase` 存在 localStorage 里，这导致所有数据获取被锁定在客户端。如果要启用 SSG/SSR：
- 固定场景：用 `process.env.API_BASE` 环境变量
- 动态场景：保持 `useRuntimeConfig()` 客户端获取

---

## 文件组织

```
app/
  experience/
    page.tsx                    ← Server Component 入口
    [id]/
      page.tsx                  ← Server Component 入口
      _components/
        DetailClient.tsx        ← "use client" 交互组件
    _components/                ← 该路由段的共享组件
      ExperienceList.tsx
      ExperienceSearchBar.tsx
    _hooks/                     ← 该路由段的自定义 hooks
      use-experience-list.ts
    _lib/                       ← 该路由段的类型和工具函数
      experience.types.ts
```

命名规则：
- `page.tsx` — 路由入口，尽量保持 Server Component
- `_components/` — 下划线前缀，Next.js 不会当作路由段
- `_hooks/` — 客户端 hooks
- `_lib/` — 类型定义、工具函数
- Client 组件文件名体现其职责，如 `DetailClient.tsx`、`FilterPanel.tsx`

---

## 常见反模式

### 1. page.tsx 直接标 "use client"

```tsx
// 错误 — 整页变 CSR
"use client"
export default function Page() {
  const { apiBase } = useRuntimeConfig()
  const [data, setData] = useState(null)
  useEffect(() => { fetch(...) }, [])
  return <div>{data}</div>
}
```

```tsx
// 正确 — 分层
// page.tsx (Server Component)
export default async function Page() {
  const data = await fetchData()
  return <ClientView initialData={data} />
}
```

### 2. 把所有逻辑堆在一个组件

数据获取、认证判断、交互状态、渲染逻辑全在一个文件 — 拆开。

### 3. 不必要的 "use client" 传染

父组件标了 `"use client"`，所有子组件自动变成客户端组件。把 `"use client"` 边界尽量往叶子节点推。
