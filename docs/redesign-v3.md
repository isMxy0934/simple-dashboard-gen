# 产品改造设计文档 v3

> 基于当前代码库的深度分析与讨论，记录下一阶段的核心改造方向。

---

## 一、核心设计原则

### AI 权限最高，人工是辅助快捷操作

AI 是所有结构性决策的主体，人工操作是便捷的子集：

- **AI 能做一切**：创建/修改/删除 view、query、binding、layout、title、description
- **人工直接操作**：是跳过 AI 对话的快捷方式，适用于低风险的视觉调整
- **AI 的批准结果**对相同范围有最终权威；人工的直接操作只影响 AI 不介入的部分

```
AI 通道（全量权限）              人工快捷通道（子集）
────────────────────────        ──────────────────────
创建 / 修改 / 删除 view          拖拽调整位置 / 大小
生成 / 修改 / 删除 query         内联编辑标题 / 描述
创建 / 修改 / 删除 binding       删除 view（需确认弹窗）
修改布局 / 标题 / 描述            ✗ 不能直接改 SQL
                                 ✗ 不能直接改 binding
```

---

## 二、Agent 设计改造

### 2.1 简化 Route 决策

**现状问题**：`workflow.ts` 用正则（`READ_ONLY_PATTERN`、`GENERIC_CREATE_PATTERN`）判断路由，在中英混合场景误判率高。`chat` route 返回硬编码文本，不走 LLM。

**改造方向**：

- 去掉 `chat` route：所有非 approval 请求直接进 agent loop
- 去掉 `read` / `write` 模式的正则切换：直接开放所有工具，让模型自己决定
- 保留 `approval` route：有 pending patch 时锁定，等待用户批准

```
简化后的路由逻辑：
  有 pending patch → approval 模式（只开 applyPatch）
  没有 pending patch → 直接进 ToolLoopAgent（全部工具）
```

### 2.2 补全工具集（当前缺失）

现在只有 `upsertView / upsertQuery / upsertBinding`，没有删除工具：

| 需新增工具 | 说明 |
|-----------|------|
| `deleteView` | 删除 view 及其关联 binding，需 Approval |
| `deleteQuery` | 删除 query，需 Approval |
| `deleteBinding` | 删除 binding，需 Approval |

### 2.3 Focused View 上下文注入（关键改造）

**现状问题**：`selectedViewId` 完全没有传给 AI。当用户点击某张图后再发消息，AI 不知道用户在聚焦哪个 view，需要先 `getViews → getView` 浪费步骤，还可能选错目标。

**改造方向**：每次发消息时，把 `focusedViewId` 注入 context：

```
Context:
  dashboard: { name, view_count, filter_count }
  focused_view: { id, title, status, has_binding }   ← 新增
  datasources: [...]
  checks: [...]

User request:
  把这个改成柱状图
```

AI 直接知道操作目标，不需要先探查。

### 2.4 Working Draft 跨请求持久化（核心改造）

**现状问题**：`WorkingDraftState` 只活在一次 HTTP 请求的内存里，请求结束即销毁。AI 必须在一次对话回合内完成 `upsertView → upsertQuery → upsertBinding → composePatch → applyPatch` 全链路，否则全部丢失。

**改造方向**：支持分阶段创作，staging 跨请求持久化。

#### 分阶段创作流程

```
阶段一：外观确认（低风险）
  用户: "帮我加一个 GMV 周趋势折线图"
  AI: upsertView（ECharts 模板 + mock 数据）
  → Approval #1（仅 view 结构，不涉及真实数据）
  → 用户批准 → 图出现在画布
  → AI 提示: "样式已创建，满意后说「接真实数据」"

  [用户可以直接拖拽调整位置，无需 Approval]

阶段二：数据接入（高风险）
  用户: "接真实数据"
  AI 已知 focused_view = { id: "v_gmv", title: "GMV 周趋势" }
  AI: upsertQuery + upsertBinding
  → Approval #2（涉及 query_defs + bindings，影响 SQL 执行）
  → 用户批准 → 真实数据加载
```

