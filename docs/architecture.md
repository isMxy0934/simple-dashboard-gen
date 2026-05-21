# Simple Dashboard Gen — 系统架构设计

> **适用版本**：Schema 1.0 / Hermes Authoring Agent v3.0  
> **面向读者**：核心开发者、新加入贡献者  
> **文档性质**：**目标架构**（target state）。本文件描述系统的最终设计，不包含"折中"或"待实现"表述。  
> **从旧实现迁移**：见 [docs/migration.md](./migration.md)  
> **术语**：见[附录 A](#附录-a术语表)；目标态新增的类型/字段集中列表见[附录 B](#附录-b目标态新增类型与字段清单)。

---

## 目录

**Part I — 核心架构**
1. [系统定位与核心概念](#1-系统定位与核心概念)
2. [分层架构](#2-分层架构)
3. [Agent 架构](#3-agent-架构)
4. [渲染架构](#4-渲染架构)
5. [可观测性架构](#5-可观测性架构)
6. [Auth 与权限架构](#6-auth-与权限架构)

**Part II — 运行时治理**

7. [失败模式与降级](#7-失败模式与降级)
8. [容量、限流与硬上限](#8-容量限流与硬上限)
9. [测试金字塔](#9-测试金字塔)
10. [Schema 版本与迁移](#10-schema-版本与迁移)

**Part III — 流程与数据流**

11. [数据流：Authoring 完整路径](#11-数据流authoring-完整路径)
12. [数据流：Viewer 渲染路径](#12-数据流viewer-渲染路径)

**Part IV — 横向关注点**

13. [国际化（i18n）架构](#13-国际化i18n-架构)
14. [数据存储与持久化](#14-数据存储与持久化)
15. [部署与运维](#15-部署与运维)

**Part V — 决策与约束**

16. [关键设计决策记录（ADR）](#16-关键设计决策记录adr)
17. [各层 AGENTS.md 约束摘要](#17-各层-agentsmd-约束摘要)

**附录**

- [附录 A — 术语表](#附录-a术语表)
- [附录 B — 目标态新增类型与字段清单](#附录-b目标态新增类型与字段清单)

---

## 1. 系统定位与核心概念

**Simple Dashboard Gen** 是一个 AI-first 的 BI 仪表盘生成器。用户通过自然语言与 AI Agent 交互，Agent 提议变更，用户审批后变更写入文档，查询执行后渲染成图表。

### 1.1 核心资产：`DashboardDocument`

整个系统围绕一个中心数据结构运转：

```typescript
// src/contracts/dashboard.ts
type DashboardDocument = {
  schema_version: SchemaVersion;   // 见 §10
  dashboard_spec: DashboardSpec;   // 布局、视图、过滤器、表现层配置
  query_defs: QueryDef[];          // 数据查询定义
  bindings: Binding[];             // 视图 slot ↔ 查询结果的绑定关系
};
```

`DashboardDocument` 是系统的唯一真相来源（single source of truth）。它贯穿三个核心场景：

- **Authoring**：Agent 通过 `WorkingDraft` 提议变更，经用户审批后 `applyPatch` 写入
- **Execution**：从 `query_defs + bindings` 派生出 `ExecuteBatchRequest`，调用查询引擎
- **Viewer**：从 `dashboard_spec + bindings + 查询结果` 派生出渲染状态

### 1.2 核心流程

```
用户输入 → computeAuthoringScope → resolveRuntimeToolSurface
       → pi-agent loop (stageChart / composePatch)
       → 用户 Approval UI → applyPatch
       → DashboardDocument 变更持久化
       → execute-batch 查询
       → materializeEChartsOptionTemplate
       → ECharts.setOption
```

### 1.3 技术栈与运行环境

本节集中声明全栈技术选型，所有后续章节默认基于此：

| 类别 | 选型 | 备注 |
|------|------|------|
| 前端框架 | Next.js（App Router） | 服务器组件、路由 handler、cookies API 见 `next/headers` |
| UI 库 | React 19 + TypeScript（strict） | — |
| 图表 | ECharts 5.x | server/browser 共用，纯函数管道 |
| 后端运行时 | Node.js 22（LTS）+ Next.js Route Handler | 单体部署，详见 §15 |
| 数据库 | PostgreSQL 16 | 同时用作元数据库与默认数据源 |
| DB Schema 管理 | SQL migration files + `ensureCloudAuthoringSchema` | 详见 §14 |
| AI Runtime | pi-agent（内置 OpenAI / Anthropic provider 抽象，详见 ADR-12） | — |
| 认证 | HTTP-only cookie + HS256 JWT（`jose` 包） | 详见 §6 |
| 包管理 | pnpm | — |
| 测试 | Vitest + Playwright | 详见 §9 |
| 可观测性 sink | 默认 JSONL 文件；接口允许接 OpenTelemetry / Postgres | 详见 §5 |
| i18n | 自建 `src/web/i18n/`，按 locale 分文件 | 详见 §13 |

### 1.4 实现状态约定

本文档为**目标架构**，所有描述视为最终设计。文档内任何**新增类型、字段、模块、接口**——若当前代码中尚不存在——在首次出现处标注一次 `(new)`，并集中列于[附录 B](#附录-b目标态新增类型与字段清单)。

**未标 `(new)` 即视为现状已实现**。从旧实现到目标态的迁移路径详见 [docs/migration.md](./migration.md)。

---

## 2. 分层架构

越底层越稳定，越顶层变化越频繁。上层依赖下层，禁止反向依赖。

```
┌─────────────────────────────────────────────────────────┐
│  Presentation Layer                                     │
│  编辑UI (src/web/authoring/)                            │
│  Viewer UI (src/web/viewer/)                            │
│  管理UI (src/web/management/)                           │
├─────────────────────────────────────────────────────────┤
│  Application Layer                                      │
│  编辑Session (src/server/authoring/)                    │
│  Publish/Save (src/app/api/dashboard/)                  │
│  ExecuteBatch (src/server/execution/)                   │
├───────────────────────┬─────────────────────────────────┤
│  Agent Layer          │  Rendering Layer                │
│  src/ai/authoring/    │  src/renderers/                 │
│                       │  src/presentation/              │
├───────────────────────┴─────────────────────────────────┤
│  Data Layer                                             │
│  数据源 (src/server/datasource/)                        │
│  查询引擎 (src/server/execution/)                       │
│  Schema 发现 (listDatasourceTables / getTableSchema)    │
│  持久化 (src/server/cloud/, src/server/dashboards/)     │
├─────────────────────────────────────────────────────────┤
│  Domain Core                                            │
│  DashboardDocument 纯操作 (src/domain/)                 │
│  数据契约 (src/contracts/)                              │
└─────────────────────────────────────────────────────────┘

基础设施模块（不参与上述分层的依赖关系，由 Application Layer 调用）：
  Auth/Permission  — requireServerSession 中间件 (new)（src/server/auth/）
  Observability    — ObservabilityBus + LogSink (new)（src/server/logs/）
  Quota/Rate Limit — 硬性容量与限流 (new)（src/server/guards/，见 §8）
  Migrations       — Schema 版本迁移 (new)（src/server/dashboards/migrations/，见 §10）
  Config Loader    — ENV 校验与配置加载 (new)（src/server/config/，见 §15.2）
```

### 2.1 Domain Core

**职责**：纯粹的 dashboard 业务规则，零副作用。  
**单一变更理由**：dashboard 契约语义发生变化。

| 模块 | 路径 |
|------|------|
| 类型契约 | `src/contracts/dashboard.ts` |
| 纯文档操作 | `src/domain/dashboard/document.ts` |
| Layout 派生 | `src/domain/dashboard/layout.ts` |
| Binding 语义 | `src/domain/dashboard/bindings.ts` |
| Document 指纹 | `src/domain/dashboard/document-fingerprint.ts` |
| Contract 校验内核 | `src/domain/dashboard/contract-kernel.ts` |

**设计原则**：无 React、无 fetch、无 DB、无文件系统访问。可在任何环境（浏览器/Node/测试）直接调用。  
**禁止依赖**：`src/web/`、`src/server/`、`src/ai/`、`src/renderers/`。

### 2.2 Data Layer

**职责**：数据源连接、查询执行、Schema 发现、文档持久化。  
**单一变更理由**：底层存储或查询引擎变化。

| 模块 | 路径 |
|------|------|
| 数据源引擎注册表 | `src/server/datasource/engine-registry.ts` |
| 批量查询执行 | `src/server/execution/` |
| 云端持久化 | `src/server/cloud/` |
| Dashboard 持久化 | `src/server/dashboards/` |
| Schema 迁移器 (new) | `src/server/dashboards/migrations/` |

**禁止依赖**：`src/web/`、`src/ai/`、React。

### 2.3 Agent Layer

**职责**：AI 推理循环、工具表面管理、capability scope、WorkingDraft 事务。  
**单一变更理由**：AI 能力策略或工具协议变化。  
详见 [第 3 节](#3-agent-架构)。

### 2.4 Rendering Layer

**职责**：ECharts option 模板管理、materialize、validate。  
**单一变更理由**：渲染器实现或图表类型变化。  
详见 [第 4 节](#4-渲染架构)。

### 2.5 Application Layer

**职责**：HTTP 路由编排、Session 生命周期管理、发布流程。  
**单一变更理由**：业务流程或 API 边界变化。

| 模块 | 路径 |
|------|------|
| Authoring chat stream | `src/app/api/authoring/chat/[id]/stream/route.ts` |
| Session open/save | `src/app/api/authoring/session/` |
| Dashboard publish | `src/app/api/dashboards/[dashboardId]/publish/route.ts` |
| Query execute-batch | `src/app/api/query/execute-batch/route.ts` |
| Chat 请求装配 | `src/server/authoring/chat-request.ts` |
| Chat 流式执行 | `src/server/authoring/chat-service.ts` |
| Session 持久化编排 | `src/server/authoring/chat-session-orchestrator.ts` |

**原则**：
- 路由只做参数解析和薄组合，实际逻辑下沉到 `src/server/` 或 `src/ai/`。
- **所有路由强制以 `requireServerSession(req)` 开头**（new），从 session 推导 `userId` / `workspaceId`，禁止从 query string / body 读 identity 字段（见 §6）。
- 所有 mutating 路由（POST/PUT/DELETE/PATCH）追加 CSRF 校验（见 §6.4）。
- `chat-session-orchestrator` 负责 session 的加载/快照/持久化生命周期；**turn 内的 scope 推导与 surface 切换在 `AuthoringAgentSession`**（`src/ai/authoring/agent/session.ts`）里。两者职责不混淆。

### 2.6 Presentation Layer

**职责**：面向用户的 React UI，包括编辑器、Viewer、管理界面。  
**单一变更理由**：UI/UX 交互设计变化。

| 模块 | 路径 |
|------|------|
| 编辑 UI | `src/web/authoring/` |
| Viewer UI | `src/web/viewer/` |
| 管理 UI | `src/web/management/` |

**禁止依赖**：`src/server/`；跨 feature 依赖需通过 `src/web/i18n/`、`src/web/utils/`、`src/web/api/` 等共享模块。

---

## 3. Agent 架构

### 3.1 核心边界规则

Agent 不直接修改 `DashboardDocument`。**唯一合法的变更路径**是：

```
Agent 调用 stageChart/stageReplaceChart/stageQuery/stageDelete
        ↓
    WorkingDraft（内存暂存）
        ↓
    runCheck（校验）
        ↓
    composePatch → PendingProposal（含 draft fingerprint + expires_at）
        ↓
    用户在 Approval UI 点击确认 → LocalApprovalEvent
        ↓
    applyPatch（服务端验证 proposalId + baseVersion + fingerprint + expires_at）
        ↓
    DashboardDocument 持久化变更
```

一旦 `composePatch` 或 `applyPatch` 成功，当前 turn 的剩余过程强制切换为 chat-only，模型无法在同一 turn 内重新开启写工具。

### 3.2 Turn 生命周期

每个用户 turn 经过固定路径，无例外（左侧为概念名，右侧为代码符号）：

```
sanitizeAgentMessages(transcript)
  // src/ai/authoring/runtime/llm-boundary.ts
        ↓
deriveConversationSignalsFromTranscript(...)
  // src/ai/authoring/runtime/transcript-inspection.ts
        ↓
computeAuthoringScope(input) → AuthoringScopeCapabilities
  // src/ai/authoring/runtime/capability-scope.ts
  // 出口处应用 filterToolFailures（TOOL_FAILURE_THRESHOLD = 3）
        ↓
AuthoringScopeManager.buildSurfaceFromScope(scope)
  → resolveRuntimeToolSurface(...)
  // src/ai/authoring/agent/tool-surface.ts
  → { mode, activeTools, toolChoice, promptSections, reason }
        ↓
pi-agent loop (model ↔ tools)
        ↓
tool hooks → AuthoringScopeManager.onToolResult(...)
  → 写入 stepHistoryInTurn
  → 必要时设置 forceChatOnlyForTurn
        ↓
AuthoringScopeManager.applySurfaceToAgent(agent, context)
  // 每个 step 前/后调用，可能触发 surface 重算
        ↓
persistSessionSnapshot + contextFingerprint
```

**3 次连续失败的工具被移除**：由 `computeAuthoringScope` 出口处的 `filterToolFailures` 实现，依据是 `stepHistoryInTurn` 中同名工具的连续 `outcome === "error"` 计数。

关键类型：

```typescript
// src/ai/authoring/contracts/runtime.ts
type AuthoringCapabilityProfile =
  | "chat"
  | "explore"
  | "author-dashboard"
  | "author-focused"
  | "approval";

type AuthoringScope =
  | { kind: "dashboard" }
  | { kind: "focused"; viewId: string }
  | { kind: "empty" };

interface AuthoringScopeCapabilities {
  profile: AuthoringCapabilityProfile;
  scope: AuthoringScope;
  scopeResolution: AuthoringScopeResolution;
  allowedTools: AuthoringToolName[];
  contextBlockVariant: "dashboard" | "focused" | "empty";
  relevantSkillIds: string[];
  stopReason: "approval-applied" | null;
}
```

`AuthoringScope` 是 **discriminated union**，`focused` 必带 `viewId`。`relevantSkillIds` 用于驱动 prompt 中可见的 skill 提示，由 `computeAuthoringScope` 根据 conversation signals 推导。`stopReason` 当前仅有 `"approval-applied"` 一个非空值。

### 3.3 Tool 可见性：两个 Scope 的交集

```typescript
availableTools
  = WorkspacePolicy.derive(session)          // (new) Auth Layer 管
  ∩ AgentContextScope.derive(conversation)   // Agent Layer 管
```

**WorkspacePolicy** (new)（权限维度）：
- 类型：`WorkspacePolicy`（导出位置 `src/server/auth/workspace-policy.ts`）
- 由 `requireServerSession` 注入的 `UserSession.permissions` 推导用户能操作哪些工具
- 推导函数：`WorkspacePolicy.derive(session: UserSession): { allowedToolNames: Set<AuthoringToolName> }`
- 权限粒度见 §6.5

**AgentContextScope**（对话语境维度，已实现）：
- 由 `computeAuthoringScope` 根据对话状态、意图信号、tool 失败历史动态推导
- 例：用户闲聊时不开放 `stageChart`；明确提出创建意图时才开放
- 与权限完全解耦，Agent Layer 不感知用户权限

两个维度解耦的原因：权限是静态的用户属性，对话意图是动态的 session 状态。混合管理会导致两类变更原因交织，难以独立演进（见 ADR-05）。

### 3.4 Surface 优先级

实际实现在 `src/ai/authoring/agent/tool-surface.ts`，导出 `resolveRuntimeToolSurface`；`AuthoringScopeManager.buildSurfaceFromScope` 委托给它。优先级如下：

1. `forceChatOnlyForTurn === true` → chat surface（`reason: "chat_only"`，最高优先级）
2. `approval.decision === "approve"` → approval surface（`activeTools: ["applyPatch"]`，`reason: "approval_apply"`）
3. `approval.decision === "reject"` → chat surface（`reason: "chat_only"`）
4. `decision.allowedTools` 为空 → chat surface
   - `scopeResolution.requires_scope_clarification === true` 时 `reason: "scope_blocked"`，否则 `reason: "chat_only"`
5. `profile === "explore"` → inspect surface（基于 `getReadToolNamesForScope` 过滤）
6. `profile === "author-dashboard" | "author-focused"` → author surface
   - `activeTools` 排除 `applyPatch`（审批工具不在 author lane 出现）
   - **Draft 子策略**（`applyAuthoringDraftToolPolicy`）：
     - `hasDraft && canCompose` → 强制 `composePatch`，`toolChoice: { type: "tool", toolName: "composePatch" }`，prompt 注入 `draft-compose`
     - `hasDraft && blockers === ["stale_check"]` → 强制 `runCheck`，prompt 注入 `draft-runtime-check`
7. 兜底 → chat surface（`reason: "chat_only"`）

**`forceChatOnlyForTurn` 的触发点**（在 `AuthoringScopeManager.onToolResult` 中累计）：

- `composePatch` / `applyPatch` 成功后强制切换（确保 §3.1 的边界规则）
- inspect surface 下读工具预算耗尽（`hasExhaustedInspectReadBudget`）
- author surface 下非 declaration 工具步数达到 `AUTHOR_TOOL_STEP_LIMIT`

**Approval 完整性**：不匹配 / 过期 / 已 reject 的 ApprovalEvent 在 `chat-session-orchestrator` 的 approval-preflight 阶段提前拒绝（HTTP 4xx），**不进入 surface 决策**。这保持了 `resolveRuntimeToolSurface` 的纯净。

### 3.5 工具清单

工具的权威来源是 `src/ai/authoring/tools/registry.ts`（`AUTHORING_TOOL_REGISTRY`），共 4 个 `category`：`read` / `declaration` / `author` / `approval`。每个工具同时声明：

- `readScopes` / `authorScopes`：在哪种 AgentContextScope 下可见
- `requiredPermissions` (new)：需要哪些 `Permission`，由 `WorkspacePolicy.derive` 在 turn 入口过滤

**`read` — 读/检查工具**（无副作用）：
`loadSkill`、`getViews`、`getView`、`getDatasources`、`listDatasourceTables`、`getTableSchema`、`previewTableData`、`getQuery`、`getBinding`、`getDraftStatus`

**`declaration` — 意图声明工具**（无副作用，inspect/author 两个 lane 都可见）：
`declareAuthoringGoal`

**`author` — 写事务工具**（写 WorkingDraft，不写 Document）：
`runCheck`、`stageChart`、`stageReplaceChart`、`stageQuery`、`stageDelete`、`composePatch`

其中 `stageChart` / `stageReplaceChart` / `stageQuery` / `stageDelete` 标记为 `lifecycleWrite: true`，会修改 WorkingDraft 的视图/查询结构；`runCheck` 和 `composePatch` 不直接写结构但参与事务流程。

**`approval` — 审批工具**（仅在 approval surface 出现）：
`applyPatch`

### 3.6 关键文件

| 文件 | 职责 |
|------|------|
| `src/ai/authoring/runtime/capability-scope.ts` | `computeAuthoringScope` 实现，scope 决策逻辑 |
| `src/ai/authoring/agent/session.ts` | Agent turn 生命周期、pi-agent 实例管理 |
| `src/ai/authoring/agent/tool-surface.ts` | `resolveRuntimeToolSurface`，Surface 优先级实现 |
| `src/ai/authoring/agent/scope-manager.ts` | `AuthoringScopeManager`，turn 内 scope 刷新 |
| `src/ai/authoring/tools/factory.ts` | `buildAuthoringTools`，工具注册与运行时上下文 |
| `src/ai/authoring/tools/registry.ts` | 工具名称注册表（scope 过滤的 source of truth）|
| `src/server/auth/workspace-policy.ts` (new) | `WorkspacePolicy.derive` 实现 |
| `src/server/authoring/chat-session-orchestrator.ts` | Session 加载/持久化编排，approval-preflight |
| `src/server/authoring/chat-service.ts` | HTTP 层 turn 编排 |

---

## 4. 渲染架构

### 4.1 设计原则

渲染层是**纯函数管道**：相同输入产生相同 ECharts option，无副作用，server 和 browser 共用同一套代码。这使得 server-side 预校验和 client-side 渲染完全一致，消除"本地正常、生产异常"的整类问题。

### 4.2 Recipe Registry

每种图表类型对应一个 **Recipe**，Recipe 封装该图表类型的 ECharts option 模板和 slot 定义。`chart-recipe-registry.ts` 是 ECharts option template 的**唯一**注册表，AI skill 通过 `recipe_id` 引用，不重复定义模板。

```typescript
// src/renderers/echarts/recipes/chart-recipe-registry.ts
const ECHARTS_STAGE_CHART_RECIPE_BUILDERS = {
  "echarts-bar":          buildEChartsBarRecipe,
  "echarts-line":         buildEChartsLineRecipe,
  "echarts-kpi-card":     buildEChartsKpiCardRecipe,
  "echarts-kpi-text":     buildEChartsKpiTextRecipe,
  "echarts-kpi-gauge":    buildEChartsKpiGaugeRecipe,
  "echarts-signal-list":  buildEChartsSignalListRecipe,
  "echarts-funnel":       buildEChartsFunnelRecipe,
  "echarts-ranked-bar":   buildEChartsRankedBarRecipe,
};
```

Registry 在模块加载时执行完整性断言（`assertEChartsStageChartRecipeRegistryComplete`），遗漏注册会在启动时立即报错。Recipe ID 的字面量来源在 `src/contracts/dashboard-chart-recipes.ts`，所有层共享同一组 ID。

**Skill / Recipe 双 registry 的编译期强制对齐** (new)：

`src/contracts/dashboard-chart-recipes.ts` 中导出 `EChartsStageChartRecipeId` 联合类型；同时 `AuthoringSkillId` 通过类型层等式 `AuthoringSkillId extends EChartsStageChartRecipeId ? true : false` 强制两个 registry 必须同时覆盖每个 ID。任一缺失即编译失败。

两个 registry 各自的职责：
- `src/ai/authoring/skills/registry.ts` —— "AI 意图与查询构造"（含 `buildQueryDef`、SQL 模板、prompt 示例）
- `src/renderers/echarts/recipes/chart-recipe-registry.ts` —— "渲染"（option template + slot 定义）

两者通过 `recipe-build.ts → buildEChartsStageChartRecipe` 桥接：skill builder 委托 recipe registry 生成 option，不再自己持有 template。

### 4.3 渲染流程

```
stageChart(recipeId, input)
        ↓
getEChartsStageChartRecipeBuilder(recipeId) → RecipeBuilder
        ↓
RecipeBuilder(input) → { option_template, slots, transforms }
// option_template 含 $theme / $i18n ref，不含具体颜色/字符串
        ↓
存入 DashboardView.renderer.option_template（持久化）
        ↓
─── 渲染时 ───────────────────────────────────────────────
materializeEChartsOptionTemplate({
  template,          // option_template（含 $theme/$i18n ref）
  slots,             // slot 定义
  transforms,        // 数据变换（pivot_rows, generate_series）
  bindingResults,    // 查询结果（含 status: "ok" | "error" | "loading"）
  presentation,      // { themeId, chartLabels }
})
        ↓
ECharts.setOption(materializedOption)
```

`materializeEChartsOptionTemplate` 主入口位于 `src/renderers/echarts/browser/materialize-option.ts`，按职责拆分为同文件 helper：

```typescript
injectBindingResultIntoEChartsOptionTemplate(...) // slot 路径注入 + 数据变换
applyRendererTransforms(...)                      // pivot_rows / generate_series 等数据变换
mergeResponsiveEChartsTemplate(...)               // 响应式断点合并
// $theme / $i18n 解析在 src/presentation/dashboard/{themes,chart-i18n}.ts
// view-style 变换在 recipes 层 builder 中应用
materializeEChartsOptionTemplate(...)             // 组合以上 helper + clone(template)
```

### 4.4 校验

server-side 和 browser-side 使用**相同的校验逻辑**，但执行位置不同：

- `src/renderers/echarts/server/validate-option.ts` — server 执行（`runCheck` 工具调用）
- `src/renderers/echarts/browser/validate-option.ts` — browser 执行（可选，避免重复）

server 校验针对 compatibility-migrated 后的 renderer，而非原始存储模板。

### 4.5 ECharts 实例、容错与 BindingResult 状态契约

每个 view 的渲染由 `useEChartsChart` hook 管理，被 React `ErrorBoundary` 包裹：

- 单 view 渲染异常**不传染**整个 dashboard
- 增量更新使用 `setOption(option, { notMerge: false })`，避免不必要的全量重建
- view 卸载时自动 `dispose()` 释放 ECharts 实例

**BindingResult 状态契约**：

```typescript
type BindingResult =
  | { status: "loading" }
  | { status: "ok"; rows: Row[]; meta: ResultMeta }
  | { status: "error"; code: string; message_i18n_key: string };
```

`deriveRenderedViews` 在所有 binding `status === "ok"` 时才调用 `materializeEChartsOptionTemplate`。其它情况：

- 任一 binding `status === "loading"` → view 渲染骨架屏（Skeleton）
- 任一 binding `status === "error"` → view 渲染错误占位（ChartErrorPlaceholder），不调用 materialize，避免污染快照

错误占位组件展示 `message_i18n_key` 解析后的本地化文案（见 §13），同时提供"重试"按钮，仅重新执行失败的 binding，不刷新其它视图。

### 4.6 关键文件

| 文件 | 职责 |
|------|------|
| `src/renderers/echarts/browser/materialize-option.ts` | option 物化主入口 + 同文件 helper |
| `src/renderers/echarts/recipes/chart-recipe-registry.ts` | Recipe 注册表，唯一查找入口 |
| `src/renderers/echarts/recipes/stage-chart-recipe-types.ts` | Recipe 类型定义 |
| `src/renderers/echarts/server/validate-option.ts` | server-side 校验 |
| `src/presentation/dashboard/themes.ts` | `$theme` token 解析 |
| `src/presentation/dashboard/chart-i18n.ts` | `$i18n` ref 解析 |
| `src/ai/authoring/skills/registry.ts` | AI skill registry（意图与查询，option template 通过 recipe-build 桥接） |
| `src/contracts/dashboard-chart-recipes.ts` | Recipe ID 字面量来源 + 双 registry 编译期 cross-check |
| `src/web/dashboard/render/chart-error-placeholder.tsx` (new) | BindingResult 错误占位组件 |

---

## 5. 可观测性架构

### 5.1 设计目标

- 结构化事件采集，覆盖 Agent turn 全生命周期
- 统一通过 **`ObservabilityBus`** (new) 发出，支持多 sink（JSONL 文件、OpenTelemetry、Postgres、S3 归档等）
- 上层代码不感知具体 sink，sink 切换不影响调用方
- 同一 session 的事件保证写入顺序

### 5.2 核心接口

```typescript
// src/server/logs/observability.ts (new)

interface ObservabilityEvent {
  type: string;        // "agent.turn.start" | "tool.call" | "query.execute" | ...
  sessionId: string;
  dashboardId: string | null;
  turnId: string | null;
  requestId: string;   // 跨服务请求关联，由 requireServerSession 注入
  timestamp: string;   // ISO8601
  payload: unknown;
  level: "info" | "warn" | "error";
  status?: "active" | "completed" | "errored";
}

interface LogSink {
  write(event: ObservabilityEvent): Promise<void>;
  flush?(): Promise<void>;
}

class ObservabilityBus {
  register(sink: LogSink): void;
  emit(event: ObservabilityEvent): void;  // 非阻塞
}
```

**串行化机制（内部约定）**：

- `ObservabilityBus` 内部维护 `Map<sessionId, Promise<void>>`，每次 `emit` 把新事件 chain 到该 sessionId 的最后一个 Promise 后
- `Promise.all(sinks.map(s => s.write(...).catch(logSinkError)))` 保证多 sink 并行写，单 sink 失败不阻塞其它
- 同一 sessionId 的事件按 emit 顺序写入，跨 sessionId 完全并行
- 进程退出前 `await observability.flushAll()` 排空所有队列

**`level` 与 `type` 正交规则**（避免冗余）：

- `type` 描述**事件类别**（前缀分组 `agent.*` / `query.*` / `error.*` 等，见 §5.3）
- `level` 描述**系统响应严重度**：
  - `info`：正常流程
  - `warn`：异常但可自动恢复（retry 成功、quota 接近、单 query 失败但 batch 继续）
  - `error`：需告警，系统已无法自动恢复（未捕获异常、session 持久化失败、全 batch 失败）
- `type` 中含 `error` / `timeout` 不强制 `level === "error"`。例：`query.error` 可以是 `level: "warn"`（其它 query 仍正常）；`error.unhandled` 必须 `level: "error"`

**调用示例**：

```typescript
import { observability } from "@/server/logs/observability";

observability.emit({
  type: "agent.tool.call",
  sessionId,
  dashboardId,
  turnId,
  requestId,
  timestamp: new Date().toISOString(),
  level: "info",
  payload: { toolName, args },
});
```

### 5.3 内置 sink

| Sink | 默认启用 | 职责 |
|------|---------|------|
| `JsonlFileSink` | 是 | 所有事件写入 `logs/sessions/.../trace.jsonl` |
| `AiTraceJsonlSink` | 是 | 白名单事件镜像到 `trace.ai.jsonl`，高信噪比 |
| `ConsoleSink` | 仅 dev | 开发模式下 stderr 输出，便于本地调试 |
| `OpenTelemetrySink` | 可选 | 通过 ENV 启用，转发到 OTel collector |
| `SentrySink` | 可选 | `level: "error"` 事件转发到 Sentry |

新增 sink 通过 `src/server/config/observability-config.ts` 在启动时按 ENV 注册。

### 5.4 事件分类（标准事件类型）

| 前缀 | 事件示例 | 含义 |
|------|---------|------|
| `agent.*` | `agent.turn.start`、`agent.turn.end`、`agent.tool.call`、`agent.tool.result`、`agent.step.finish` | Agent turn 生命周期 |
| `query.*` | `query.start`、`query.complete`、`query.error`、`query.timeout` | 查询执行 |
| `document.*` | `document.draft.stage`、`document.patch.compose`、`document.patch.apply`、`document.publish`、`document.migrate` | Document 变更链路 |
| `render.*` | `render.materialize.start`、`render.materialize.error`、`render.validate.fail` | 渲染阶段 |
| `auth.*` | `auth.session.create`、`auth.session.expire`、`auth.session.invalid`、`auth.session.forbidden` | 认证与授权 |
| `quota.*` | `quota.exceeded`、`quota.warning` | 容量上限相关（见 §8） |
| `rate_limit.*` | `rate_limit.exceeded` | 限流相关（见 §8.4） |
| `stream.*` | `stream.request.start`、`stream.ui.step_finish`、`stream.ui.finish` | HTTP SSE 流相关 |
| `error.*` | `error.unhandled` | 所有层的未捕获异常（必 `level: "error"`） |

### 5.5 AI Trace 白名单

```typescript
// src/server/logs/sinks/ai-trace-sink.ts (new)
const AI_TRACE_EVENT_WHITELIST = new Set([
  "agent.turn.start",
  "agent.turn.end",
  "agent.turn.error",
  "agent.step.prepare",
  "agent.step.finish",
  "agent.inspect.decision",
  "agent.goal.declared",
  "agent.tool.protocol_error",
  "stream.request.start",
  "stream.ui.step_finish",
  "stream.ui.finish",
]);
```

新增 AI 相关事件需同步白名单，否则只会出现在 `trace.jsonl` 中。

### 5.6 日志文件结构

```
logs/sessions/
└── dashboard-{sha256[:24]}/        # dashboardId hash
    ├── manifest.jsonl               # session 索引，每条包含 traceFile 引用
    └── session-{sha256[:24]}/       # sessionId hash
        ├── trace.jsonl              # 完整 trace（所有事件）
        ├── trace.ai.jsonl           # AI 专用 trace（白名单事件）
        └── agent-events.jsonl       # Agent ledger（tool call/result 详情）
```

路径使用 SHA-256 前 24 位 hash（`src/server/logs/session-log-paths.ts`），避免文件名长度和特殊字符问题。

**Trace 文件 Rotation**：单 session 的 `trace.jsonl` 超过 50MB 自动 rotate 为 `trace.{N}.jsonl`，保留最近 10 个；超出后归档至 `logs/archive/`，由后台任务定期清理（默认 30 天）。

### 5.7 可观测性工具层

- **Trace viewer API**：`GET /api/authoring/trace`，读取 `manifest.jsonl` 和 `trace.ai.jsonl`
- **Metrics**：Agent turn 时长、tool 调用频率、查询 P95 延迟 — 从事件流聚合，无需额外打点
- **Alerting**：`level: "error"` 事件由 `SentrySink` / `OpenTelemetrySink` 路由到告警系统

---

## 6. Auth 与权限架构

### 6.1 统一入口：`requireServerSession`

**所有 server-side API 路由的第一行代码必须是 `requireServerSession(req)`** (new)。该函数返回 `UserSession`，是 identity 的唯一来源。禁止从 query string / body 读取 `userId` / `workspaceId` 等 identity 字段。

```typescript
// src/server/auth/require-session.ts (new)
import { cookies } from "next/headers";

interface UserSession {
  userId: string;
  workspaceId: string;       // 当前激活的 workspace
  permissions: Set<Permission>;
  sessionId: string;         // session token ID（用于 trace 关联）
  requestId: string;         // 当前请求关联 ID，写入 observability 事件
  issuedAt: number;          // epoch ms
  expiresAt: number;         // epoch ms
}

async function requireServerSession(): Promise<UserSession> {
  // 1. 从 HTTP-only cookie "sds_session" 取 token
  // 2. 验证 JWT 签名（HS256，密钥从 SDS_SESSION_SECRET 中按 kid 选择，支持轮换）
  // 3. 验证 expiresAt > now
  // 4. 查 user_revocations 表（小表，可缓存 60s）确认用户未被撤销
  // 5. 返回 UserSession；任何失败 throw new ApiError(401, "AUTH_REQUIRED")
}
```

**ESLint 强制规则** (new)：`src/app/api/**/*.ts` 中禁止出现 `req.json()` 后读取 `userId` / `workspaceId`、`searchParams.get("userId" | "workspaceId")`（custom rule `no-identity-in-request`，违反即 fail CI）。

### 6.2 Session 签发与续期

```
登录路由 POST /api/auth/login
  ├─ 验证凭证（密码哈希 / OAuth callback / SSO assertion）
  ├─ 签发 JWT { kid, userId, workspaceId, permissions, iat, exp: now + 7d, jti }
  └─ Set-Cookie: sds_session={jwt}; HttpOnly; Secure; SameSite=Lax; Path=/

续期路由 POST /api/auth/refresh
  ├─ 验证旧 token 仍在 grace period（exp 后 24h 内）
  └─ 签发新 token，覆盖 cookie

登出路由 POST /api/auth/logout
  └─ Set-Cookie: sds_session=; Max-Age=0
  └─ 可选：在 session_revocations 写入 jti 立即失效
```

### 6.3 JWT 密钥轮换

JWT 签发与验证支持密钥轮换，避免轮换瞬间所有 in-flight session 失效：

- ENV `SDS_SESSION_SECRETS` 为 JSON：`{ "current": { "kid": "k2", "secret": "..." }, "previous": [{ "kid": "k1", "secret": "..." }] }`
- 签发：永远使用 `current.secret`，JWT header 写入 `kid: "k2"`
- 验证：根据 JWT header 中的 `kid` 在 current + previous 中查找密钥
- 轮换流程：新增 `current`，旧 current 降级为 `previous[0]`；保留 `previous` 至少 1 个完整 TTL 周期（默认 7 天）

### 6.4 CSRF 防护

HTTP-only cookie 阻止 XSS 窃取 token，但**不阻止 CSRF**。同站请求伪造仍可触发 mutating 操作。

**所有 mutating 路由（POST/PUT/DELETE/PATCH）必须通过以下两关之一**：

1. **Origin / Referer 校验**（默认）：`requireServerSession` 同时校验 `Origin` header（或缺失时回退 `Referer`）必须属于 ENV `SDS_ALLOWED_ORIGINS` 白名单。校验失败 → 403 `CSRF_INVALID_ORIGIN`。
2. **CSRF token**（可选加强）：登录时签发与 session 绑定的 CSRF token（双重 cookie 模式），前端在 mutating 请求头 `X-CSRF-Token` 中带上，服务端校验。

GET / HEAD 路由不校验 CSRF（按 HTTP 语义应为幂等）。

### 6.5 权限模型

```typescript
type Permission =
  | "dashboard.read"
  | "dashboard.edit"
  | "dashboard.publish"
  | "datasource.read"
  | "datasource.manage"
  | "workspace.admin";
```

| 权限 | 含义 | 关联工具/路由 |
|------|------|----------------|
| `dashboard.read` | 查看仪表盘 | `GET /api/dashboards/*`、Viewer 全部 |
| `dashboard.edit` | 编辑（触发 Agent，stage、composePatch、apply） | 所有 authoring `author` 类工具 |
| `dashboard.publish` | 发布 | `POST /api/dashboards/[id]/publish` |
| `datasource.read` | 查看数据源 | `getDatasources`、`listDatasourceTables`、`getTableSchema`、`previewTableData` |
| `datasource.manage` | 管理数据源配置 | `POST /api/datasources/*` |
| `workspace.admin` | 管理工作区（成员、配额、删除） | 管理 UI 后端 |

**权限粒度边界**：当前模型为 workspace-level，未实现 dashboard-level / view-level 细粒度授权。理由：单团队场景内 dashboard 是协作资产，过细授权制造负担。未来如需，扩展点见 §6.7。

**权限校验**通过装饰器函数集中表达：

```typescript
const session = await requireServerSession();
requirePermission(session, "dashboard.edit");  // 缺失 throw ApiError(403, "FORBIDDEN")
```

工具层在 `AUTHORING_TOOL_REGISTRY` 中声明 `requiredPermissions: Permission[]`，由 `WorkspacePolicy.derive(session)` 在 turn 入口过滤一次，模型永远看不到无权限工具。

### 6.6 权限变更的传播延迟（ADR-06 决策）

`permissions` 写入 JWT claims，**用户被 grant/revoke 新权限后，已签发的 token 仍为旧 permissions**，最长滞后 = JWT TTL（默认 7d）。

**接受滞后**，理由：
- 每请求查 DB 取 permissions 的成本不可忽视（P95 +5–15ms）
- 单团队场景下，权限变化频率低
- 紧急撤销可走 `session_revocations` 表（`requireServerSession` 验证 `jti` 是否在 revocations 中，配 60s 缓存）

**用户感知**：管理 UI 标注"权限变更可能在 7 天内逐步生效；如需立即生效，请要求受影响用户登出后重新登录"。

### 6.7 前端登录态

- `LocalAuthSession` 完全删除；前端不再持有 token
- `fetch` 调用全部加 `credentials: "include"`：技术上 same-origin 默认带 cookie，但**统一显式声明**避免跨域 / SSR 场景的细微差异
- SSR Server Component 中 `fetch` 需手动转发 cookie：通过 `headers()` 读取并在 `fetch` 时设 `headers: { cookie }`，封装在 `src/web/api/server-fetch.ts`
- 任何路由返回 401 → 前端 router 跳转 `/login`，登录成功后回跳
- 多 tab：cookie 全局共享；任一 tab 登出后，其它 tab 的下一次请求即失败重定向

### 6.8 扩展路径

不改动 API 边界签名，只替换 `requireServerSession` 内部实现：

- **多租户**：`UserSession` 加 `tenantId`，`WorkspacePolicy` 加 tenant 维度过滤
- **细粒度 RBAC**：`UserSession.permissions` 改为按 resource ID 的 ACL 映射；`requirePermission` 接收资源 ID 参数
- **API token / SDK access**：新增 `requireApiToken` 中间件，返回同形状 `UserSession`
- **SSO / OAuth**：替换 `/api/auth/login` 实现，JWT 签发与验证逻辑不变

---

## 7. 失败模式与降级

每种可能失败都有明确的检测、传播、降级策略。所有失败统一通过 `ObservabilityBus` emit `error.*` 或 `level: "error"` 事件。

### 7.1 失败模式矩阵

| 失败类别 | 检测方式 | 用户可见行为（UI 规约） | 系统行为 |
|---------|---------|----------------------|---------|
| **数据源连接失败** | 查询层 retry 1 次 + 5s 超时 | 单 view ChartErrorPlaceholder + 重试按钮 | emit `query.error` (warn)，bindingResult `status: "error"` |
| **数据源查询慢（>30s）** | 查询超时 | 同上，文案"查询超时" | emit `query.timeout` (warn)，取消查询 |
| **数据源 schema 漂移**（字段缺失/类型变更） | runCheck / 查询执行返回 schema error | 单 view 占位 + "数据源结构已变更" 引导用户重新生成 | emit `query.error` (warn)，code: `SCHEMA_DRIFT` |
| **模型超时（>60s）** | pi-agent 硬超时 | SSE 流送 `agent.turn.error.timeout`；Authoring 面板 toast + "重试本轮" 按钮 | emit `agent.turn.error` (warn)；session 状态保留 |
| **模型 transient error** | 网络 / 429 | 透明 retry（最多 2 次，指数退避 1s/3s） | emit `agent.tool.protocol_error` (info) |
| **模型生成不合法工具调用** | tool schema 校验失败 | 模型收到 `tool_protocol_error`，自行修正 | emit `agent.tool.protocol_error` (warn)；累计失败 3 次该工具从 surface 移除 |
| **`runCheck` 失败** | server 校验返回 errors | Agent 在同 turn 内修正 / 转 chat 说明 | emit `render.validate.fail` (info)；errors 写入 WorkingDraft |
| **`composePatch` 后 baseVersion 不匹配** | applyPatch 前置校验 | Approval Card 替换为"文档已被他人修改，请刷新"，提供刷新按钮 | emit `document.patch.apply.stale` (warn)；proposal 作废 |
| **Approval TTL 过期（>10min）** | applyPatch 前置校验 `expires_at` | Approval Card 倒计时归零自动转为"审批已超时"，提供"重新生成"按钮 | emit `document.patch.apply.expired` (warn)；proposal 作废 |
| **同 session 并发 turn** | Stream queue 串行化 | 后请求在前请求完成前排队（loading indicator 显示"前一请求处理中"） | chat-service 内建 queue 已实现 |
| **同 dashboard 多 tab 编辑** | `baseVersion + fingerprint` 拦截 | 后写者收到 stale 错误，提示刷新 | 已由 ADR-01 三件套覆盖 |
| **ECharts 渲染 throw** | React `ErrorBoundary` | 单 view ChartErrorPlaceholder + "渲染失败"；其它 view 不受影响 | emit `render.materialize.error` (warn) |
| **Session trace 文件膨胀** | 写入前检查文件大小 | 透明 | 超 50MB 自动 rotate（见 §5.6） |
| **持久化失败（DB / FS）** | 仓储层抛错 | applyPatch / publish 返回 500；前端 toast + 重试按钮 | emit `error.unhandled` (error)；session 标记 `errored` |
| **认证失效 / 过期** | `requireServerSession` 抛 401 | 前端 router 跳转 `/login`，回跳保留 deep link | emit `auth.session.invalid` (warn) |
| **CSRF 校验失败** | `requireServerSession` 抛 403 | 前端 toast "请求来源不合法"；通常说明 cookie 跨站滥用 | emit `auth.session.forbidden` (warn) |
| **权限不足** | `requirePermission` 抛 403 | 前端 toast / 模态"无权限执行此操作"（不暴露具体缺失权限名） | emit `auth.session.forbidden` (warn) |
| **容量上限触发** | guards 层拒绝 | 模态展示具体上限说明 + 升级 / 拆分建议 | emit `quota.exceeded` (warn)（见 §8） |
| **限流触发** | rate limit 层拒绝 | toast "请求过于频繁，请稍后重试"，附下次允许时间 | emit `rate_limit.exceeded` (warn)（见 §8.4） |

### 7.2 降级原则

1. **隔离单点**：单 view 失败不影响其他 view；单 session 失败不影响其他 session；单 sink 失败不影响其它 sink
2. **保留状态**：失败后 session/draft 状态保留，用户可重试而非重新开始
3. **明确反馈**：所有用户可见的失败必须有人类可读的 i18n 文案（见 §13），禁止暴露 stack trace 或内部 error code
4. **可观测**：所有失败必有对应 event，且 `payload` 含足够上下文（requestId、相关实体 ID、错误代码）

### 7.3 重试策略

只有以下场景内置自动重试：

| 场景 | 策略 |
|------|------|
| 数据源连接失败 | 1 次 retry，指数退避（500ms → 1500ms） |
| Session 持久化失败（瞬时） | 1 次 retry，立即 |
| 模型 transient error（网络、429） | pi-agent 默认 2 次 retry，指数退避（1s → 3s） |

**禁止重试**：模型语义错误、合约校验失败、TTL 过期、权限不足、CSRF 失败、容量超限——这些需要用户介入，不属于"自动可恢复"。

---

## 8. 容量、限流与硬上限

系统在 **Application Layer** 边界统一拒绝超过硬上限的请求；超限即 fail-fast 返回标准错误，**不允许静默裁切**。所有上限集中声明在 `src/server/guards/quotas.ts` (new)，由 ENV 可覆盖；限流规则集中在 `src/server/guards/rate-limit.ts` (new)。

### 8.1 硬上限表（Quotas）

| 维度 | 默认上限 | 可覆盖 ENV | 拒绝点 | 错误代码 |
|------|---------|-----------|--------|---------|
| 单 dashboard view 数 | 50 | `SDS_QUOTA_VIEWS_PER_DASHBOARD` | `publish` / `applyPatch` | `QUOTA_VIEWS_PER_DASHBOARD` |
| 单 dashboard query 数 | 100 | `SDS_QUOTA_QUERIES_PER_DASHBOARD` | 同上 | `QUOTA_QUERIES_PER_DASHBOARD` |
| 单 dashboard 文档大小 | 2 MB（序列化后） | `SDS_QUOTA_DOCUMENT_SIZE_MB` | 同上 | `QUOTA_DOCUMENT_SIZE` |
| 单 query 返回行数 | 10,000 | `SDS_QUOTA_QUERY_ROWS` | 查询执行层 | `QUOTA_QUERY_ROWS` |
| 单 query 返回大小 | 5 MB | `SDS_QUOTA_QUERY_BYTES` | 查询执行层 | `QUOTA_QUERY_BYTES` |
| 单 execute-batch 并发 query 数 | 20 | `SDS_QUOTA_BATCH_SIZE` | execute-batch 入口 | `QUOTA_BATCH_SIZE` |
| 单 turn agent step 数 | 16（`AUTHOR_TOOL_STEP_LIMIT`） | — | `AuthoringScopeManager.onToolResult` | 转 chat-only（不抛错） |
| 单 turn 模型 input token | 32,000 | `SDS_QUOTA_MODEL_INPUT_TOKENS` | pi-agent 配置 | `QUOTA_MODEL_INPUT_TOKENS` |
| 单 turn 模型 output token | 8,000 | `SDS_QUOTA_MODEL_OUTPUT_TOKENS` | pi-agent 配置 | `QUOTA_MODEL_OUTPUT_TOKENS` |
| 单 session trace 文件 | 50 MB | `SDS_QUOTA_TRACE_FILE_MB` | trace writer | 自动 rotate（不抛错） |
| 并发 turn / session | 1 | — | chat-service stream queue | 排队（不抛错） |
| 并发 session / workspace | 50 | `SDS_QUOTA_SESSIONS_PER_WORKSPACE` | session 创建 | `QUOTA_SESSIONS_PER_WORKSPACE` |
| Dashboard / workspace | 200 | `SDS_QUOTA_DASHBOARDS_PER_WORKSPACE` | dashboard 创建 | `QUOTA_DASHBOARDS_PER_WORKSPACE` |
| Storage / workspace（trace + 文档） | 10 GB | `SDS_QUOTA_STORAGE_GB` | 后台 sweeper 检测 | `QUOTA_STORAGE_GB`（仅告警，不阻塞写入） |

**调高指引**：大团队预期超出默认值时，统一通过 ENV 覆盖，禁止在业务代码 hardcode。调整需在 `docs/operations.md`（部署文档）中记录变更历史。

### 8.2 错误形状

```typescript
{
  "error": {
    "code": "QUOTA_VIEWS_PER_DASHBOARD",
    "message_i18n_key": "error.quota.views_per_dashboard",
    "limit": 50,
    "current": 51,
    "scope": "dashboard",
    "scope_id": "dash_xxx"
  }
}
```

前端通过 `message_i18n_key` 解析本地化文案（见 §13）。

### 8.3 配额监控与告警

- 所有 `QUOTA_*` 拒绝 emit `quota.exceeded` 事件，payload 含 `{ code, limit, current, scope_id }`
- 当用量达到上限 80% 时 emit `quota.warning` 事件，由后台任务批量聚合后发邮件给 `workspace.admin`
- 管理 UI 提供 workspace 用量仪表盘：实时显示各维度占比，标红 ≥ 80%

### 8.4 限流（Rate Limiting）

Quota 是绝对资源上限，**Rate Limit 是按时间窗口的请求频率上限**。两者正交。

| 路由分组 | 限流策略 | 触发响应 |
|---------|---------|---------|
| `/api/auth/login` | 5 次 / IP / 分钟 | 429 `RATE_LIMIT_LOGIN` + `Retry-After` |
| `/api/auth/refresh` | 10 次 / session / 分钟 | 429 `RATE_LIMIT_AUTH` |
| `/api/query/execute-batch`、`/api/query/preview` | 60 次 / user / 分钟 | 429 `RATE_LIMIT_QUERY` |
| `/api/authoring/chat/*/stream` | 30 次 / user / 分钟 | 429 `RATE_LIMIT_AGENT` |
| 其它 | 300 次 / user / 分钟 | 429 `RATE_LIMIT_GENERIC` |

实现：内存令牌桶（单实例部署足够）；多实例部署时切换 Redis 令牌桶（接口不变）。

---

## 9. 测试金字塔

测试策略明确分层，每层有清晰的目标、覆盖率要求与可接受的成本。

### 9.1 分层

```
┌─────────────────────────────────────────────────┐
│ E2E (Playwright, ~15 用例)                      │  慢、贵
│   登录 / 创建 dashboard / Agent 加 view / 发布   │  禁止断言模型语义
├─────────────────────────────────────────────────┤
│ Integration (Vitest + msw, ~80 用例)            │  中
│   chat-service 完整 turn（mock 模型输出）       │
│   execute-batch + 真实 DB（testcontainers）     │
│   applyPatch 三件套校验（base/fingerprint/TTL）│
├─────────────────────────────────────────────────┤
│ Contract (Vitest, ~300 用例) ★ 主防线 ★         │  快
│   contract-kernel 所有分支（含例外条款，见 ADR-10）│
│   capability-scope 所有 profile × scope 组合     │
│   tool-surface 所有优先级 + draft 子策略         │
│   materialize-option 每 recipe 多 case snapshot │
│   每个 quota / rate-limit 边界值                 │
└─────────────────────────────────────────────────┘
```

### 9.2 测试不变量

| 模块 | 必须满足 |
|------|---------|
| `contract-kernel` | 95%+ 分支覆盖（不含 ADR-10 例外条款）；任何 schema 变更须同步更新测试 |
| `capability-scope` | 每个 `AuthoringCapabilityProfile × AuthoringScope.kind` 组合至少 1 测试 |
| `tool-surface` | §3.4 中 7 个优先级分支各 1 测试；draft compose/stale 子策略各 1 测试 |
| `materialize-option` | 8 个 recipe 各至少 3 个 snapshot（标准数据 / 空数据 / 多系列），snapshot 文件按 recipe 分目录（`__snapshots__/{recipe-id}/`），变化必须人工 review |
| Quota guards | 每个 `QUOTA_*` 上限的 `==` 与 `+1` 两个边界值各 1 测试 |
| Rate limit | 每个分组的"窗口内 N 次通过、N+1 次拒绝"各 1 测试 |
| `requireServerSession` | 有效 token / 过期 token / 无 token / 篡改 token / 用户被撤销 / kid 不匹配 / CSRF 失败 共 7 种场景 |
| Migrations | 每个 migrator 有 fixture in/out 双侧测试 + 幂等测试 |

**覆盖率门槛**：CI 强制 `pnpm test:contract:coverage --branches=95 --statements=90 --functions=95`。覆盖率不变意味着新加代码必须带新测试。

### 9.3 不测试的部分

明确声明不进入测试体系，避免无意义投入：

- UI 像素差异（成本高，回报低，依赖人工 review）
- AI 模型本身的输出质量（外部依赖，无法稳定）
- ECharts 内部行为（外部依赖）
- 第三方数据源驱动的兼容性细节（依赖供应商）
- ADR-10 例外条款内的代码（如 unreachable defaults）

### 9.4 性能基准（Benchmark）

非强制测试，但下列基准随每次 release 跑一次并保存历史：

| 基准 | 目标 |
|------|------|
| 单 turn 完整 agent 循环（mock model） | P95 < 200ms |
| `materializeEChartsOptionTemplate` 单次（中等复杂度 view） | P95 < 5ms |
| `execute-batch` 10 个简单 query（本地 PG） | P95 < 500ms |
| `requireServerSession` 验证 | P95 < 3ms（含 revocations 缓存） |

CI 不阻塞，但回归超 2× 触发自动 issue。

### 9.5 CI 门槛

| 阶段 | 要求 |
|------|------|
| PR commit | 全部 Contract + Integration 测试通过；lint + type-check 通过；覆盖率门槛达标 |
| Merge to main | 上述 + E2E 全部通过 |
| Release | 上述 + 配额边界测试通过 + migration fixture 测试通过（见 §10）+ benchmark 不回归 |

---

## 10. Schema 版本与迁移

### 10.1 版本字段

`DashboardDocument.schema_version` 是显式字符串，格式 `MAJOR.MINOR`。

```typescript
type SchemaVersion = "1.0" | "1.1" | "2.0" | /* ... */;
const CURRENT_SCHEMA_VERSION: SchemaVersion = "1.0";
```

**版本号语义**：
- `MINOR` 变化：向后兼容（新增可选字段、扩展 enum、放宽校验）
- `MAJOR` 变化：破坏性（字段重命名、删除字段、收紧校验、结构重组）

### 10.2 迁移器（Migrator）

每次 schema 变更，新增一个 migrator，集中注册在 `src/server/dashboards/migrations/`：

```typescript
// src/server/dashboards/migrations/v1.0-to-v1.1.ts
export const migrate_1_0_to_1_1: Migrator = {
  from: "1.0",
  to: "1.1",
  apply(doc: DashboardDocument_v1_0): DashboardDocument_v1_1 {
    // 纯函数，必须幂等
  },
};
```

**Migrator 约束**：
- 必须**幂等**：apply(apply(doc)) === apply(doc)
- 必须**确定性**：相同输入产生相同输出（允许调用 `now()` 等的版本，须将该字段从 migrator 输出剥离）
- 允许查 DB 补充缺失字段（如关联 datasource 元数据），但需在测试 fixture 中固化该查询的预期返回
- **失败时抛 `MigrationError`**，不静默吞错

### 10.3 加载与持久化策略

```
GET /api/dashboards/[id]
  ├─ 从存储读出原始文档
  ├─ migrateToCurrent(doc) — 串联应用所有 migrator 至 CURRENT_SCHEMA_VERSION
  │   ├─ 成功：返回 migrated 文档
  │   └─ 失败：emit `document.migrate.error`，返回 502 `MIGRATION_FAILED`
  ├─ 校验 migrated 文档符合最新 contract（assertDashboardDocument）
  └─ 返回给前端（前端永远只见 CURRENT_SCHEMA_VERSION）

applyPatch / publish
  ├─ 写入前强制 schema_version = CURRENT_SCHEMA_VERSION（migrateToCurrent 已确保）
  └─ 这是 §10.3 与 §3.1 的契约：所有写入路径生成的文档必为最新 schema
```

**持久化时机**：迁移结果**不**立即回写存储；只有触发 `applyPatch` / `publish` 时整个文档以最新 schema 写回。这避免大规模 batch 写入对生产 DB 的冲击。如需主动 batch 迁移，运行 `pnpm script:migrate-all-dashboards`（offline 工具，限速可控）。

**Migration 失败的降级**：
- 加载失败：dashboard 在管理 UI 列表中标红"无法加载（schema 错误）"，提供"导出原始 JSON / 联系管理员"链接
- 不允许"部分 migrate 成功就保留"，全或无

### 10.4 Recipe / 工具的废弃

破坏性变更不限于字段，也包括 recipe 和工具的删除。三阶段建议时长：

| 阶段 | 建议时长 | 行为 |
|------|---------|------|
| Deprecated | ≥ 1 个 release（约 1 月） | Registry 保留；stage 时返回 warning；管理 UI / Authoring UI 显示"已废弃"标签 |
| Migrate | ≥ 1 个 release | 在 migrator 中加入"旧 recipe ID → 新 recipe ID + 字段映射"逻辑；用户通过 UI 触发"批量升级"按钮，或后台 sweeper 在 publish 时升级 |
| Remove | — | Skill registry 与 recipe registry 同时删除；旧文档加载时由 migrator 替换 |

**前提**：Deprecated 阶段必须有遥测数据证明残余使用量 < 1%；否则推迟 Remove 阶段。

### 10.5 测试要求

- 每个 migrator 必须有 fixture 测试：`fixture-v{from}.json` → migrator → 等于 `fixture-v{to}.json`
- 加幂等测试：`migrator(migrator(in)) === migrator(in)`
- 加"无版本字段文档自动补 v1.0"的测试（首次引入 schema_version 的兼容路径）
- CI 强制：CURRENT_SCHEMA_VERSION 变更必须伴随 migrator + fixture，否则拒绝合入

---

## 11. 数据流：Authoring 完整路径

用户发起一轮 authoring turn 的完整数据流：

```
1. 用户输入自然语言
   └─ Web: useAgentSession → POST /api/authoring/chat/[id]/stream
      (浏览器自动发送 sds_session cookie；Origin header 由浏览器自动加)

2. HTTP 层 turn 准备
   └─ route.ts
      ├─ requireServerSession() → UserSession        ★ 唯一 identity 入口
      ├─ CSRF 校验（Origin / Referer，POST 必查）
      ├─ requirePermission(session, "dashboard.edit")
      ├─ rate limit 检查（30/user/分钟）
      └─ chat-service.start(session, body)
         ├─ chat-session-orchestrator
         │   ├─ 加载 DashboardDocument（含 migrateToCurrent）
         │   └─ 加载 session 快照
         ├─ approval-preflight（拒绝过期/不匹配/已 reject 的 approvalEvent）
         ├─ AuthoringAgentSession 初始化
         │   ├─ sanitizeAgentMessages(transcript)
         │   └─ deriveConversationSignalsFromTranscript(...)
         └─ session.startTurn(config)

3. Scope 计算
   └─ computeAuthoringScope(AuthoringScopeInput)
      ├─ 分析 conversation signals（意图、focused view 等）
      ├─ 检查 stepHistoryInTurn（filterToolFailures，阈值 3）
      ├─ 应用 WorkspacePolicy.derive(session) ∩ AgentContextScope（见 §3.3）
      └─ 返回 AuthoringScopeCapabilities

4. Surface 构建
   └─ AuthoringScopeManager.buildSurfaceFromScope(scope)
      → resolveRuntimeToolSurface（含 draft compose/stale 子策略）
      → { mode, activeTools, toolChoice, promptSections, reason }

5. pi-agent 推理循环（含超时 60s、token 上限、step 上限、transient retry 见 §7.3）
   └─ Agent.prompt(messages, tools, systemPrompt)
      ├─ [model] 可能调用 stageChart(recipeId, intent)
      │   └─ getEChartsStageChartRecipeBuilder(recipeId)
      │   └─ 写入 WorkingDraft（内存）
      ├─ [model] 可能调用 runCheck()
      │   └─ validateOption(draftOption) → 校验报告
      ├─ [model] 调用 composePatch()
      │   └─ 生成 PendingProposal { proposalId, baseVersion, fingerprint, expires_at = now + 10min }
      └─ tool hook → observability.emit("agent.tool.*", ...)

6. SSE 流推送 Proposal 到客户端
   └─ web: authoring-stream-runner.ts 解析 SSE
   └─ 渲染 Approval Card（含 proposalId + fingerprint + 倒计时）

7. 用户点击 Approve
   └─ Web 发送 LocalApprovalEvent
   └─ POST /api/authoring/chat/[id]/stream（含 approvalEvent + cookie + X-CSRF-Token）

8. applyPatch 执行
   └─ requireServerSession + CSRF + requirePermission("dashboard.edit")
   └─ 验证 proposalId + baseVersion + fingerprint + expires_at > now
   └─ patch 写入 DashboardDocument（schema_version = CURRENT_SCHEMA_VERSION）
   └─ 容量校验（quota guards，见 §8.1）
   └─ 持久化 DashboardDocument

9. 触发查询执行
   └─ POST /api/query/execute-batch（requireServerSession + CSRF + rate limit + ExecuteBatchRequest）
   └─ server/execution → 数据源引擎 → BindingResults
      （单 query 失败不阻塞 batch；BindingResult.status 携带状态，见 §4.5）

10. 渲染结果推送
    └─ viewer-state 更新 bindingResults
    └─ deriveRenderedViews()
       ├─ 所有 binding status === "ok" → materializeEChartsOptionTemplate()
       ├─ 任一 binding status === "loading" → Skeleton
       └─ 任一 binding status === "error" → ChartErrorPlaceholder
    └─ useEChartsChart → ECharts.setOption(option)
       （单 view ErrorBoundary 隔离，见 §4.5）
```

---

## 12. 数据流：Viewer 渲染路径

已 publish 的 dashboard 从加载到渲染完成的路径：

```
1. 加载 DashboardDocument
   └─ GET /api/dashboards/[dashboardId]
      ├─ requireServerSession + requirePermission("dashboard.read")
      ├─ 从存储读取 + migrateToCurrent（见 §10.3）
      │   └─ migrate 失败：返回 502，前端展示"无法加载"
      └─ viewer-api.ts → ViewerSnapshot { dashboardDocument, ... }

2. 初始化 Viewer 状态
   └─ viewer-state.ts
      ├─ buildDefaultViewerFilterValues(document) → 默认过滤器值
      ├─ getDefaultTimeRange(document) → 默认时间范围
      └─ 构建 ExecuteBatchRequest（从 query_defs + bindings）

3. 批量查询执行
   └─ POST /api/query/execute-batch (requireServerSession + CSRF + rate limit)
   └─ 每个 Binding → 对应 datasource 执行 SQL
   └─ 返回 BindingResults Map<bindingId, BindingResult>
      （含失败 binding 的 status: "error" + code + message_i18n_key，见 §4.5）

4. 派生渲染状态
   └─ rendered-views.ts: deriveRenderedViews(views, bindings, statusMap, presentation)
      ├─ 每个 view: findBindingsForView(bindings, view.id)
      ├─ 若任一 binding status !== "ok" → 返回 Skeleton 或 ErrorPlaceholder 描述符
      ├─ 应用 transforms（pivot_rows, generate_series）
      └─ materializeEChartsOptionTemplate({...})

5. materializeEChartsOptionTemplate 内部执行
   └─ clone(template)                          // 避免污染存储模板
   └─ 注入 slot 数据（slot_path → 数组/单值）
   └─ 应用 transforms（pivot → series 数组）
   └─ resolveTheme($theme refs → 实际颜色 token)
   └─ resolveI18n($i18n refs → 本地化字符串，见 §13)
   └─ applyViewStyle(viewStyleId → option 调整)
   └─ mergeGrid(DEFAULT_GRID)
   └─ 返回 EChartsOption

6. 图表挂载
   └─ ErrorBoundary 包裹
   └─ useEChartsChart(option)     // 只负责 mount/update/resize
   └─ echarts.init(container)
   └─ ECharts.setOption(option)   // 最终渲染
```

**Filter 变更触发的刷新**：用户调整过滤器 → 重建 `ExecuteBatchRequest` → 重新执行步骤 3-6，无需重载 DashboardDocument。

---

## 13. 国际化（i18n）架构

### 13.1 设计原则

- 所有用户可见字符串走 i18n key，禁止 hardcode 中英文字面量到组件
- 模型 / 服务端错误以 `message_i18n_key` 字段返回，前端解析；服务端不返回拼接好的本地化文案
- 渲染层 `$i18n` ref 在 `materializeEChartsOptionTemplate` 中按当前 locale 解析

### 13.2 目录结构

```
src/web/i18n/
├── locales/
│   ├── zh-CN.ts          # 中文文案（默认）
│   ├── en-US.ts          # 英文文案
│   └── index.ts          # locale registry
├── keys.ts               # 所有 i18n key 字面量集中导出（用作类型与 lint 检查）
├── context.tsx           # I18nProvider + useTranslation hook
├── format.ts             # 数字 / 日期 / 货币格式化（基于 Intl）
└── AGENTS.md
```

### 13.3 Key 命名规范

`<feature>.<sub-area>.<purpose>`，例：

- `error.quota.views_per_dashboard`
- `authoring.approval.expired_message`
- `viewer.filter.apply_button`
- `chart.placeholder.loading`
- `chart.placeholder.error.schema_drift`

### 13.4 缺失 Key 行为

- **开发模式**：渲染显示 `⟦missing: error.quota.views⟧`，控制台 warn
- **生产模式**：渲染显示英文 fallback（en-US 总是必须完整）；emit `error.unhandled`，payload `{ code: "I18N_KEY_MISSING", key, locale }`

### 13.5 多语言切换

- locale 由 `Accept-Language` header + 用户偏好（存于 user_preferences 表）决定
- 切换 locale 不刷新页面，通过 React Context 重新渲染
- ECharts 内嵌字符串通过 `$i18n` ref，在 viewer-state 检测到 locale 变更时重新调用 `materializeEChartsOptionTemplate`

### 13.6 服务端 i18n

服务端只在以下场景输出本地化文案：
- 邮件通知（quota.warning 告警邮件）
- PDF / Excel 导出（未来）

这些场景在 `src/server/i18n/` 维护一份与前端同步的 key/locale 对照（构建时校验一致性）。

---

## 14. 数据存储与持久化

### 14.1 数据库

PostgreSQL 16，单实例（开发与生产）。表结构由 SQL migration 文件管理：

```
src/server/db/migrations/
├── 0001_init_workspace.sql       # workspaces, workspace_users
├── 0002_dashboards.sql           # workspace_dashboards
├── 0003_sessions.sql             # authoring_sessions
├── 0004_session_revocations.sql  # session_revocations (jti 黑名单)
├── 0005_user_preferences.sql     # 多语言偏好等
└── runner.ts                     # ensureCloudAuthoringSchema 调用入口
```

**Migration 工具**：自建 simple runner（不引入 Prisma / Drizzle，以控依赖）。规则：
- 文件名格式 `{seq:0000}_{snake_case_name}.sql`
- 单文件单 transaction
- 启动时 `ensureCloudAuthoringSchema` 检查 `schema_migrations` 表，按 seq 执行未应用文件
- 不支持 down migration；回滚靠新写一个 reverse migration

### 14.2 主要表

| 表 | 用途 | 关键约束 |
|----|------|---------|
| `workspaces` | 工作区元数据 | PK `id` |
| `workspace_users` | 用户 / workspace 成员关系 | UQ `(workspace_id, user_id)` |
| `workspace_dashboards` | dashboard 索引（id、name、归属 workspace、最新 schema_version） | PK `id`，FK `workspace_id` |
| `dashboard_documents` | `DashboardDocument` 完整 JSON + version + checksum | PK `(dashboard_id, version)` |
| `authoring_sessions` | session 状态快照 + 关联 dashboardId/userId | PK `id` |
| `session_revocations` | JWT jti 黑名单（紧急撤销） | PK `jti`，TTL 自动清理 |
| `user_preferences` | locale、theme、可见性偏好 | PK `user_id` |
| `quota_usage` | 每 workspace 用量缓存（异步聚合，避免每次 count） | PK `workspace_id` |

### 14.3 文档存储

`DashboardDocument` 完整 JSON 存 `dashboard_documents.document_jsonb`，每次写入 `version + 1`。Viewer 默认读 `version = (select max(version) from ... where dashboard_id = ?)`，启用 publish 后 publishedVersion 字段固定到具体版本。

**Backup**：DB 每日 `pg_dump` 至 S3-compatible 对象存储；保留 30 天。

### 14.4 日志与 trace

详见 §5.6。文件系统存储，按 dashboard / session hash 分目录。

### 14.5 缓存

- session_revocations 60s 内存 LRU 缓存（每实例）
- materialize / theme 解析不缓存（纯函数，调用方按需 memo）
- 查询结果不缓存（BI 数据时效性敏感）

---

## 15. 部署与运维

### 15.1 部署形态

**单体 Next.js Node.js 服务**（首选）：

```
┌─────────────────────────────────────────┐
│  Reverse Proxy (Nginx / Caddy)          │
│    - TLS 终止                            │
│    - 静态资源缓存                        │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  Next.js Node.js 进程（pm2 / systemd）   │
│    - Route Handlers（API）              │
│    - Server Components（SSR）           │
│    - SSE 流（authoring chat）           │
└─────────────────┬───────────────────────┘
                  │
   ┌──────────────┼──────────────┐
   │              │              │
┌──▼──┐    ┌──────▼─────┐  ┌────▼────────┐
│  PG  │    │  本地 FS   │  │  Object     │
│      │    │ logs/sess  │  │  Storage    │
│ 元数据│    │            │  │ (backup +    │
│ 数据源│    │            │  │  trace 归档)│
└──────┘    └────────────┘  └─────────────┘
```

**多实例扩展**（按需）：横向扩 Next.js 进程，前置负载均衡（sticky session 不需要——session 状态在 PG）。trace 文件改用 共享 NFS 或对象存储。Rate limit 切 Redis。

### 15.2 配置加载

所有 ENV 通过 `src/server/config/load.ts` (new) 集中加载，启动时校验：

```typescript
// src/server/config/load.ts
const schema = z.object({
  SDS_SESSION_SECRETS: zJsonObject,
  SDS_SESSION_TTL_DAYS: z.coerce.number().default(7),
  SDS_ALLOWED_ORIGINS: z.string().transform(s => s.split(",")),
  SDS_DATABASE_URL: z.string().url(),
  SDS_QUOTA_VIEWS_PER_DASHBOARD: z.coerce.number().default(50),
  // ... 其它 SDS_* 全部声明
  SDS_LLM_PROVIDER: z.enum(["openai", "anthropic", "mock"]),
  SDS_LLM_API_KEY: z.string(),
  // ...
});

export const config = schema.parse(process.env);
```

**未声明的 ENV 在启动时 fail-fast**，避免运行时才发现缺配置。`config` 对象在 hot path 上无性能开销（一次 parse，全局复用）。

### 15.3 启动 / 健康检查

- `GET /api/health` 返回 `{ status, schemaVersion, dbConnected, llmConfigured }`
- 启动顺序：load config → ensureCloudAuthoringSchema → 注册 sinks → bind port

### 15.4 后台任务

| 任务 | 触发方式 | 频率 |
|------|---------|------|
| Trace 文件清理（archive → delete） | systemd timer / cron | 每日 02:00 |
| Quota usage 重算 | systemd timer | 每 5 分钟 |
| Session revocations 过期清理 | DB trigger / cron | 每日 |
| 邮件批量发送（quota.warning 聚合） | cron | 每 30 分钟 |

**后台任务用同一份代码库的 CLI 入口**（`pnpm script:<name>`），避免单独 worker 服务。如未来增加，再独立成 `src/worker/`。

### 15.5 部署变更管理

- ENV 变更需在 `docs/operations.md` 记录
- DB migration 在生产部署前必须先在 staging 跑过
- Schema 1.0 → 2.0 这类 MAJOR 升级需要发布 changelog 与回退预案（即便不提供 down migration，至少要有"如果新版本启动失败如何回滚到旧二进制 + 旧 DB schema"的步骤）

---

## 16. 关键设计决策记录（ADR）

### ADR-01：Agent 只写 WorkingDraft，不直接变更 Document

**背景**：AI 模型会产生幻觉，生成不合法的 schema 结构。如果 Agent 直接修改文档，错误难以回滚，且用户无法在变更生效前审查。

**决策**：Agent 工具只写内存中的 `WorkingDraft`。`DashboardDocument` 的变更路径必须经过 `composePatch → 用户 Approval → applyPatch`。`PendingProposal` 携带 `proposalId + baseVersion + fingerprint + expires_at`，applyPatch 时四项全部校验。

**理由**：
1. `runCheck` 在 compose 前校验 draft，拦截合约错误
2. fingerprint 防 TOCTOU（用户 approve 后文档已被他人修改）
3. `expires_at` 防长时间挂起的 approval 卡片被误用
4. 用户 Approval 是业务上的确认节点，非纯技术约束

**后果**：每轮 authoring 至少需要两轮网络请求（compose + apply）。引入 proposal-approval 状态机，前端需管理 Approval Card 生命周期与 TTL 倒计时。

---

### ADR-02：RecipeRegistry 单一注册表 + 编译期 cross-check

**背景**：AI skill 与 renderer 都需要描述"图表类型"，若各自维护 option template，必然产生漂移。

**决策**：`src/renderers/echarts/recipes/chart-recipe-registry.ts` 是 ECharts option template 的唯一来源。AI skill 通过 `recipe_id` 引用，不重复定义模板。Skill registry 仅保留"AI 意图与查询构造"职责（`buildQueryDef` / SQL / prompt 示例）。Recipe ID 字面量集中在 `src/contracts/dashboard-chart-recipes.ts`，**通过类型层等式 (new) 强制两个 registry 必须同时覆盖每个 ID**。

**理由**：renderer 比 AI skill 更稳定，recipe 是渲染层概念，不应泄漏到 AI 层；编译期 cross-check 避免运行时才发现遗漏。

**后果**：新增图表类型必须在 ID 字面量 + skill registry + recipe registry 三处同步添加，否则编译失败（这是设计意图）。

---

### ADR-03：materializeOption 纯函数，server/browser 共用

**背景**：如果 server-side 预渲染和 browser-side 渲染使用不同代码路径，调试成本翻倍，且 server validation 无法准确预测 browser 渲染结果。

**决策**：`materializeEChartsOptionTemplate` 是纯函数，无副作用，同一函数在 server（`runCheck`）和 browser（viewer）调用。

**理由**：纯函数天然可测试，确保 server 校验结果与 browser 渲染结果语义一致。

**后果**：函数不能使用任何浏览器 API 或 Node.js 专用 API。`$theme`/`$i18n` ref 解析依赖外部注入的 `presentation` 上下文，而非全局状态。

---

### ADR-04：ObservabilityBus + LogSink 标准接口

**背景**：多 sink 支持（本地 JSONL、OpenTelemetry、Postgres、S3 归档）应不影响上层调用方；同一 session 的事件顺序必须可靠。

**决策**：所有可观测事件统一通过 `observability.emit(event)` 发出。`ObservabilityBus` 按 `sessionId` 串行化写入（`Map<sessionId, Promise>` chain）；sink 通过 `register(sink)` 装配。默认两个 sink：`JsonlFileSink`（完整 trace）+ `AiTraceJsonlSink`（白名单事件镜像）。事件类型遵循 §5.4 命名规范，`level` 与 `type` 正交（§5.2）。

**理由**：接口稳定的代价极低，但使 sink 切换、采样、redaction 等横切关注点可在 sink 层独立实现，不污染业务代码。

**后果**：所有原始 `writeSessionTraceEvent` 调用方迁移到 `observability.emit`；事件类型从 `{scope}.{event}` 改为 §5.4 标准命名。

---

### ADR-05：WorkspacePolicy 与 AgentContextScope 分离

**背景**：工具可见性受两类因素影响：用户权限（静态，来自 Auth）和对话状态（动态，来自对话历史）。混合管理会导致两类变更原因交织。

**决策**：`WorkspacePolicy`（权限）由 Auth Layer 管理，从 `UserSession.permissions` 派生；`AgentContextScope`（对话语境）由 Agent Layer 管理，从 conversation signals 派生。最终可见工具是两者的**交集**。

**理由**：权限变更（新增角色）不应触碰 Agent 的对话逻辑；对话意图变化（增加新工具触发条件）不应触碰权限系统。职责单一。

**后果**：工具注册需要同时声明 `requiredPermissions` 和 `readScopes`/`authorScopes` 两个维度的 metadata。

---

### ADR-06：Auth 统一 `requireServerSession`，cookie-based JWT，接受 7d 权限滞后

**背景**：API 边界的 identity 必须服务端验证，禁止客户端声明身份。session token 用 HTTP-only cookie 传递，避免 XSS 暴露。

**决策**：
1. 所有 server-side 路由第一行 `requireServerSession() → UserSession`
2. Token 为 HS256 JWT，存放在 `sds_session` HTTP-only cookie，支持密钥轮换（kid 选择）
3. Mutating 路由（POST/PUT/DELETE/PATCH）追加 CSRF 校验（Origin / Referer 白名单）
4. `permissions` 写入 JWT claims，**接受最长 7d 滞后**；紧急撤销走 `session_revocations` 表 + 60s 缓存
5. Lint 规则强制禁止从 `req.json()` / `searchParams` 读 `userId` / `workspaceId`
6. 前端不持有 token，依赖浏览器 cookie 机制；401 → 跳转 `/login`

**理由**：最小安全原则——客户端不应能声称任意身份。权限滞后是性能/复杂度的合理 trade-off，紧急撤销有 escape hatch。

**后果**：旧 `LocalAuthSession` localStorage 机制完全删除；前端 `fetch` 全部加 `credentials: "include"` + `X-CSRF-Token`；token 签发与续期路由（`/api/auth/login` / `/refresh` / `/logout`）成为新的 API 入口；管理 UI 文案说明权限滞后规则。

---

### ADR-07：失败模式矩阵 + 隔离单点原则

**背景**：BI 系统失败来源众多（数据源、模型、网络、并发、容量），如不集中管理，错误处理分散在各层，用户体验和可观测性都会崩坏。

**决策**：在 §7.1 集中维护"失败模式矩阵"，每种失败明确：检测方式、用户可见行为（UI 规约）、系统行为。所有失败 emit `error.*` 或 `level: "error"` 事件。降级遵循"隔离单点 / 保留状态 / 明确反馈 / 可观测"四原则。

**理由**：明确的失败枚举比"通用错误处理框架"更有价值——后者倾向于隐藏问题，前者强制每种失败被 review。

**后果**：新增失败模式必须更新矩阵 + 加 contract test + 加 i18n 文案；不允许仅 `try/catch` 后吞掉。

---

### ADR-08：硬性容量上限 + 路由级限流，fail-fast 拒绝

**背景**：BI 系统的资源消耗对边界值极敏感（一个超大 dashboard 能拖垮渲染、一个超大 query 能拖垮 DB、单用户高频请求能影响他人）。静默裁切产生比拒绝更难追查的 bug。

**决策**：
1. **Quotas**：所有容量上限集中在 `src/server/guards/quotas.ts`，Application Layer 边界统一拒绝超限请求，返回标准 `QUOTA_*` 错误（见 §8.2）。ENV 可覆盖
2. **Rate Limit**：路由级令牌桶（§8.4），登录、查询、Agent 各分组独立上限
3. 用量达 80% emit `quota.warning`，由后台任务聚合发邮件

**理由**：明确拒绝优于静默裁切；quota 与 rate limit 是不同维度（绝对量 vs 频率），分开建模避免概念混淆。

**后果**：管理 UI 需展示当前用量；前端对 `QUOTA_*` / `RATE_LIMIT_*` 错误做友好提示；容量调整需走 ENV / config，不允许在业务代码内 hardcode。

---

### ADR-09：Schema 显式版本化 + 自动迁移

**背景**：Dashboard 文档是长生命周期资产，schema 变更不可避免。无版本字段时，旧文档加载将悄无声息地坏掉。

**决策**：`DashboardDocument.schema_version` 显式声明；变更走 `MAJOR.MINOR` 语义；每次 schema 变更新增 migrator，加载时自动串联应用至 `CURRENT_SCHEMA_VERSION`；持久化时机不强制（applyPatch / publish 时自然回写）。Migrator 必须幂等、确定性，失败抛 `MigrationError`。**不选择 JSON Schema** 而用手写 TypeScript 类型 + Zod 校验，理由：类型与运行时校验一体化、IDE 提示更好、与 contract-kernel 自然集成。

**理由**：显式版本是契约演进的最小成本基础设施，避免"靠默认值兼容"的脆弱依赖。

**后果**：所有读取路径必须经过 `migrateToCurrent`；CI 强制 schema 变更伴随 migrator + fixture 测试；前端永远只见 `CURRENT_SCHEMA_VERSION`，无需感知历史版本。

---

### ADR-10：Contract test 为系统大脑的主防线（含例外条款）

**背景**：纯函数模块（`contract-kernel`、`capability-scope`、`tool-surface`、`materialize-option`）承载系统最复杂的决策逻辑。E2E 慢且对模型语义无法断言；Integration 在 mock 模型下成本中等。Contract 测试快、稳、表达力强，是最优 ROI 选择。

**决策**：上述四个模块视为"系统大脑"，要求 ≥ 95% 分支覆盖 + snapshot 锁定。任何变更必须伴随测试更新；snapshot 变化必须人工 review。

**例外条款**（不计入覆盖率）：
- `default: throw new Error("unreachable")` 类型 narrow 后的 unreachable defaults
- TypeScript exhaustive check 辅助函数（如 `assertNever`）
- 纯类型层断言函数（无运行时逻辑）

例外通过 `/* istanbul ignore next */` 注释 + PR review 双重把关。

**理由**：100% 在工程上不现实；95% 足够拦截绝大部分回归，又不逼出无意义测试。

**后果**：开发节奏会因 contract test 维护成本略微变慢，但换取 9 分级别的回归稳定性。

---

### ADR-11：单体 Next.js 部署，按需横向扩展

**背景**：MVP 阶段团队规模小、用户并发低，微服务化的运维成本不划算。

**决策**：采用单体 Next.js Node.js 进程承载所有 API、SSR、SSE；前置 Nginx / Caddy 做 TLS 与静态资源缓存。多实例扩展时横向加进程，session 状态走 PG（无需 sticky session），Rate Limit 切 Redis。后台任务暂用 CLI + cron，未来再独立 worker。

**理由**：单进程模型最小化跨进程通信复杂度；状态全在 PG 使横向扩展只是"加副本"，无重构。

**后果**：单实例 OOM / restart 影响所有用户；可观测告警需重点覆盖进程健康；长查询会占用 Node.js 主线程（execute-batch 已通过流式 / async 缓解）。

---

### ADR-12：LLM Provider 抽象

**背景**：模型供应商可能变化（OpenAI / Anthropic / 自建），且测试与开发场景需要 mock。

**决策**：pi-agent 通过 `LlmProvider` 接口对接模型；具体实现在 `src/ai/providers/` 下（`OpenAiProvider`、`AnthropicProvider`、`MockProvider`）。选择由 ENV `SDS_LLM_PROVIDER` 决定，API key 由 ENV `SDS_LLM_API_KEY` 提供。Provider 接口暴露 token 计数、流式输出、tool call 协议三个能力。

**理由**：模型市场变化快，绑定单一供应商是技术债。Mock provider 是 contract / integration 测试的必要条件。

**后果**：新增 provider 需实现完整接口 + 通过 `tests/providers/` 中的契约测试套件。Provider 与具体模型 ID 解耦——同一 provider 可配置不同 model id（ENV `SDS_LLM_MODEL`）。

---

### ADR-13：API 路径暂不引入版本前缀

**背景**：是否在 API 路径加 `/v1/` 前缀。

**决策**：当前阶段**不加版本前缀**，所有 API 维持 `/api/*`。Schema 版本化（§10）覆盖文档结构演进；API 边界破坏性变更通过协调发布（前后端同步）解决。未来如需对外开放 SDK / 第三方集成，再引入 `/v1/`。

**理由**：内部应用前后端同步可控，版本前缀的运维成本不必要；过早加版本反而使代码与文档冗余。

**后果**：未来引入 `/v1/` 时需要一次 routing 层重构（mass redirect）；该重构由"对外开放"的需求触发，非现在的关注点。

---

## 17. 各层 AGENTS.md 约束摘要

各层通过 `AGENTS.md` 文件声明边界约束，作为 AI 辅助开发时的 guardrail。

| 层 | 文件路径 | 核心约束 |
|----|---------|---------|
| Contracts | `src/contracts/AGENTS.md` | 只含类型/schema/validation，禁止从 web/server/ai/domain 导入 |
| Domain | `src/domain/AGENTS.md` | 纯业务规则，无 React/fetch/DB/FS，renderer slot 逻辑不属于此层 |
| Server | `src/server/AGENTS.md` | 仅 server-only 逻辑，路由 handler 在 `src/app/api/`，实际逻辑在此；**所有路由首行必须 `requireServerSession`** |
| Web | `src/web/AGENTS.md` | feature-scoped，禁止导入 `src/server/`，跨 feature 依赖走共享模块；`fetch` 全部 `credentials: "include"` + mutating 加 `X-CSRF-Token` |
| App | `src/app/AGENTS.md` | 仅路由入口和薄组合，禁止业务逻辑、SQL、AI 运行时直接实现；**禁止从 req.json/searchParams 读 userId/workspaceId** |
| Renderers | `src/renderers/AGENTS.md` | 禁止导入 React viewer/authoring UI/DB/server 仓储 |
| ECharts | `src/renderers/echarts/AGENTS.md` | 新 recipe 必须注册到 `chart-recipe-registry.ts`；recipe builder 只接受 `themeId`，发出 `$theme`/`$i18n` ref，不解析具体值 |
| Presentation | `src/presentation/AGENTS.md` | 无 React/DB/FS，不做 renderer slot-path 变更，颜色用 `DashboardTheme.chart` token 表达 |
| Dashboard Render | `src/web/dashboard/render/AGENTS.md` | `render-model.ts` 解析卡片/布局/状态；`chart-frame.tsx` 只渲染已物化好的 option 外框；不在此层注入 binding 数据或 materialize 模板 |
| Viewer State | `src/web/viewer/state/AGENTS.md` | `materializeEChartsOptionTemplate` 在渲染前调用一次，`useEChartsChart` 只做 mount/update/resize |
| Guards | `src/server/guards/AGENTS.md` | 所有容量上限集中在 `quotas.ts`；rate limit 在 `rate-limit.ts`；ENV 可覆盖；拒绝时返回标准 `QUOTA_*` / `RATE_LIMIT_*` 错误 |
| Auth | `src/server/auth/AGENTS.md` | 唯一入口 `requireServerSession`；JWT 密钥从 env，支持轮换；token / JWT 内容不出现在日志 payload；mutating 路由必查 CSRF |
| Migrations | `src/server/dashboards/migrations/AGENTS.md` | 每个 migrator 必须幂等、确定性；必须有对应 fixture 测试；失败 throw `MigrationError` |
| Observability | `src/server/logs/AGENTS.md` | 调用方只能通过 `observability.emit`；事件类型遵循 §5.4 命名规范；`level` 与 `type` 正交；新增 AI 事件需同步白名单 |
| Config | `src/server/config/AGENTS.md` | 所有 ENV 在 `load.ts` Zod schema 中声明；未声明的 ENV 不可使用；启动时 fail-fast 校验 |
| LLM Providers | `src/ai/providers/AGENTS.md` | 新 provider 实现 `LlmProvider` 接口；通过 `tests/providers/` 契约测试套件；不在业务代码 import 具体 provider 类，统一从 `getLlmProvider()` 拿 |
| i18n | `src/web/i18n/AGENTS.md` | 所有 key 在 `keys.ts` 集中导出；en-US 必须完整；模型/服务端错误返回 `message_i18n_key` 字段 |
| DB | `src/server/db/AGENTS.md` | Migration 文件命名 `{seq:0000}_{snake_case}.sql`；单文件单 transaction；不支持 down migration |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| `DashboardDocument` | 系统单一真相来源，由 `dashboard_spec + query_defs + bindings + schema_version` 构成 |
| `WorkingDraft` | Agent 内存中暂存的 dashboard 变更草稿，未持久化前不影响真实文档 |
| `PendingProposal` | composePatch 产出的变更提案，含 `proposalId + baseVersion + fingerprint + expires_at`，等待用户审批 |
| `Recipe` | 一种图表类型的封装，包含 ECharts option template + slot 定义 + 数据 transforms |
| `Skill` | AI 视角下的 recipe，附加 `buildQueryDef` 等"如何生成查询"的逻辑 |
| `Surface` | 当前 turn 允许 Agent 使用的工具集合 + 提示词块组合（chat/inspect/author/approval 四种 mode） |
| `AuthoringCapabilityProfile` | turn-level 高层意图分类（chat / explore / author-* / approval） |
| `AuthoringScope` | turn-level 上下文范围（whole dashboard / focused view / empty） |
| `WorkspacePolicy` (new) | 从 `UserSession.permissions` 派生的工具可见性策略 |
| `AgentContextScope` | 从对话语境派生的工具可见性策略 |
| `BindingResult` | 单 binding 的查询结果状态（loading / ok / error） |
| `UserSession` (new) | `requireServerSession` 返回的服务端验证身份，identity 唯一来源 |
| `Quota` | 绝对资源上限（如 view 数、文档大小） |
| `Rate Limit` | 按时间窗口的请求频率上限 |
| `Migrator` | Schema 版本之间的纯函数转换器，必须幂等 |
| `SchemaVersion` | DashboardDocument 的显式版本字段，格式 `MAJOR.MINOR` |
| `Sink` | ObservabilityBus 的事件接收方（JsonlFileSink / OpenTelemetrySink / ...） |

---

## 附录 B：目标态新增类型与字段清单

下列符号当前实现中**不存在**或与目标态**不一致**，迁移完成后均应到位。详见 [docs/migration.md](./migration.md) 对应 Sprint。

### B.1 类型 / 接口

| 符号 | 位置 | 用途 |
|------|------|------|
| `UserSession` | `src/server/auth/require-session.ts` | 服务端验证身份（含 permissions、requestId） |
| `Permission` (enum) | `src/server/auth/permissions.ts` | 权限粒度联合类型 |
| `WorkspacePolicy` | `src/server/auth/workspace-policy.ts` | 从 session 派生的工具可见性 |
| `ObservabilityEvent` | `src/server/logs/observability.ts` | 统一事件结构 |
| `LogSink` | `src/server/logs/observability.ts` | sink 接口 |
| `ObservabilityBus` | `src/server/logs/observability.ts` | 事件总线 |
| `BindingResult` 的 `error` 变体扩展（含 `message_i18n_key`） | `src/contracts/binding.ts` | 错误状态契约 |
| `SchemaVersion` | `src/contracts/schema-version.ts` | dashboard 文档版本类型 |
| `Migrator` | `src/server/dashboards/migrations/types.ts` | 迁移器接口 |
| `LlmProvider` | `src/ai/providers/types.ts` | 模型供应商抽象 |
| `MigrationError` | `src/server/dashboards/migrations/errors.ts` | 迁移失败异常 |
| `ApiError` | `src/server/api-error.ts` | 标准 HTTP 错误（含 i18n key） |

### B.2 字段

| 位置 | 新增字段 |
|------|---------|
| `DashboardDocument` | `schema_version: SchemaVersion` |
| `BindingResult` (error 分支) | `code: string`、`message_i18n_key: string` |
| `PendingProposal` | `expires_at: number` |
| `AuthoringToolRegistration` | `requiredPermissions: Permission[]` |

### B.3 模块 / 文件

| 路径 | 用途 |
|------|------|
| `src/server/auth/` | Auth 模块 |
| `src/server/guards/quotas.ts` | Quota 常量与校验函数 |
| `src/server/guards/rate-limit.ts` | Rate limit 实现 |
| `src/server/config/load.ts` | ENV 加载与 Zod 校验 |
| `src/server/db/migrations/` | DB schema migration SQL 文件 |
| `src/server/dashboards/migrations/` | Dashboard schema migrator 集合 |
| `src/server/logs/observability.ts` | ObservabilityBus 主入口 |
| `src/server/logs/sinks/` | 各 sink 实现 |
| `src/ai/providers/` | LLM provider 抽象与实现 |
| `src/web/api/server-fetch.ts` | SSR cookie 转发封装 |
| `src/web/dashboard/render/chart-error-placeholder.tsx` | BindingResult 错误占位组件 |
| `src/web/auth/login/` | 登录页面与表单 |
| `eslint-rules/no-identity-in-request.js` | ESLint custom rule |

### B.4 ENV 变量

详见 §15.2 与 [docs/migration.md](./migration.md) §2.3。

---

*文档结束。如有架构变更，请同步更新对应的 ADR 条目和层约束说明；从旧实现的迁移路径见 [docs/migration.md](./migration.md)。*
