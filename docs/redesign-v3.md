# 产品改造设计文档 v3

> 本轮以**交互层彻底重构**为核心目标。架构不动，不做兼容，直接推到正确状态。

---

## 1. 产品定位

### 1.1 这是什么产品

一个以 **AI 为主创作通道**的 dashboard 生成工具。用户描述需求，AI 完成结构化创作，用户审批确认，最终发布可读的数据看板。

### 1.2 目标用户

**数据分析师、产品经理、技术运营**——能理解"数据来源"和"图表类型"的概念，但不需要写 SQL、不需要理解 binding contract。

AI 的存在价值正是屏蔽这些技术细节，让用户只需要用自然语言描述意图。

### 1.3 产品交互的核心立场

> **AI 是前景，画布是结果，技术细节是背景。**

- 用户打开创作页，第一眼看到的是 AI 对话入口，而不是空画布
- 画布是 AI 工作的可视化输出，不是用户操作的主战场
- SQL、binding、slot 等工程概念对用户不可见，按需通过"高级"入口访问

---

## 2. 本轮改造目标

本轮聚焦三件事，按优先级排列：

### 目标一：AI 创作链路可靠（基础）

AI 必须先能稳定工作，其他一切才有意义。

核心问题：
- Agent 使用正则做路由决策，自然语言下容易误判
- 用户选中的 view 没有进入 AI 上下文
- working draft 不跨回合持久，连续创作能力弱
- 没有显式删除工具，AI 无法完整编辑 dashboard

### 目标二：交互层彻底重建（本轮核心）

本轮的主要工作。不是修补细节，而是把整个交互层推到正确状态。

分两个优先级：

**优先级 A（产品身份层）**：直接决定用户对产品的第一印象
- AI 面板默认展开固定布局，不是浮动 dock
- 审批卡片说人话，不暴露系统路径
- 画布状态标签改用户语言

**优先级 B（完整度层）**：影响产品完整感，可紧跟 A 落地
- window.confirm / window.open → 产品内交互
- 顶栏操作层级重建
- Drawer 三段式重设计
- Viewer 语言统一
- Studio tab 降权
- 空画布 onboarding 引导

### 目标三：稳定性补齐（支撑）

不是主文档 headline，但影响能否演示和长期使用：
- 拖拽流畅度
- 图表初始化稳定性
- Viewer 错误兜底与加载态

---

## 3. 不纳入本轮范围

### 数据源能力

数据源管理与配置化属于平台化建设，不在本轮核心叙事内。详见 `docs/datasource-redesign.md`。

### 系统性重构

本轮不动架构：View / Query / Binding 数据模型、Agent tool calling、composePatch → applyPatch 审批流，这些设计判断都是正确的，不需要改。

---

## 4. 现状问题清单

### 4.1 AI 创作链路

- Agent 使用三条正则（`READ_ONLY_PATTERN`、`GENERIC_CREATE_PATTERN`、`SPECIFIC_REQUEST_PATTERN`）决定工作模式，自然语言场景下容易误判
- `selectedViewId` 是纯前端状态，没有进入 AI 上下文（`useAuthoringAgentSession` 接口不接受它）
- `WorkingDraftState` 每次请求重建，跨回合连续创作会丢失中间 draft
- tool 集合只有 `upsertView` / `upsertQuery` / `upsertBinding`，没有显式删除工具
- `applyPatch` 后 `onAppliedDashboard` 回调总是选中第一个 view，而不是 AI 实际操作的目标

### 4.2 创作页交互

- **AI 面板默认折叠**：`isDockOpen` 初始为 `false`，用户打开创作页看到空画布 + 角落浮钮，AI 像附加功能而非主通道
- **审批卡片暴露系统路径**：用户看到 `dashboard_spec.views.v_ai_1`，`patch.operations` 里已有 `summary` 字段但没有被用来渲染
- **画布卡片状态标签是工程语言**：`SQL + Binding`、`Mock`、`Unbound` 对用户没有意义
- **空画布无引导**：新建 dashboard 后没有任何视觉提示告诉用户该怎么开始，AI intro card 藏在折叠的面板里
- **顶栏操作过密**：8 个动作并列，无视觉层级。`Run Check` 用户不理解其含义
- **预览用 window.open**：新开标签页打断创作上下文
- **删除用 window.confirm**：浏览器原生对话框，体验割裂
- **审批 reject 流程未定义**：用户拒绝 AI 提案后，系统行为和后续流程不清晰
- **Drawer 是开发者工具**：暴露 `renderer.option_template JSON`、`SQL Template`、`Params JSON`、`Query Output JSON`，全是工程底层结构
- **Studio tab 暴露 AI 内部状态**：工作流阶段 `Inspect State → Stage Changes → Request Approval` 是 AI pipeline 概念，不是用户能理解的进度
- **大量 hardcode 英文未走 i18n**：Drawer 内 `Manual Fallback`、`Template Layer`、`Query Contract`、`Binding Contract`、`Param Mapping` 等