#### Staging 持久化方案

- 每次 `upsertView / upsertQuery / upsertBinding` 成功后，将 staged operations 写入 `dashboard_agent_tasks` 表（表已存在）
- 下次请求时，从任务表加载未 apply 的 staged state，作为 working draft 的起点
- `composePatch → applyPatch` 后清空 staged operations

### 2.5 Approval 粒度分级

| 变更类型 | Approval 级别 |
|---------|--------------|
| 新增/修改 `query_defs` + `bindings` | 必须显式批准（SQL 执行风险） |
| 新增/修改 `view` 结构（模板/slots） | 需批准 |
| 仅调整 `layout` / `title` / `description` | 低摩擦（快速确认，或可选自动批准） |
| 删除任何内容 | 必须显式批准（不可逆） |

---

## 三、数据源改造

### 3.1 管理页新增「数据源」Tab

**现状**：左侧导航只有 3 个 Tab：概览 / 创作 / 预览，没有数据源管理入口。数据源完全写死在代码里，用户无法在产品内配置。

**改造方向**：在管理页左侧导航加入第 4 个 Tab —— **数据源**。

#### 导航结构变更

```
当前：                     改后：
  概览                       概览
  创作                       创作
  预览                       预览
                           ─────────────── ← 分割线
                           数据源           ← 新增
```

代码层面：
- `ManagementSection` 类型增加 `"datasource"`
- `NAV_KEYS` 增加 `datasource: "management.nav.datasource"`
- 新增 `<DatasourceListPanel />` 组件，路由到 `section === "datasource"`

#### 数据源管理页设计

```
数据源                              [+ 添加数据源]
────────────────────────────────────────────────────
┌─────────────────────────────────────────────────────┐
│ Weekly Sales                          ● 已连接        │
│ PostgreSQL · localhost:5432/sales_db                 │
│ 12 张表 · 上次检测 3 分钟前          [测试连接] [编辑] │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Analytics DW                          ○ 未验证        │
│ PostgreSQL · analytics.internal:5432/dw              │
│ ─                                    [测试连接] [编辑] │
└─────────────────────────────────────────────────────┘
```

#### 添加/编辑数据源 Drawer

```
添加数据源
─────────────────────────────────────────────────
名称         [________________________]
说明         [________________________]
数据库类型   [PostgreSQL ▼]
连接字符串   [postgres://user:pass@host/db]
可见表        ○ 全部表  ● 指定白名单
              [orders, products, ...]
─────────────────────────────────────────────────
[测试连接]                   [取消]  [保存]
```

- **测试连接**：点击后实时调用 `/api/datasource/test` 验证连接，返回表数量
- **保存**：写入 `datasources` 表，AI 的 `getDatasources` 工具立即可见

### 3.2 数据源后端配置化

**现状问题**：`postgres-datasource.ts` 完全写死，`DEFAULT_DATASOURCE_ID = "ds_sales_weekly"`，不是该 ID 直接抛错。不改代码就无法接入新数据源。

**改造方向**：

- 数据源定义存入数据库（新增 `datasources` 表）或配置文件
- `listAvailableDatasourceDefinitions()` 从 DB 动态读取
- `loadDatasourceContext(datasourceId)` 支持任意已注册的 Postgres 连接
- 支持多数据源并存，agent 通过 `getDatasources` 动态发现

#### 数据源表结构

```sql
create table datasources (
  id            text primary key,
  label         text not null,
  description   text,
  dialect       text not null default 'postgres',
  connection_url text not null,
  allowed_tables jsonb,          -- null = 全部可见
  last_tested_at timestamptz,
  test_status    text,           -- 'ok' | 'error' | null
  created_at    timestamptz default now()
);
```