### 4.3 Viewer 页交互（同样严重）

- **中英文混用比 authoring 更乱**：`StatusPill` 同时有 `"Loading"` / `"Live"` / `"No Data"` / `"模板"`
- **加载状态文案 hardcode 英文**：`"Refreshing the report"`、`"Fetching the latest rows..."`
- **空结果文案 hardcode 英文**：`"Nothing to show in this range"`
- **错误状态文案 hardcode 英文**：`"This view needs attention"`
- **ContextStrip 全英文**：`Status` / `Range` / `Layout` / `Session`
- **Toolbar 全英文**：`Layout` / `Range` / `Refresh`
- **Viewer eyebrow hardcode**：`"Viewer"`
- **时间戳文案混用**：`Updated {timestamp}` vs `更新 {timestamp}`（previewMode 下）
- **previewMode 和正式 viewer 语言风格不一致**：前者部分中文，后者全英文

### 4.4 基础交互稳定性

- 拖拽时整页更新带来卡顿风险
- 图表初始化与容器尺寸稳定性耦合较强
- Viewer 错误兜底和加载态还不够产品化

---

## 5. 关键设计原则

### 5.1 AI 是前景，不是工具

用户打开创作页，AI 面板是第一眼可见的核心 UI，而不是需要手动唤出的辅助功能。画布是 AI 工作的输出展示区。

### 5.2 技术细节默认隐藏，按需可查

一切工程概念（SQL、binding、slot、工作流阶段）默认不出现在用户界面里。需要调试的技术用户可以通过"高级"折叠区访问。这是所有"要不要对用户显示这个技术细节"判断的统一准则。

### 5.3 高风险操作有明确边界，不依赖浏览器原语

删除、数据接入、patch 应用——这些操作需要产品内的确认交互，而不是 `window.confirm` / `window.open`。

### 5.4 语言统一，全走 i18n

任何面向用户的字符串都不能 hardcode。Authoring、Viewer、Drawer 使用一致的产品语言风格。

### 5.5 优先做减法

删除错误抽象，收紧暴露给用户的概念范围，用更少的元素表达更清晰的产品行为。

---

## 6. AI 创作链路改造

### 6.1 简化路由决策

目标：减少"系统先猜错路线，再开始工作"的概率。

- 移除或弱化 `READ_ONLY_PATTERN`、`GENERIC_CREATE_PATTERN`、`SPECIFIC_REQUEST_PATTERN` 三条正则路由
- 保留 `approval` 作为硬约束（有 pending patch 就必须先处理）
- 保留 `chat`（闲聊识别），但范围缩窄，只匹配明确的无关请求
- 更多普通请求直接进入统一 authoring loop，由 AI 自主判断读 / 写

### 6.2 Focused View 上下文注入

用户在画布上选中某张图后发起请求，AI 应该知道当前大概率在讨论哪个 view。

传递路径：

```
selectedViewId（authoring-app.tsx useState）
  → useAuthoringAgentSession 接口新增 selectedViewId 参数
  → handleGenerateAi 发请求时带入 body.focusedViewId
  → chat-request.ts 解析 → chat-service.ts 传给 createDashboardAgentWorkflow
  → workflow.ts system prompt 注入：
      "The user currently has view '{title}' ({id}) focused on the canvas."
```

涉及文件：`agent-contract.ts`、`chat-request.ts`、`chat-service.ts`、`workflow.ts`、`use-agent-session.ts`

### 6.3 Working Draft 跨回合持久化

`WorkingDraftState` 目前是请求内内存，请求结束即丢。

方案：扩展 `DashboardAgentSessionState.prompt`，加 `workingDraft` 字段。