#### API 路由（新增）

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/datasources` | GET | 列出所有数据源 |
| `/api/datasources` | POST | 创建数据源 |
| `/api/datasources/[id]` | PUT | 更新数据源 |
| `/api/datasources/[id]` | DELETE | 删除数据源 |
| `/api/datasources/[id]/test` | POST | 测试连接，返回表列表 |

---

## 四、UI 改造

### 4.0 已通过代码确认的具体问题

| 文件 | 行号 | 问题 |
|------|------|------|
| `authoring-app.tsx:366` | — | `window.confirm()` 删除视图，需替换为 Modal |
| `viewer-chart.tsx` | chartMeta 区域 | 渲染了 `"ECharts renderer slots are injected from binding results."` 文本，用户可见 |
| `template-preview.tsx` | previewMeta 区域 | 渲染了 `"Template preview uses generated sample slot values."` 文本，用户可见 |
| `authoring-app.tsx:289` | — | `window.open` 预览，浏览器可能拦截弹窗 |
| `management-state.ts:17` | — | loading 文案 `"Loading authoring dashboards..."` 是英文硬编码，未接 i18n |
| `management-state.ts:26` | — | `"Loading viewer dashboards..."` 同上 |
| `authoring-app.tsx:104` | — | `onAppliedDashboard` 默认选中第一个 view，忽略 AI 实际操作的目标 view |
| `viewer-dashboard.tsx` | — | 整页无 i18n（上次分析已确认） |
| `authoring-editor-drawer.tsx` | — | 整个 Drawer 是 JSON 编辑器，开发工具而非产品功能 |

### 4.1 信息架构重设计

**现状问题**：

- EditorDrawer 暴露原始 JSON（`renderer.option_template JSON`、`Params JSON`）
- 画布状态徽章用系统内部语言（`No Binding`、`Bound`、`Mock`）
- `viewer-chart.tsx` 有开发注释出现在用户界面（代码已确认）
- 中英文混用，Viewer 完全没接 i18n
- AI 面板默认折叠成小胶囊，新用户发现不了

**改造方向**：

#### 页面布局

```
创作页
├── 顶栏
│   ├── 仪表盘名称（内联编辑）
│   ├── 状态标签："草稿 v3" 或 "已发布 v2"
│   ├── [Desktop / Mobile 切换]
│   └── [保存草稿]  [发布]
│
├── 画布（主区域，左侧）
│   ├── 卡片徽章（用户语言）：
│   │   "模拟数据" / "真实数据" / "数据异常" / "未配置"
│   ├── 选中时：蓝色边框 + 快捷操作（删除 / 编辑标题）
│   └── 空画布：引导语 "通过右侧 AI 助手创建第一个图表 →"
│
└── AI 面板（右侧，默认展开，常驻）
    ├── 当前焦点：[视图名称] 或 [整个仪表盘]
    ├── 焦点快速切换（点击其他 view 自动切换）
    ├── 对话流（含内联 Approval 卡片）
    └── 输入框
```

#### 状态徽章语言替换

| 当前（开发语言） | 改后（用户语言） |
|----------------|----------------|
| `Draft` | 未配置 |
| `No Binding` | 未配置 |
| `Mock` | 模拟数据 |
| `Bound` | 已绑定 |
| `Preview OK` | 真实数据 |
| `Error` | 数据异常 |
| `SQL + Binding` | 真实数据 |
| `Unbound` | 未配置 |

#### AI 面板焦点显示

```
┌────────────────────────────────┐
│ AI 助手              [关闭]    │
│ ────────────────────────────── │
│ 当前焦点：GMV 周趋势            │
│ ────────────────────────────── │
│ [对话内容...]                   │
│ ────────────────────────────── │
│ [输入框]               [发送]  │
└────────────────────────────────┘
```

#### Approval 卡片内联在对话流

```
AI: "好的，我已经生成了 GMV 周趋势的 SQL 查询..."

┌─────────────────────────────────────┐
│ 📊 数据补丁 · 1 个查询 + 1 个绑定    │
│ ─────────────────────────────────── │
│ + query: gmv_weekly_trend           │
│ + binding: v_gmv → gmv_weekly       │
│                                     │
│ [批准并应用]           [拒绝]        │
└─────────────────────────────────────┘
```

### 4.2 清理开发内容

| 位置 | 当前内容 | 改后 |
|------|---------|------|
| `viewer-chart.tsx:74` | `ECharts renderer slots are injected from binding results.` | 删除 |
| `template-preview.tsx:81` | `Template preview uses generated sample slot values.` | 删除 |
| `viewer-dashboard.tsx` | 硬编码中文字符串 | 接入 i18n |
| `authoring-canvas-panel.tsx` | `Edit`、`Delete`、`Preview is running...` | 接入 i18n |
| `authoring-editor-drawer.tsx` | 整个 drawer 是开发者工具 | 替换为用户友好配置面板 |

### 4.3 EditorDrawer 重设计

**现状**：暴露 `renderer.option_template JSON`、`Params JSON`、`Query Output JSON`，只有工程师能用。

**改后**：面向用户的配置面板，分三个 tab：

```
[外观]  [数据]  [筛选]

外观 tab：
  - 图表类型选择（折线图 / 柱状图 / 饼图 / KPI 卡片...）
  - 标题 / 描述编辑
  - 颜色主题（可选）

数据 tab：
  - 当前数据状态（模拟数据 / 真实数据 / 异常）
  - 绑定的查询名称（只读，AI 管理）
  - "让 AI 修改数据" 按钮 → 触发 AI 对话

筛选 tab：
  - 该 view 使用的过滤器列表（只读，AI 管理）