```ts
prompt: {
  lastContextFingerprint: string | null;
  workingDraft?: {
    dashboardSpec?: DashboardDocument["dashboard_spec"];
    queryDefs?: QueryDef[];
    bindings?: Binding[];
    bindingMode?: "mock" | "live";
    dirtyViewIds: string[];
    dirtyQueryIds: string[];
    dirtyBindingIds: string[];
    layoutTouched: boolean;
    stagedAt: string;
  } | null;
};
```

关键行为：
- 初始化时从 session 读出 `workingDraft`，传给 `buildDashboardAgentTools` 作为初始状态
- `buildDashboardAgentTools` 暴露 `getDraftSnapshot()` 供外部读取
- `applyPatch` 成功后，stream completion handler 将 `workingDraft: null` 写回 session
- `persistDashboardAgentChatSessionSnapshot` 调 `getDraftSnapshot()` 存入 session

不需要新的基础设施，session-repository 已在工作。

### 6.4 deleteView 工具

补充显式删除工具，放入 write mode 工具集：

```ts
deleteView: tool({
  description: "Remove a view and its layout entries from the draft dashboard spec.",
  inputSchema: z.object({ view_id: z.string().min(1), reason: z.string().optional() }),
  execute: async ({ view_id }) => {
    // 1. 从 workingDraft.dashboardSpec.views 移除
    // 2. 从 layout items 移除对应项
    // 3. workingDraft.dirtyViewIds.add(view_id)
    // 孤立的 query/binding 由 reconcileDashboardDocumentContract 自动清理
  }
})
```

`composePatch` 的 `buildPatchFromDocument` 已处理"在 dirtyIds 但不在 next 里"的情况，会正确生成 `{ op: "remove" }`，不需要改 patch 生成逻辑。

同理后续补 `deleteQuery`、`deleteBinding`。

### 6.5 分阶段创作

patch 模型本身不需要改，`kind: "layout" | "data"` 已够用。缺的是：

**（a）system prompt 加明确指导**：
```
You can author in stages:
1. First create the view structure (upsertView → composePatch → applyPatch)
2. Later add real data connections (upsertQuery → upsertBinding → composePatch → applyPatch)
You do not need to complete both stages in one turn.
```

**（b）依赖 6.3 的 draft 持久化**，让两轮之间的工作不丢失。

### 6.6 patch 应用后焦点归位

`onAppliedDashboard` 回调目前总是选中第一个 view：

```ts
// 现在
onAppliedDashboard: (nextDashboard) => {
  setSelectedViewId(nextDashboard.dashboard_spec.views[0]?.id ?? null);
}
```

应改为：优先选中 AI 实际操作的 view（从 `applyPatch` 输出的 `patch.operations` 中取第一个 view 相关操作的 view_id）。

---

## 7. 交互层重建

### 7.1 优先级 A：产品身份层

**这几个改动决定用户对产品的第一印象，是本轮最高优先级。**

#### A1 AI 面板默认展开，固定布局

当前：可拖拽的浮动 dock，`isDockOpen` 初始为 `false`。

改后：AI 面板固定在右侧，与画布并列，创作页打开即可见。

```
+---------------------------------------------------+
| 顶栏：名称 · 状态 · 保存 · 发布                    |
+------------------------------+--------------------+
| 画布                         | AI 助手            |
| - 选中 view 高亮             | - 欢迎引导 / 对话流 |
| - 卡片快捷操作               | - 审批卡片         |
| - 空状态引导                 |                    |
+------------------------------+--------------------+
```

面板可以有收起按钮，但不是默认状态。

#### A2 审批卡片说人话

`patch.operations` 里已有 `summary` 字段，直接用它渲染：

```
现在：
  add  dashboard_spec.views.v_ai_1
  add  query_defs.q_ai_1

改后：
  ✓ 创建图表「周销售趋势」
  ✓ 连接销售数据库，查询近 7 天数据

  [应用]   [取消]
```

审批卡片同时展示：本次操作摘要 + 数据连接模式（演示数据 / 真实数据）。

#### A3 画布卡片状态标签改用户语言

| 现在 | 改后 |
|------|------|
| `SQL + Binding` | `已连接数据` |
| `Mock` | `演示数据` |
| `Unbound` | `待配置` |
| `Draft` | `创建中` |
| `Preview OK` | `数据正常` |
| `Error` | `数据异常` |

---

### 7.2 优先级 B：完整度层

#### B1 空画布 Onboarding 引导

新建 dashboard 后，画布空白区展示引导内容：

```
+----------------------------------------+
|                                        |
|   还没有图表                            |
|   在右侧和 AI 说说你想要什么            |
|   比如：「帮我做一个销售周报」          |
|                                        |
+----------------------------------------+
```

同时 AI 面板里的 `agentGuidance.message` 改为积极的引导语，而不是等待状态。

#### B2 顶栏操作重建

当前 8 个操作并列：`Back Home | Run Check | Open Preview | Save | Publish | Desktop | Mobile | Show/Hide Menu`

重建后分三组，降低密度：

```
[← 返回]   [名称输入框   ·  状态]   [桌面 / 移动]   [预览]   [保存]   [发布]
```

- `Run Check` 移除：改为保存时自动触发，不需要用户手动操作
- `Open Preview` 改为在页面内切换预览模式（见 B3）
- `Save` 和 `Publish` 保留，但视觉权重明确区分

#### B3 预览替代 window.open

用页面内预览层替代新标签页。点击「预览」后：
- 画布切换为只读预览模式（真实数据渲染）
- 顶栏出现「退出预览」按钮
- 不离开当前页面，不打断创作上下文

#### B4 删除确认替代 window.confirm

删除 view 时，在画布卡片上内嵌确认交互：

```
[× 删除「周销售趋势」？]
[确认删除]  [取消]
```

或者通过 AI 面板展示确认消息，而不是弹出浏览器原生对话框。

#### B5 审批 Reject 流程定义

用户点「取消」拒绝 AI 提案后：
- AI 面板显示：「已取消。告诉我哪里需要修改，或者重新描述你的需求。」
- working draft 清空（此次 AI 工作的中间状态丢弃）
- 用户可以继续输入，开启新一轮创作

核心原则：reject 不是"报错"，是"重新开始对话"。

#### B6 Drawer 三段式重设计

将 Drawer 重构为配置面板，不再是底层结构编辑器：

```
第一段：视图摘要（始终可见）
  - 标题（可编辑）
  - 描述（可编辑）
  - 数据状态（用户语言，见 A3 标签映射）

第二段：AI 快捷操作（新增）
  [修改图表外观]   [更换数据来源]
  点击后预填 AI 面板输入框，聚焦对话

第三段：高级（默认折叠）
  - renderer.option_template JSON
  - Query SQL、Params、Output
  - Binding 参数映射
  折叠标签：「开发者工具」
```

Drawer 内所有字符串全走 i18n，移除 hardcode 英文。

#### B7 Studio Tab 降权

Studio tab 重命名为「详情」或直接移除，取决于是否有用户场景需要它：
- 工作流阶段默认折叠，放入「AI 运行详情」可展开区域
- `Manual Fallback` section 移除，改为从 Drawer 入口操作
- AI 内部状态（route、mode、skill_ids）不对用户展示

原则：**技术细节默认隐藏，按需可查**。

---

## 8. Viewer 页语言统一

Viewer 目前比 authoring 的中英混用问题更严重，必须本轮一起处理。

### 8.1 状态标签统一

| 现在 | 改后 |
|------|------|
| `"Loading"` | `"加载中"` |
| `"Live"` | `"数据正常"` |
| `"No Data"` | `"暂无数据"` |
| `"Review"` | `"数据异常"` |
| `"模板"` | `"演示模板"` |

### 8.2 加载 / 空 / 错误状态文案

| 现在（hardcode 英文） | 改后 |
|------|------|
| `"Refreshing the report"` | `"正在加载数据"` |
| `"Fetching the latest rows..."` | `"获取所选时间范围的数据"` |
| `"Nothing to show in this range"` | `"所选时间范围内暂无数据"` |
| `"This view needs attention"` | `"此图表数据异常"` |
| `"Batch request failed."` | `"数据请求失败"` |

### 8.3 Toolbar 和 ContextStrip

- `"Status"` / `"Range"` / `"Layout"` / `"Session"` → 走 i18n
- `"Refresh"` → `"刷新"`
- `"Viewer"` eyebrow → `"数据看板"` 或走 i18n
- `"Updated {timestamp}"` 和 `"更新 {timestamp}"` → 统一为同一格式，走 i18n