```

---

## 五、画布技术改造

### 5.1 拖拽性能优化

**现状问题**：每次 `pointermove` 都触发 `applyDashboardMutation` → 整个 React state 更新 → 所有 ECharts 实例 `resize()` → 卡顿。

**改造方向**：拖拽期间只用 CSS `transform` 做视觉反馈，`pointerup` 时一次性写入 state。

```
pointerdown → 记录起始位置，开始 CSS transform 模式
pointermove → 只更新被拖拽卡片的 CSS transform（不触发 React state）
pointerup   → 计算最终 grid 位置，一次性写入 DashboardDocument
```

### 5.2 ECharts 填充卡片

**现状问题**：ECharts `init` 是异步的，初始化时 flex 容器高度可能未稳定，`min-height: 120px` 作为初始高度，之后 ResizeObserver 才能修正。

**改造方向**：

- 确保 chart host div 在 ECharts 初始化前已有稳定的 pixel height
- 使用 `ResizeObserver` 在容器尺寸确定后再 `init`，而不是立即 `init`
- 去掉 `previewMeta` 中不必要的调试文字（节省空间）

---

## 六、数据库迁移改造

**现状问题**：核心表用 `docker/init/01-dashboard-schema.sql` 初始化，agent 表（`dashboard_agent_sessions` 等）在应用启动时 `CREATE TABLE IF NOT EXISTS`，两套机制并存，生产部署混乱。

**改造方向**：统一使用迁移工具（`node-pg-migrate` 或 Flyway），所有表通过版本化迁移文件管理。

---

## 七、其他遗漏问题（本次深度检查新发现）

### 7.1 AI Patch 应用后焦点选中逻辑错误

**位置**：`authoring-app.tsx:104-106`

```typescript
onAppliedDashboard: (nextDashboard) => {
  setSelectedViewId(nextDashboard.dashboard_spec.views[0]?.id ?? null); // ← 硬选第一个
},
```

AI patch 应用后，永远跳到第一个 view，而不是本次 AI 实际修改的 view。

**修复方向**：`applyPatch` 工具返回时携带 `touched_view_ids`，前端 `onAppliedDashboard` 优先选中 touched view 中的第一个。

### 7.2 管理页 loading 文案未接 i18n

**位置**：`management-state.ts:17,26`

```typescript
authoring: createEmptyCollection("Loading authoring dashboards..."),  // 英文硬编码
viewer: createEmptyCollection("Loading viewer dashboards..."),         // 英文硬编码
```

**修复方向**：改用 i18n key，或在调用处通过 `t()` 传入已翻译的字符串。

### 7.3 删除确认使用 `window.confirm`

**位置**：`authoring-app.tsx:366`、`dashboard-list-panel.tsx`（多处）

`window.confirm` 在嵌入式模式、浏览器弹窗策略严格环境下会被拦截，且样式不可控。

**修复方向**：统一替换为 antd `modal.confirm`（providers.tsx 已有 `ConfigProvider` + `App`，可直接 `useApp` 取 `modal`）。

### 7.4 顶栏「打开预览」用 `window.open` 可能被拦截

**位置**：`authoring-app.tsx:289`

```typescript
window.open(`/viewer/preview?previewKey=...`, "_blank", "noopener,noreferrer");
```

在某些浏览器或嵌入环境，非用户直接触发的 `window.open` 会被拦截。

**修复方向**：用 `<a>` 标签替代，或在按钮的 `onClick` 中同步调用（当前实现是异步生成 key 再 open，需重构为先渲染 href 再打开）。

### 7.5 Viewer 页面缺少错误边界和骨架屏

**位置**：`viewer-chart.tsx`、`viewer-dashboard.tsx`

ECharts 实例初始化失败时无任何 fallback，整个图表区域空白无提示。

**修复方向**：
- 添加 React ErrorBoundary 包裹每个图表卡片
- ECharts 初始化前显示 `loadingBar` 骨架（CSS 样式已在 `viewer.module.css` 中定义，未被使用）

### 7.6 创作页 `window.open` 预览与已发布 Viewer 体验断层

预览使用 `sessionStorage` + `previewKey` 传递未保存的草稿，但：
- 新 Tab 需要读取 `sessionStorage`，跨 Tab 无法共享（localStorage 更合适，或服务端临时存储）
- 用已发布 Viewer URL 分享给他人看到的是上次发布版本，但作者看到的是预览版，有混淆风险

**修复方向**：预览草稿存入 Redis 或数据库短期缓存（TTL 30min），返回带签名 token 的 URL，任何人打开都是同一个草稿快照。

---

## 八、优先级排序

| 优先级 | 改造项 | 影响范围 |
|--------|--------|---------|
| **P0** | Focused view 上下文注入 AI | Agent 准确性 |
| **P0** | Working draft 跨请求持久化（分阶段创作） | 核心用户流程 |
| **P0** | 简化 Route（去掉 chat route 和正则模式切换） | Agent 可靠性 |
| **P0** | 补全 deleteView / deleteQuery / deleteBinding 工具 | Agent 能力完整性 |
| **P0** | 管理页新增数据源 Tab + 数据源配置化后端 | 产品可用性 |
| **P0** | 清理 viewer-chart / template-preview 开发注释文本 | 产品级别 |
| **P0** | 替换所有 `window.confirm` 为 antd modal | 产品稳定性 |
| **P0** | AI 面板默认展开，显示当前焦点 | 核心 UX |
| **P0** | AI Patch 应用后选中正确 view（touched_view_ids） | 用户感知 |
| **P1** | 状态徽章改为用户语言 | 产品可读性 |
| **P1** | EditorDrawer 重设计为用户友好配置面板 | 产品可用性 |
| **P1** | 画布拖拽性能优化（CSS transform） | 体验流畅度 |
| **P1** | ECharts 填充卡片修复（ResizeObserver 延迟初始化） | 视觉完整性 |
| **P1** | Approval 粒度分级 | 流程合理性 |
| **P1** | Viewer 接入 i18n | 一致性 |
| **P1** | management-state loading 文案接 i18n | 一致性 |
| **P1** | 修复 `window.open` 预览（改为 `<a>` 同步打开） | 稳定性 |
| **P1** | Viewer 错误边界 + 骨架屏 | 用户体验 |
| **P2** | 预览草稿改为服务端短期缓存（TTL URL） | 协作体验 |
| **P2** | 统一数据库迁移方案 | 生产稳定性 |
| **P2** | 消息历史截断（sliding window） | 长会话稳定性 |
| **P2** | Approval 卡片内联在对话流 | UX 细化 |