### 8.4 previewMode 和正式 viewer 语言统一

两种模式复用同一套 i18n 字符串，不再各自 hardcode 不同语言。

---

## 9. 稳定性支撑

### 9.1 拖拽性能

拖拽时应优先保证流畅，避免每次 `pointerMove` 都触发整页重渲染。

### 9.2 图表初始化稳定性

ECharts 初始化、容器尺寸、重绘时机作为支撑工作系统性处理。

### 9.3 Viewer 兜底能力

Viewer 需要完整的加载 / 空 / 错误状态，不依赖开发者手写 catch message。

### 9.4 工程维护性

预览链路、状态持久化、迁移方案优先满足「可维护、可继续迭代」，不追求一次到位。

---

## 10. 分阶段执行

### Phase 1：AI 主链路拉直

目标：AI 改得准，链路顺。

- 路由简化（移除脆弱正则）
- focused view 上下文注入（6.2）
- working draft 持久化（6.3）
- deleteView 工具（6.4）
- patch 应用后焦点归位（6.6）
- system prompt 补分阶段创作指导（6.5）

阶段完成标准：连续两轮对话能在同一个 view 上叠加修改，不丢失上下文。

### Phase 2：交互层产品身份重建

目标：用户对产品的第一印象是"这是个产品"。

- AI 面板默认展开，固定布局（A1）
- 审批卡片语言（A2）
- 画布状态标签（A3）
- 顶栏重建（B2）
- 空画布 onboarding（B1）

阶段完成标准：新用户打开创作页，3 秒内知道从哪里开始，AI 审批卡片能看懂。

### Phase 3：交互完整度 + Viewer 统一

目标：完整的产品体验，没有明显的粗糙感。

- 预览替代 window.open（B3）
- 删除确认替代 window.confirm（B4）
- 审批 reject 流程（B5）
- Drawer 三段式重设计（B6）
- Studio tab 降权（B7）
- Viewer 语言全面统一（第 8 节）
- Drawer 内所有 hardcode 英文走 i18n

### Phase 4：稳定性支撑

目标：核心体验能稳定运行，而不只是能演示。

- working draft 持久化（可与 Phase 1 合并）
- 拖拽性能优化
- 图表初始化稳定性
- Viewer 错误兜底与加载态完善

---

## 11. 任务拆分建议

按三组并行推进：

### AI 主链路组

- agent route 简化
- focusedViewId 传递链路
- working draft session 持久化
- deleteView / deleteQuery / deleteBinding 工具
- patch 焦点归位
- system prompt 更新

### 产品交互组

- AI 面板布局重建（浮动 → 固定）
- 审批卡片 UI 重写
- 画布状态标签替换
- 顶栏重建
- 空画布 onboarding
- 预览页内化
- 删除确认内嵌
- reject 流程实现
- Drawer 三段式重构
- Studio tab 降权

### 语言统一组

- authoring Drawer 所有 hardcode 英文 → i18n
- Viewer 所有 hardcode 英文 → i18n
- previewMode / viewer 语言风格统一
- 状态标签映射表统一实现

---

## 12. 成功标准

### AI 链路成功标准

- 连续两轮对话可以在同一 view 上叠加修改
- 用户选中某张图后，AI 下一条回复知道在讨论哪个 view
- AI 可以完整执行：创建、修改、删除 view / query / binding

### 产品体验成功标准

- 新用户打开创作页，3 秒内明白从哪里开始
- 用户能读懂审批卡片在说什么，不需要了解系统内部结构
- 整个产品界面没有 hardcode 英文字符串出现在中文用户界面中

### 改造完成后团队能回答的问题

1. AI 主链路的 5 个问题分别被哪个 PR 修复
2. 交互层的产品身份改动（A1/A2/A3）是否全部落地
3. Viewer 和 authoring 是否使用了同一套 i18n 语言风格

---

## 13. 后续独立议题

- 数据源管理与配置化：`docs/datasource-redesign.md`
- 更长期的平台化建设
- Mobile authoring 体验（当前优先级不高）

---

## 14. 一句话总结

这轮改造的核心不是加功能，而是**把一个能用的工程原型推到一个真正以 AI 为核心的产品状态**。

架构不动。交互重建。
