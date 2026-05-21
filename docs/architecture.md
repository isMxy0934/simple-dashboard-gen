# Simple Dashboard Gen — 系统架构设计

> **适用版本**：Schema 1.0 / Hermes Authoring Agent v3.0  
> **面向读者**：核心开发者、新加入贡献者  
> **文档性质**：**目标架构**（target state）。本文件描述系统的最终设计。  
> **状态约定**：所有内容均按以下三态标注，便于评审与开发对齐——
>
> - 🟢 **现状**：当前代码已实现，与文档描述一致
> - 🟡 **目标新增**：当前代码尚不存在或仅有占位，需通过迁移落地（详见 [docs/migration.md](./migration.md)）
> - 🔴 **与现状不一致**：当前代码与目标态描述存在结构性偏差，需迁移时显式校准
>
> **术语**：见[附录 A](#附录-a术语表)；目标态新增的类型/字段集中列表见[附录 B](#附录-b目标态新增类型与字段清单)；当前与目标差距集中见 §1.5。

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

整个系统围绕一个中心数据结构运转。

🔴 **现状与目标差异**：当前 `schema_version` 是 `DashboardSpec` 的字段，不是 `DashboardDocument` 顶层字段；当前值为 `"0.3"`。目标态将版本提升到顶层 `DashboardDocument`，并升级为 `"1.0"`，迁移路径见 §10.2、migration.md §8。

```typescript
// 🟡 目标态（src/contracts/dashboard.ts）
type DashboardDocument = {
  schema_version: SchemaVersion;   // 🟡 目标新增（顶层字段）；现状在 dashboard_spec.schema_version: "0.3"
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

🟢 = 现状已使用；🟡 = 目标新增依赖。所有后续章节默认基于此：

| 类别 | 选型 | 状态 |
|------|------|------|
| 前端框架 | Next.js 15（App Router） | 🟢 |
| UI 库 | React 19 + TypeScript（strict） | 🟢 |
| 图表 | ECharts 5.x | 🟢 |
| 后端运行时 | Node.js 22（LTS）+ Next.js Route Handler | 🟢 单体部署，详见 §15 |
| 数据库 | PostgreSQL 16 | 🟢 同时用作元数据库与默认数据源 |
| DB Schema 管理 | `ensureCloudAuthoringSchema` 内联 DDL | 🟢 现状；🟡 目标：拆为 `src/server/db/migrations/*.sql` + runner（详见 §14） |
| AI Runtime | `@mariozechner/pi-agent-core` + `pi-ai` + `pi-coding-agent` | 🟢 |
| 认证 | HTTP-only cookie + HS256 JWT（`jose` 包） | 🟡 目标新增；现状是 body/query 传 identity（详见 §6） |
| 包管理 | npm | 🟢 现状；工具链是否切换至 pnpm 是 Sprint -2 Baseline 决策项 |
| 测试 | `node --test --experimental-strip-types` | 🟢 现状；🟡 目标新增 Playwright（E2E 不可替代）。Vitest 切换为 Sprint -2 决策项 |
| 可观测性 sink | `writeSessionTraceEvent` 直写 JSONL | 🟢 现状；🟡 目标：`ObservabilityBus` + 多 sink（详见 §5） |
| i18n | 部分硬编码 + `src/web/i18n/` | 🟡 目标统一化（详见 §13） |

### 1.4 实现状态约定

本文档为**目标架构**。文档中的每个关键概念都按 🟢 / 🟡 / 🔴 三态标记：

- 🟢 **现状**：当前代码已实现且与文档一致，可直接依赖
- 🟡 **目标新增**：当前不存在或仅占位，需通过 migration.md 中对应 Sprint 落地
- 🔴 **与现状不一致**：当前代码与目标态结构性偏差，迁移时需校准

目标态新增的类型 / 字段 / 模块集中列表见[附录 B](#附录-b目标态新增类型与字段清单)。从旧实现到目标态的迁移路径详见 [docs/migration.md](./migration.md)。

### 1.5 现状差距摘要（评审者必看）

下表是当前代码相对目标架构的 **6 个最大差距**。评审者与新人应优先关注此表，再阅读后续章节：

| # | 差距 | 严重度 | 评审引用 | 迁移 Sprint |
|---|------|--------|---------|------------|
| 1 | **Auth/identity**：所有 API 仍从 query/body 取 `userId`/`workspaceId`，服务端不验证身份（`/api/dashboards/route.ts:29`、`/api/authoring/chat/.../route.ts`、`/api/authoring/trace/route.ts:4`）。客户端可声明任意身份 | 🔴 P0 安全 | 评审 #1 | Sprint 1 |
| 2 | **数据源管理无权限边界**：`GET/POST /api/datasources` 无 session/permission/CSRF 校验（`/api/datasources/route.ts:11, 27`）；`datasource_connections` 表是全局表（`schema.ts:135`），无 `workspace_id`，跨 workspace 可见全部 datasource | 🔴 P0 安全 | 评审 #2 | Sprint 1 |
| 3 | **Schema 版本字段位置错误**：当前在 `DashboardSpec.schema_version: "0.3"`（`contracts/dashboard.ts:3, :15`），不是顶层 `DashboardDocument`（`:298`）。目标态需要从 `dashboard_spec.schema_version: "0.3"` 提升至 `DashboardDocument.schema_version: "1.0"`，并保留 spec 内字段兼容直至 v2.0 | 🟠 P0 演进 | 评审 #3 | Sprint 5 |
| 4 | **测试基础设施**：当前只有 `npm + node --test`（`package.json:6, 13`），无 `pnpm` / `vitest` / `playwright` / `test:contract` / `test:e2e` 脚本。所有用到这些命令的验收条目暂时**不可执行** | 🟠 P0 可执行 | 评审 #4 | Sprint -2 |
| 5 | **Sprint 顺序循环依赖**：原计划 Sprint 4 quotas 验收依赖 contract 测试，Sprint 6 contract 加固又依赖 Sprint 4/5 完成。已通过 Sprint -2/-1 重排打破（详见 migration.md） | 🟠 P0 可执行 | 评审 #5 | Sprint -2 |
| 6 | **Observability 基础设施**：当前 `writeSessionTraceEvent` 直写 JSONL，事件结构是 `{scope, event}`，无 `requestId`/`level`/sink 抽象（`session-log-writer.ts:107`）。目标态 `ObservabilityBus` + 多 sink + 标准事件命名差距比此前文档承认的更大 | 🟠 P1 治理 | 评审 #6 | Sprint 2 |

**优先级原则**：差距 #1 与 #2 是**真实安全漏洞**，必须在 Sprint 1 一次性收敛；#3-#6 按 Sprint 顺序逐步落地。

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
  🟡 Auth/Permission  — requireServerSession 中间件（src/server/auth/）
  🟡 Observability    — ObservabilityBus + LogSink（src/server/logs/）
  🟡 Quota/Rate Limit — 硬性容量与限流（src/server/guards/，见 §8）
  🟡 Migrations       — Schema 版本迁移（src/server/dashboards/migrations/，见 §10）
  🟡 Config Loader    — ENV 校验与配置加载（src/server/config/，见 §15.2）
```

### 2.1 Domain Core 🟢

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

| 模块 | 路径 | 状态 |
|------|------|------|
| 数据源引擎注册表 | `src/server/datasource/engine-registry.ts` | 🟢 |
| 批量查询执行 | `src/server/execution/` | 🟢 |
| 云端持久化 | `src/server/cloud/` | 🟢 |
| Dashboard 持久化 | `src/server/dashboards/` | 🟢 |
| Schema 迁移器 | `src/server/dashboards/migrations/` | 🟡 |
| DB schema 文件 | `src/server/db/migrations/*.sql` | 🟡（现状是 `ensureCloudAuthoringSchema` 内联 DDL） |

**禁止依赖**：`src/web/`、`src/ai/`、React。

### 2.3 Agent Layer 🟢

**职责**：AI 推理循环、工具表面管理、capability scope、WorkingDraft 事务。  
**单一变更理由**：AI 能力策略或工具协议变化。  
详见 [第 3 节](#3-agent-架构)。

### 2.4 Rendering Layer 🟢

**职责**：ECharts option 模板管理、materialize、validate。  
**单一变更理由**：渲染器实现或图表类型变化。  
详见 [第 4 节](#4-渲染架构)。

### 2.5 Application Layer

**职责**：HTTP 路由编排、Session 生命周期管理、发布流程。  
**单一变更理由**：业务流程或 API 边界变化。

| 模块 | 路径 | 状态 |
|------|------|------|
| Authoring chat stream | `src/app/api/authoring/chat/[id]/stream/route.ts` | 🟢 路由存在；🔴 仍信任客户端身份 |
| Session open/save | `src/app/api/authoring/session/` | 同上 |
| Dashboard publish | `src/app/api/dashboards/[dashboardId]/publish/route.ts` | 同上 |
| Query execute-batch | `src/app/api/query/execute-batch/route.ts` | 同上 |
| Datasource admin | `src/app/api/datasources/route.ts` | 🔴 完全无 auth/CSRF |
| Authoring trace | `src/app/api/authoring/trace/route.ts` | 🔴 从 query 直取 identity |
| Chat 请求装配 | `src/server/authoring/chat-request.ts` | 🟢 |
| Chat 流式执行 | `src/server/authoring/chat-service.ts` | 🟢 |
| Session 持久化编排 | `src/server/authoring/chat-session-orchestrator.ts` | 🟢 |

**原则**：
- 路由只做参数解析和薄组合，实际逻辑下沉到 `src/server/` 或 `src/ai/`。
- 🟡 **所有路由强制以 `requireServerSession(req)` 开头**，从 session 推导 `userId` / `workspaceId`，禁止从 query string / body 读 identity 字段（见 §6）。
- 🟡 所有 mutating 路由（POST/PUT/DELETE/PATCH）追加 CSRF 校验（见 §6.4）。
- 🟢 `chat-session-orchestrator` 负责 session 的加载/快照/持久化生命周期；turn 内的 scope 推导与 surface 切换在 `AuthoringAgentSession`（`src/ai/authoring/agent/session.ts`）里。两者职责不混淆。

### 2.6 Presentation Layer 🟢

**职责**：面向用户的 React UI，包括编辑器、Viewer、管理界面。  
**单一变更理由**：UI/UX 交互设计变化。

| 模块 | 路径 |
|------|------|
| 编辑 UI | `src/web/authoring/` |
| Viewer UI | `src/web/viewer/` |
| 管理 UI | `src/web/management/` |

**禁止依赖**：`src/server/`；跨 feature 依赖需通过 `src/web/i18n/`、`src/web/utils/`、`src/web/api/` 等共享模块。

---

## 3. Agent 架构 🟢

> **状态**：核心机制（WorkingDraft、composePatch、surface、scope）🟢 已实现且文档与代码对齐；🟡 仅 `requiredPermissions` 字段、`WorkspacePolicy.derive` 是目标新增。

### 3.1 核心边界规则 🟢

Agent 不直接修改 `DashboardDocument`。**唯一合法的变更路径**是：

```
Agent 调用 stageChart/stageReplaceChart/stageQuery/stageDelete
        ↓
    WorkingDraft（内存暂存）
        ↓
    runCheck（校验）
        ↓
    composePatch → PendingProposal（含 draft fingerprint + 🟡 expires_at）
        ↓
    用户在 Approval UI 点击确认 → LocalApprovalEvent
        ↓
    applyPatch（服务端验证 proposalId + baseVersion + fingerprint + 🟡 expires_at）
        ↓
    DashboardDocument 持久化变更
```

一旦 `composePatch` 或 `applyPatch` 成功，当前 turn 的剩余过程强制切换为 chat-only，模型无法在同一 turn 内重新开启写工具。

### 3.2 Turn 生命周期 🟢

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
        ↓
persistSessionSnapshot + contextFingerprint
```

**3 次连续失败的工具被移除**：由 `computeAuthoringScope` 出口处的 `filterToolFailures` 实现。

关键类型 🟢：

```typescript
// src/ai/authoring/contracts/runtime.ts
type AuthoringCapabilityProfile =
  | "chat" | "explore" | "author-dashboard" | "author-focused" | "approval";

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

`AuthoringScope` 是 **discriminated union**，`focused` 必带 `viewId`。`stopReason` 当前仅有 `"approval-applied"` 一个非空值。

### 3.3 Tool 可见性：两个 Scope 的交集

```typescript
availableTools
  = WorkspacePolicy.derive(session)          // 🟡 目标新增（Auth Layer 管）
  ∩ AgentContextScope.derive(conversation)   // 🟢 已实现（Agent Layer 管）
```

**WorkspacePolicy** 🟡（权限维度，目标新增）：
- 类型：`WorkspacePolicy`（导出位置 `src/server/auth/workspace-policy.ts`）
- 由 `requireServerSession` 注入的 `UserSession.permissions` 推导用户能操作哪些工具
- 推导函数：`WorkspacePolicy.derive(session: UserSession): { allowedToolNames: Set<AuthoringToolName> }`
- 权限粒度见 §6.5

**AgentContextScope** 🟢（对话语境维度）：
- 由 `computeAuthoringScope` 根据对话状态、意图信号、tool 失败历史动态推导
- 例：用户闲聊时不开放 `stageChart`；明确提出创建意图时才开放
- 与权限完全解耦，Agent Layer 不感知用户权限

两个维度解耦的原因：权限是静态的用户属性，对话意图是动态的 session 状态（见 ADR-05）。

### 3.4 Surface 优先级 🟢

实际实现在 `src/ai/authoring/agent/tool-surface.ts`，导出 `resolveRuntimeToolSurface`；`AuthoringScopeManager.buildSurfaceFromScope` 委托给它。优先级如下：

1. `forceChatOnlyForTurn === true` → chat surface（`reason: "chat_only"`）
2. `approval.decision === "approve"` → approval surface（`activeTools: ["applyPatch"]`，`reason: "approval_apply"`）
3. `approval.decision === "reject"` → chat surface（`reason: "chat_only"`）
4. `decision.allowedTools` 为空 → chat surface
   - `scopeResolution.requires_scope_clarification === true` 时 `reason: "scope_blocked"`
5. `profile === "explore"` → inspect surface（基于 `getReadToolNamesForScope` 过滤）
6. `profile === "author-dashboard" | "author-focused"` → author surface
   - `activeTools` 排除 `applyPatch`
   - **Draft 子策略**（`applyAuthoringDraftToolPolicy`）：
     - `hasDraft && canCompose` → 强制 `composePatch`，prompt 注入 `draft-compose`
     - `hasDraft && blockers === ["stale_check"]` → 强制 `runCheck`，prompt 注入 `draft-runtime-check`
7. 兜底 → chat surface（`reason: "chat_only"`）

**`forceChatOnlyForTurn` 的触发点**：
- `composePatch` / `applyPatch` 成功后强制切换
- inspect surface 下读工具预算耗尽
- author surface 下非 declaration 工具步数达到 `AUTHOR_TOOL_STEP_LIMIT`

**Approval 完整性**：不匹配/过期/已 reject 的 ApprovalEvent 在 `chat-session-orchestrator` 的 approval-preflight 阶段提前拒绝（HTTP 4xx）。

### 3.5 工具清单

工具的权威来源是 `src/ai/authoring/tools/registry.ts`（`AUTHORING_TOOL_REGISTRY`），共 4 个 `category`：`read` / `declaration` / `author` / `approval`。

🟢 已实现字段：`readScopes` / `authorScopes` / `inspectLane` / `lifecycleWrite` / `labelKey`  
🟡 目标新增：`requiredPermissions: Permission[]`，由 `WorkspacePolicy.derive` 在 turn 入口过滤

**`read` — 读/检查工具** 🟢：
`loadSkill`、`getViews`、`getView`、`getDatasources`、`listDatasourceTables`、`getTableSchema`、`previewTableData`、`getQuery`、`getBinding`、`getDraftStatus`

**`declaration` — 意图声明工具** 🟢：
`declareAuthoringGoal`

**`author` — 写事务工具** 🟢：
`runCheck`、`stageChart`、`stageReplaceChart`、`stageQuery`、`stageDelete`、`composePatch`

**`approval` — 审批工具** 🟢：
`applyPatch`

### 3.6 关键文件

| 文件 | 职责 | 状态 |
|------|------|------|
| `src/ai/authoring/runtime/capability-scope.ts` | `computeAuthoringScope` 实现 | 🟢 |
| `src/ai/authoring/agent/session.ts` | Agent turn 生命周期、pi-agent 实例管理 | 🟢 |
| `src/ai/authoring/agent/tool-surface.ts` | `resolveRuntimeToolSurface` | 🟢 |
| `src/ai/authoring/agent/scope-manager.ts` | `AuthoringScopeManager` | 🟢 |
| `src/ai/authoring/tools/factory.ts` | `buildAuthoringTools` | 🟢 |
| `src/ai/authoring/tools/registry.ts` | 工具名称注册表 | 🟢；🟡 待加 `requiredPermissions` 字段 |
| `src/server/auth/workspace-policy.ts` | `WorkspacePolicy.derive` 实现 | 🟡 |

---

## 4. 渲染架构 🟢

### 4.1 设计原则 🟢

渲染层是**纯函数管道**：相同输入产生相同 ECharts option，无副作用，server 和 browser 共用同一套代码。

### 4.2 Recipe Registry 🟢

每种图表类型对应一个 **Recipe**。`chart-recipe-registry.ts` 是 ECharts option template 的**唯一**注册表。

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

Registry 在模块加载时执行完整性断言（`assertEChartsStageChartRecipeRegistryComplete`）。Recipe ID 字面量在 `src/contracts/dashboard-chart-recipes.ts`。

🟡 **目标新增**：通过类型层等式 `AuthoringSkillId extends EChartsStageChartRecipeId ? true : false`，编译期强制 skill registry 与 recipe registry 必须同时覆盖每个 ID。

🟢 **当前状态**：option template 重复已通过 `recipe-build.ts → buildEChartsStageChartRecipe` 桥接消除——每个 skill builder 委托 recipe registry 生成 option。

### 4.3 渲染流程 🟢

```
stageChart(recipeId, input)
        ↓
getEChartsStageChartRecipeBuilder(recipeId) → RecipeBuilder
        ↓
RecipeBuilder(input) → { option_template, slots, transforms }
// option_template 含 $theme / $i18n ref
        ↓
存入 DashboardView.renderer.option_template（持久化）
        ↓
materializeEChartsOptionTemplate({...})
        ↓
ECharts.setOption(materializedOption)
```

`materializeEChartsOptionTemplate` 主入口位于 `src/renderers/echarts/browser/materialize-option.ts`（593 行），按职责拆分为同文件 helper。

### 4.4 校验 🟢

server-side 和 browser-side 使用**相同的校验逻辑**。

- `src/renderers/echarts/server/validate-option.ts` — server 执行（`runCheck` 工具调用）
- `src/renderers/echarts/browser/validate-option.ts` — browser 执行

### 4.5 ECharts 实例、容错与 BindingResult 状态契约

每个 view 的渲染由 `useEChartsChart` hook 管理，🟡 **目标新增**被 React `ErrorBoundary` 包裹。

🟢 **BindingResult 状态契约**（`src/contracts/dashboard.ts:280`）：

```typescript
type BindingResultSuccess = {
  view_id: string; slot_id: string; query_id: string;
  status: "ok";
  rows: Row[]; meta: ResultMeta;
};
type BindingResultError = {
  view_id: string; slot_id: string; query_id: string;
  status: "error";
  code?: string;
  message?: string;       // 🟡 目标改为：message_i18n_key（详见 §13）
};
type BindingResult = BindingResultSuccess | BindingResultError;
```

🟡 **目标态行为**：`deriveRenderedViews` 在所有 binding `status === "ok"` 时才调用 `materializeEChartsOptionTemplate`。其它情况：
- 任一 binding `status === "loading"` → view 渲染骨架屏（Skeleton）
- 任一 binding `status === "error"` → view 渲染错误占位（ChartErrorPlaceholder），不调用 materialize

错误占位展示 `message_i18n_key` 解析后的本地化文案（见 §13），提供"重试"按钮，仅重新执行失败的 binding。

### 4.6 关键文件

| 文件 | 职责 | 状态 |
|------|------|------|
| `src/renderers/echarts/browser/materialize-option.ts` | option 物化主入口 + 同文件 helper | 🟢 |
| `src/renderers/echarts/recipes/chart-recipe-registry.ts` | Recipe 注册表 | 🟢 |
| `src/renderers/echarts/server/validate-option.ts` | server-side 校验 | 🟢 |
| `src/presentation/dashboard/themes.ts` | `$theme` token 解析 | 🟢 |
| `src/presentation/dashboard/chart-i18n.ts` | `$i18n` ref 解析 | 🟢 |
| `src/ai/authoring/skills/registry.ts` | AI skill registry | 🟢 |
| `src/contracts/dashboard-chart-recipes.ts` | Recipe ID 字面量来源 | 🟢；🟡 双 registry 编译期 cross-check 待加 |
| `src/web/dashboard/render/chart-error-placeholder.tsx` | BindingResult 错误占位组件 | 🟡 |

---

## 5. 可观测性架构

> 🔴 **重大差距说明**（评审 #6）：
> - 现状：`writeSessionTraceEvent`（`src/server/logs/session-log-writer.ts:107`）直写 JSONL，事件结构是 `{scope, event, payload}`，**无 `requestId` / `level` / sink 抽象**
> - 目标：`ObservabilityBus` + 多 sink + 标准事件命名 + `requestId` 关联
> - 迁移工作量比此前文档承认的更大；详见 migration.md Sprint 2

### 5.1 设计目标 🟡

- 结构化事件采集，覆盖 Agent turn 全生命周期
- 统一通过 `ObservabilityBus` 发出，支持多 sink（JSONL 文件、OpenTelemetry、Postgres、S3 归档等）
- 上层代码不感知具体 sink，sink 切换不影响调用方
- 同一 session 的事件保证写入顺序

### 5.2 核心接口 🟡

```typescript
// src/server/logs/observability.ts (目标新增)

interface ObservabilityEvent {
  type: string;        // "agent.turn.start" | "tool.call" | "query.execute" | ...
  sessionId: string;
  dashboardId: string | null;
  turnId: string | null;
  requestId: string;   // 🟡 目标新增；跨服务请求关联，由 requireServerSession 注入
  timestamp: string;
  payload: unknown;
  level: "info" | "warn" | "error";  // 🟡 目标新增字段
  status?: "active" | "completed" | "errored";
}

interface LogSink {
  write(event: ObservabilityEvent): Promise<void>;
  flush?(): Promise<void>;
}

class ObservabilityBus {
  register(sink: LogSink): void;
  emit(event: ObservabilityEvent): void;  // 非阻塞
  flushAll(): Promise<void>;
}
```

**串行化机制**：`ObservabilityBus` 内部维护 `Map<sessionId, Promise<void>>`，每次 `emit` 把新事件 chain 到该 sessionId 的最后一个 Promise 后。`Promise.all(sinks.map(s => s.write(...).catch(handleSinkError)))` 保证多 sink 并行写。

**`level` 与 `type` 正交规则**：
- `type` 描述**事件类别**（前缀分组 `agent.*` / `query.*` / `error.*`）
- `level` 描述**系统响应严重度**：
  - `info`：正常流程
  - `warn`：异常但可自动恢复（retry 成功、quota 接近、单 query 失败但 batch 继续）
  - `error`：需告警，系统已无法自动恢复
- `type` 含 `error` / `timeout` 不强制 `level === "error"`；`error.unhandled` 必须 `level: "error"`

### 5.3 内置 sink

| Sink | 默认启用 | 职责 | 状态 |
|------|---------|------|------|
| `JsonlFileSink` | 是 | 所有事件写入 `logs/sessions/.../trace.jsonl` | 🟡（复用现有 session-log-writer 内部逻辑） |
| `AiTraceJsonlSink` | 是 | 白名单事件镜像到 `trace.ai.jsonl` | 🟡 |
| `ConsoleSink` | 仅 dev | 开发模式下 stderr 输出 | 🟡 |
| `OpenTelemetrySink` | ENV 启用 | 转发到 OTel collector | 🟡 |
| `SentrySink` | ENV 启用 | `level: "error"` 事件转 Sentry | 🟡 |

### 5.4 事件分类（标准事件类型）🟡

| 前缀 | 事件示例 | 含义 |
|------|---------|------|
| `agent.*` | `agent.turn.start`、`agent.turn.end`、`agent.tool.call`、`agent.tool.result`、`agent.step.finish` | Agent turn 生命周期 |
| `query.*` | `query.start`、`query.complete`、`query.error`、`query.timeout` | 查询执行 |
| `document.*` | `document.draft.stage`、`document.patch.compose`、`document.patch.apply`、`document.publish`、`document.migrate` | Document 变更链路 |
| `render.*` | `render.materialize.start`、`render.materialize.error`、`render.validate.fail` | 渲染阶段 |
| `auth.*` | `auth.session.create`、`auth.session.expire`、`auth.session.invalid`、`auth.session.forbidden` | 认证与授权 |
| `quota.*` | `quota.exceeded`、`quota.warning` | 容量上限 |
| `rate_limit.*` | `rate_limit.exceeded` | 限流 |
| `stream.*` | `stream.request.start`、`stream.ui.step_finish`、`stream.ui.finish` | HTTP SSE 流 |
| `error.*` | `error.unhandled` | 所有层的未捕获异常（必 `level: "error"`） |

🟢 当前命名格式为 `{scope}.{event}`（如 `authoring-agent.turn_start`），迁移到上述标准格式时由 migration §5.4 集中映射。

### 5.5 AI Trace 白名单

```typescript
// src/server/logs/sinks/ai-trace-sink.ts (目标)
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

### 5.6 日志文件结构 🟢

```
logs/sessions/
└── dashboard-{sha256[:24]}/
    ├── manifest.jsonl
    └── session-{sha256[:24]}/
        ├── trace.jsonl
        ├── trace.ai.jsonl
        └── agent-events.jsonl
```

路径使用 SHA-256 前 24 位 hash（`src/server/logs/session-log-paths.ts`）。

🟡 **Trace 文件 Rotation**：单 session 的 `trace.jsonl` 超过 50MB 自动 rotate 为 `trace.{N}.jsonl`。

### 5.7 可观测性工具层

- 🟢 **Trace viewer API**：`GET /api/authoring/trace`
- 🟡 **Metrics**：Agent turn 时长、tool 调用频率、查询 P95 延迟 — 从事件流聚合
- 🟡 **Alerting**：`level: "error"` 事件由 `SentrySink` / `OpenTelemetrySink` 路由到告警系统

---

## 6. Auth 与权限架构

> 🔴 **核心安全缺口**（评审 #1, #2）：
> - 现状：所有 API 仍信任客户端传入的 `userId` / `workspaceId`（具体路由见 §1.5）
> - `/api/datasources` 完全无校验，连 workspace 都不验
> - `datasource_connections` 表无 `workspace_id`，跨 workspace 可见全部 datasource
> - **必须在 Sprint 1 一次性收敛**

### 6.1 统一入口：`requireServerSession` 🟡

**所有 server-side API 路由的第一行代码必须是 `requireServerSession(req)`**。该函数返回 `UserSession`，是 identity 的唯一来源。禁止从 query string / body 读取 `userId` / `workspaceId` 等 identity 字段。

```typescript
// src/server/auth/require-session.ts (目标新增)
import { cookies } from "next/headers";

interface UserSession {
  userId: string;
  workspaceId: string;
  permissions: Set<Permission>;
  sessionId: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
}

async function requireServerSession(
  req: Request,
  opts?: { skipCsrf?: boolean },
): Promise<UserSession>;
```

**ESLint 强制规则** 🟡：`src/app/api/**/*.ts` 中禁止出现 `req.json()` 后读取 `userId` / `workspaceId`、`searchParams.get("userId" | "workspaceId")`（custom rule `no-identity-in-request`）。

### 6.2 Session 签发与续期 🟡

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
  └─ 写入 session_revocations 立即失效
```

### 6.3 JWT 密钥轮换 🟡

JWT 签发与验证支持密钥轮换：

- ENV `SDS_SESSION_SECRETS` 为 JSON：`{ "current": { "kid": "k2", "secret": "..." }, "previous": [{ "kid": "k1", "secret": "..." }] }`
- 签发：永远使用 `current.secret`，JWT header 写入 `kid: "k2"`
- 验证：根据 JWT header 中的 `kid` 在 current + previous 中查找密钥
- 轮换流程：新增 `current`，旧 current 降级为 `previous[0]`；保留 `previous` 至少 1 个完整 TTL 周期

### 6.4 CSRF 防护 🟡

HTTP-only cookie 阻止 XSS 窃取 token，但不阻止 CSRF。SameSite=Lax 仅缓解 GET 触发的攻击，**不挡 mutating POST**。

**所有 mutating 路由（POST/PUT/DELETE/PATCH）必须通过以下两关之一**：

1. **Origin / Referer 校验**（默认）：`requireServerSession` 同时校验 `Origin` header 必须属于 ENV `SDS_ALLOWED_ORIGINS` 白名单。失败 → 403 `CSRF_INVALID_ORIGIN`
2. **CSRF token**（可选加强）：登录时签发与 session 绑定的 CSRF token（双重 cookie 模式），前端在 mutating 请求头 `X-CSRF-Token` 中带上

GET / HEAD 路由不校验 CSRF（按 HTTP 语义应为幂等）。

### 6.5 权限模型 🟡

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
| `dashboard.edit` | 编辑 | 所有 authoring `author` 类工具 |
| `dashboard.publish` | 发布 | `POST /api/dashboards/[id]/publish` |
| `datasource.read` | 查看数据源 | `getDatasources`、`listDatasourceTables`、`getTableSchema`、`previewTableData` |
| `datasource.manage` | 管理数据源配置 | 🔴 当前 `POST /api/datasources/*` 完全无校验 |
| `workspace.admin` | 管理工作区 | 管理 UI 后端 |

**权限粒度边界**：当前模型为 workspace-level，未实现 dashboard-level / view-level 细粒度授权。

**权限校验**通过装饰器函数集中表达：

```typescript
const session = await requireServerSession(req);
requirePermission(session, "dashboard.edit");  // 缺失 throw ApiError(403, "FORBIDDEN")
```

工具层在 `AUTHORING_TOOL_REGISTRY` 中声明 `requiredPermissions: Permission[]`，由 `WorkspacePolicy.derive(session)` 在 turn 入口过滤一次。

### 6.6 权限变更的传播延迟（ADR-06 决策）🟡

`permissions` 写入 JWT claims，**用户被 grant/revoke 新权限后，已签发的 token 仍为旧 permissions**，最长滞后 = JWT TTL（默认 7d）。

**接受滞后**，理由：
- 每请求查 DB 取 permissions 的成本不可忽视（P95 +5–15ms）
- 单团队场景下，权限变化频率低
- 紧急撤销走 `session_revocations` 表 + 60s 缓存

### 6.7 数据源 workspace 边界 🔴 → 🟡

🔴 **现状**：`datasource_connections` 是全局表（`schema.ts:135`），无 `workspace_id` 字段；`GET /api/datasources` 返回**全部 datasource**给任意 caller。

🟡 **目标**：
- `datasource_connections` 表加 `workspace_id text not null references workspaces(id)`
- 现存 datasource 在迁移时关联到一个 default workspace（详见 migration.md §8.6）
- 所有数据源 API 加 `requireServerSession` + `requirePermission("datasource.read" | "datasource.manage")` + workspace filter
- `WorkspacePolicy.derive` 中 datasource 相关工具按 session.workspaceId 过滤

### 6.8 前端登录态 🟡

- 🔴 现状：`LocalAuthSession` 在 localStorage（仅记录 `method` + `signedInAt`，无 token）
- 🟡 目标：完全删除；前端不再持有 token
- `fetch` 调用全部加 `credentials: "include"`
- SSR Server Component 中 `fetch` 通过 `src/web/api/server-fetch.ts` 转发 cookie
- 任何路由返回 401 → 前端 router 跳转 `/login`

### 6.9 扩展路径

不改动 API 边界签名，只替换 `requireServerSession` 内部实现：
- 多租户、细粒度 RBAC、API token、SSO / OAuth

---

## 7. 失败模式与降级 🟡

每种可能失败都有明确的检测、传播、降级策略。所有失败统一通过 `ObservabilityBus` emit `error.*` 或 `level: "error"` 事件。

### 7.1 失败模式矩阵

| 失败类别 | 检测方式 | 用户可见行为（UI 规约） | 系统行为 |
|---------|---------|----------------------|---------|
| **数据源连接失败** | 查询层 retry 1 次 + 5s 超时 | 单 view ChartErrorPlaceholder + 重试按钮 | emit `query.error` (warn) |
| **数据源查询慢（>30s）** | 查询超时 | 同上，文案"查询超时" | emit `query.timeout` (warn) |
| **数据源 schema 漂移** | runCheck / 查询执行返回 schema error | 单 view 占位 + "数据源结构已变更" | emit `query.error` (warn)，code: `SCHEMA_DRIFT` |
| **模型超时（>60s）** | pi-agent 硬超时 | SSE 流送 `agent.turn.error.timeout`；Authoring 面板 toast + "重试本轮" 按钮 | emit `agent.turn.error` (warn) |
| **模型 transient error** | 网络 / 429 | 透明 retry（最多 2 次，指数退避 1s/3s） | emit `agent.tool.protocol_error` (info) |
| **模型生成不合法工具调用** | tool schema 校验失败 | 模型收到 `tool_protocol_error`，自行修正 | 累计失败 3 次该工具从 surface 移除 |
| **`runCheck` 失败** | server 校验返回 errors | Agent 在同 turn 内修正 / 转 chat 说明 | emit `render.validate.fail` (info) |
| **`composePatch` 后 baseVersion 不匹配** | applyPatch 前置校验 | Approval Card 替换为"文档已被他人修改" | emit `document.patch.apply.stale` (warn) |
| **Approval TTL 过期（>10min）** | applyPatch 前置校验 `expires_at` | Approval Card 倒计时归零 → "审批已超时" | emit `document.patch.apply.expired` (warn) |
| **同 session 并发 turn** | Stream queue 串行化 | 后请求排队（loading indicator） | chat-service 内建 queue 已实现 🟢 |
| **同 dashboard 多 tab 编辑** | `baseVersion + fingerprint` 拦截 | 后写者收到 stale 错误 | 已由 ADR-01 三件套覆盖 🟢 |
| **ECharts 渲染 throw** | React `ErrorBoundary` | 单 view ChartErrorPlaceholder | emit `render.materialize.error` (warn) |
| **Session trace 文件膨胀** | 写入前检查文件大小 | 透明 | 超 50MB 自动 rotate |
| **持久化失败（DB / FS）** | 仓储层抛错 | applyPatch / publish 返回 500 | emit `error.unhandled` (error) |
| **认证失效 / 过期** | `requireServerSession` 抛 401 | 前端 router 跳转 `/login` | emit `auth.session.invalid` (warn) |
| **CSRF 校验失败** | `requireServerSession` 抛 403 | 前端 toast "请求来源不合法" | emit `auth.session.forbidden` (warn) |
| **权限不足** | `requirePermission` 抛 403 | 前端 toast / 模态"无权限执行此操作" | emit `auth.session.forbidden` (warn) |
| **容量上限触发** | guards 层拒绝 | 模态展示具体上限说明 | emit `quota.exceeded` (warn)（见 §8） |
| **限流触发** | rate limit 层拒绝 | toast "请求过于频繁，请稍后重试" | emit `rate_limit.exceeded` (warn) |

### 7.2 降级原则

1. **隔离单点**：单 view 失败不影响其他 view；单 session 失败不影响其他 session；单 sink 失败不影响其它 sink
2. **保留状态**：失败后 session/draft 状态保留，用户可重试
3. **明确反馈**：所有用户可见的失败必须有人类可读的 i18n 文案（见 §13），禁止暴露 stack trace
4. **可观测**：所有失败必有对应 event，且 `payload` 含足够上下文（requestId、相关实体 ID、错误代码）

### 7.3 重试策略

| 场景 | 策略 |
|------|------|
| 数据源连接失败 | 1 次 retry，指数退避（500ms → 1500ms） |
| Session 持久化失败（瞬时） | 1 次 retry，立即 |
| 模型 transient error（网络、429） | pi-agent 默认 2 次 retry，指数退避（1s → 3s） |

**禁止重试**：模型语义错误、合约校验失败、TTL 过期、权限不足、CSRF 失败、容量超限。

---

## 8. 容量、限流与硬上限 🟡

> 🔴 **现状**：当前代码完全无显式 quota / rate limit；隐式上限只有 `AUTHOR_TOOL_STEP_LIMIT`。Sprint 4 一次性引入。

所有上限集中声明在 `src/server/guards/quotas.ts`（🟡），由 ENV 可覆盖；限流规则集中在 `src/server/guards/rate-limit.ts`（🟡）。

### 8.1 硬上限表（Quotas）

| 维度 | 默认上限 | 可覆盖 ENV | 拒绝点 | 错误代码 |
|------|---------|-----------|--------|---------|
| 单 dashboard view 数 | 50 | `SDS_QUOTA_VIEWS_PER_DASHBOARD` | `publish` / `applyPatch` | `QUOTA_VIEWS_PER_DASHBOARD` |
| 单 dashboard query 数 | 100 | `SDS_QUOTA_QUERIES_PER_DASHBOARD` | 同上 | `QUOTA_QUERIES_PER_DASHBOARD` |
| 单 dashboard 文档大小 | 2 MB | `SDS_QUOTA_DOCUMENT_SIZE_MB` | 同上 | `QUOTA_DOCUMENT_SIZE` |
| 单 query 返回行数 | 10,000 | `SDS_QUOTA_QUERY_ROWS` | 查询执行层 | `QUOTA_QUERY_ROWS` |
| 单 query 返回大小 | 5 MB | `SDS_QUOTA_QUERY_BYTES` | 查询执行层 | `QUOTA_QUERY_BYTES` |
| 单 execute-batch 并发 query 数 | 20 | `SDS_QUOTA_BATCH_SIZE` | execute-batch 入口 | `QUOTA_BATCH_SIZE` |
| 单 turn agent step 数 | 16（`AUTHOR_TOOL_STEP_LIMIT`） | — | 已有 🟢 | 转 chat-only |
| 单 turn 模型 input token | 32,000 | `SDS_QUOTA_MODEL_INPUT_TOKENS` | pi-agent 配置 | `QUOTA_MODEL_INPUT_TOKENS` |
| 单 turn 模型 output token | 8,000 | `SDS_QUOTA_MODEL_OUTPUT_TOKENS` | pi-agent 配置 | `QUOTA_MODEL_OUTPUT_TOKENS` |
| 单 session trace 文件 | 50 MB | `SDS_QUOTA_TRACE_FILE_MB` | trace writer | 自动 rotate |
| 并发 turn / session | 1 | — | chat-service stream queue | 排队（已有 🟢） |
| 并发 session / workspace | 50 | `SDS_QUOTA_SESSIONS_PER_WORKSPACE` | session 创建 | `QUOTA_SESSIONS_PER_WORKSPACE` |
| Dashboard / workspace | 200 | `SDS_QUOTA_DASHBOARDS_PER_WORKSPACE` | dashboard 创建 | `QUOTA_DASHBOARDS_PER_WORKSPACE` |
| Storage / workspace | 10 GB | `SDS_QUOTA_STORAGE_GB` | 后台 sweeper | `QUOTA_STORAGE_GB`（warn，不阻塞写入） |

**调高指引**：大团队预期超出默认值时，统一通过 ENV 覆盖。调整需在 `docs/operations.md` 中记录变更历史。

### 8.2 错误形状 🟡

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

### 8.3 配额监控与告警 🟡

- 所有 `QUOTA_*` 拒绝 emit `quota.exceeded` 事件
- 用量达 80% 时 emit `quota.warning` 事件，由后台任务聚合后发邮件给 `workspace.admin`
- 管理 UI 提供 workspace 用量仪表盘

### 8.4 限流（Rate Limiting）🟡

Quota 是绝对资源上限，**Rate Limit 是按时间窗口的请求频率上限**。

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

> 🔴 **现状差距**（评审 #4）：当前 `npm test` 跑的是 `node --test --experimental-strip-types tests/*.test.ts`，没有 `pnpm` / `vitest` / `playwright` / `test:contract` 等命令。下面描述是目标态；工具链是否切换是 Sprint -2 Baseline 决策项。

### 9.1 分层 🟡

```
┌─────────────────────────────────────────────────┐
│ E2E (Playwright, ~15 用例)                      │  慢、贵
│   登录 / 创建 dashboard / Agent 加 view / 发布   │  禁止断言模型语义
├─────────────────────────────────────────────────┤
│ Integration (~80 用例)                          │  中
│   chat-service 完整 turn（mock 模型输出）       │
│   execute-batch + 真实 DB                       │
│   applyPatch 三件套校验（base/fingerprint/TTL）│
├─────────────────────────────────────────────────┤
│ Contract (~300 用例) ★ 主防线 ★                 │  快
│   contract-kernel 所有分支（含 ADR-10 例外）    │
│   capability-scope 所有 profile × scope 组合     │
│   tool-surface 所有优先级 + draft 子策略         │
│   materialize-option 每 recipe 多 case snapshot │
│   每个 quota / rate-limit 边界值                 │
└─────────────────────────────────────────────────┘
```

**工具链决策**（Sprint -2 拍板）：
- **选项 A**：保留 `node --test`（零迁移成本，原生覆盖率支持有限，无 snapshot 内置）
- **选项 B**：切换 `vitest`（更好的 watch / coverage / snapshot，但引入新依赖）
- **选项 C**：混合（Contract/Integration 用 `vitest`，老测试保留 `node --test` 渐进迁移）

**E2E 必须新增 Playwright**（`node --test` 不做 E2E）。

### 9.2 测试不变量

| 模块 | 必须满足 |
|------|---------|
| `contract-kernel` | ≥ 95% 分支覆盖（不含 ADR-10 例外条款）；任何 schema 变更须同步更新测试 |
| `capability-scope` | 每个 `AuthoringCapabilityProfile × AuthoringScope.kind` 组合至少 1 测试 |
| `tool-surface` | §3.4 中 7 个优先级分支各 1 测试；draft compose/stale 子策略各 1 测试 |
| `materialize-option` | 8 个 recipe 各至少 3 个 snapshot（标准数据 / 空数据 / 多系列） |
| Quota guards | 每个 `QUOTA_*` 上限的 `==` 与 `+1` 两个边界值各 1 测试 |
| Rate limit | 每个分组的"窗口内 N 次通过、N+1 次拒绝"各 1 测试 |
| `requireServerSession` | 有效 / 过期 / 无 / 篡改 / 撤销 / kid 不匹配 / CSRF 失败 共 7 种场景 |
| Migrations | 每个 migrator 有 fixture in/out 双侧测试 + 幂等测试 |

### 9.3 不测试的部分

- UI 像素差异
- AI 模型本身的输出质量
- ECharts 内部行为
- 第三方数据源驱动的兼容性细节
- ADR-10 例外条款内的代码

### 9.4 性能基准（Benchmark）🟡

| 基准 | 目标 |
|------|------|
| 单 turn 完整 agent 循环（mock model） | P95 < 200ms |
| `materializeEChartsOptionTemplate` 单次（中等复杂度 view） | P95 < 5ms |
| `execute-batch` 10 个简单 query（本地 PG） | P95 < 500ms |
| `requireServerSession` 验证 | P95 < 3ms（含 revocations 缓存） |

CI 不阻塞，但回归超 2× 触发自动 issue。

### 9.5 CI 门槛 🟡

| 阶段 | 要求 |
|------|------|
| PR commit | 全部 Contract + Integration 测试通过；lint + type-check 通过；覆盖率门槛达标 |
| Merge to main | 上述 + E2E 全部通过 |
| Release | 上述 + 配额边界测试通过 + migration fixture 测试通过（见 §10）+ benchmark 不回归 |

---

## 10. Schema 版本与迁移

> 🔴 **真实迁移路径**（评审 #3）：
> - 现状：`SchemaVersion = "0.3"`（`contracts/dashboard.ts:3`）作为 `DashboardSpec.schema_version` 字段（`:15`）；`DashboardDocument` 顶层无版本字段（`:298`）
> - 目标：`DashboardDocument.schema_version: "1.0"` 顶层字段
> - 迁移：v0.3 (in spec) → v1.0 (in document)，详见 §10.4

### 10.1 版本字段 🟡

`DashboardDocument.schema_version` 是显式字符串，格式 `MAJOR.MINOR`。

```typescript
type SchemaVersion = "1.0" | "1.1" | "2.0" | /* ... */;
const CURRENT_SCHEMA_VERSION: SchemaVersion = "1.0";
```

**版本号语义**：
- `MINOR` 变化：向后兼容（新增可选字段、扩展 enum、放宽校验）
- `MAJOR` 变化：破坏性（字段重命名、删除字段、收紧校验、结构重组）

### 10.2 迁移器（Migrator）🟡

```typescript
// src/server/dashboards/migrations/v0.3-to-v1.0.ts
export const migrate_0_3_to_1_0: Migrator = {
  from: "0.3",
  to: "1.0",
  apply(doc: LegacyDashboardDocument_v0_3): DashboardDocument_v1_0 {
    // 1. 检测 dashboard_spec.schema_version === "0.3"
    // 2. 把版本提升到顶层：doc.schema_version = "1.0"
    // 3. 保留 dashboard_spec 内部结构（无字段重命名）
    // 4. dashboard_spec.schema_version 字段保留至 v2.0 时再删除（向后兼容）
    return {
      schema_version: "1.0",
      dashboard_spec: doc.dashboard_spec,   // 内部结构保持
      query_defs: doc.query_defs,
      bindings: doc.bindings,
    };
  },
};
```

**Migrator 约束**：
- 必须**幂等**：apply(apply(doc)) === apply(doc)
- 必须**确定性**：相同输入产生相同输出
- 允许查 DB 补充缺失字段（如关联 datasource 元数据），但需在测试 fixture 中固化预期返回
- **失败时抛 `MigrationError`**，不静默吞错

### 10.3 加载与持久化策略 🟡

```
GET /api/dashboards/[id]
  ├─ 从存储读出原始文档（doc.dashboard_spec.schema_version === "0.3"，顶层无版本字段）
  ├─ migrateToCurrent(doc):
  │   ├─ 若顶层无 schema_version 且 dashboard_spec.schema_version === "0.3" → 应用 v0.3→v1.0 migrator
  │   ├─ 串联应用后续 migrator 至 CURRENT_SCHEMA_VERSION
  │   ├─ 校验 migrated 文档符合最新 contract（assertDashboardDocument）
  │   ├─ 成功：返回 migrated 文档
  │   └─ 失败：emit `document.migrate.error`，返回 502 `MIGRATION_FAILED`
  └─ 返回给前端（前端永远只见 CURRENT_SCHEMA_VERSION）

applyPatch / publish
  ├─ 写入前强制 schema_version = CURRENT_SCHEMA_VERSION（migrateToCurrent 已确保）
  └─ 这是 §10.3 与 §3.1 的契约：所有写入路径生成的文档必为最新 schema
```

**持久化时机**：迁移结果**不**立即回写存储；只有触发 `applyPatch` / `publish` 时整个文档以最新 schema 写回。

**主动 batch 迁移**：`pnpm script:migrate-all-dashboards`（或 `npm run script:migrate-all-dashboards`，取决于 Sprint -2 工具链决策）。

**Migration 失败的降级**：加载失败 → dashboard 在管理 UI 列表中标红"无法加载"，提供"导出原始 JSON / 联系管理员"链接。**不允许"部分 migrate 成功就保留"，全或无**。

### 10.4 v0.3 → v1.0 真实迁移路径详解（评审 #3）

| 阶段 | 数据状态 |
|------|---------|
| **现状** | DB 中存的文档：`{ dashboard_spec: { schema_version: "0.3", ... }, query_defs: ..., bindings: ... }` |
| **加载时（migrate）** | 读出后立即应用 v0.3→v1.0 migrator：`{ schema_version: "1.0", dashboard_spec: { schema_version: "0.3", ... }, query_defs: ..., bindings: ... }` |
| **applyPatch / publish 后** | 写回 DB：同上结构（即顶层 v1.0 + spec 内仍 v0.3 字符串作为冗余兼容字段） |
| **v2.0 时计划** | v1.0→v2.0 migrator 删除 `dashboard_spec.schema_version` 冗余字段 |

**冗余字段保留期**：1 个 MAJOR 版本周期（v1.0 直至 v2.0 发布）。这保证旧二进制（仍读 `dashboard_spec.schema_version`）在 v1.0 阶段能正常工作，便于回滚。

### 10.5 Recipe / 工具的废弃 🟡

| 阶段 | 建议时长 | 行为 |
|------|---------|------|
| Deprecated | ≥ 1 个 release | Registry 保留；stage 时返回 warning |
| Migrate | ≥ 1 个 release | 在 migrator 中加入"旧 recipe ID → 新 recipe ID + 字段映射" |
| Remove | — | Skill registry 与 recipe registry 同时删除 |

**前提**：Deprecated 阶段必须有遥测数据证明残余使用量 < 1%（按 dashboard 数计）。

### 10.6 测试要求 🟡

- 每个 migrator 必须有 fixture 测试：`fixture-v{from}.json` → migrator → 等于 `fixture-v{to}.json`
- 加幂等测试：`migrator(migrator(in)) === migrator(in)`
- 加"无顶层 schema_version + spec 内 v0.3 文档自动 migrate 到 v1.0"的测试
- CI 强制：CURRENT_SCHEMA_VERSION 变更必须伴随 migrator + fixture

---

## 11. 数据流：Authoring 完整路径

用户发起一轮 authoring turn 的完整数据流：

```
1. 用户输入自然语言
   └─ Web: useAgentSession → POST /api/authoring/chat/[id]/stream
      (浏览器自动发送 sds_session cookie；Origin header 由浏览器自动加)

2. HTTP 层 turn 准备 🟡
   └─ route.ts
      ├─ requireServerSession() → UserSession        ★ 唯一 identity 入口
      ├─ CSRF 校验（Origin / Referer，POST 必查）
      ├─ requirePermission(session, "dashboard.edit")
      ├─ rate limit 检查（30/user/分钟）
      └─ chat-service.start(session, body)
         ├─ chat-session-orchestrator
         │   ├─ 加载 DashboardDocument（含 migrateToCurrent v0.3→v1.0）
         │   └─ 加载 session 快照
         ├─ approval-preflight 🟢
         ├─ AuthoringAgentSession 初始化 🟢
         └─ session.startTurn(config) 🟢

3. Scope 计算 🟢
   └─ computeAuthoringScope(AuthoringScopeInput)
      ├─ 分析 conversation signals
      ├─ 检查 stepHistoryInTurn（filterToolFailures，阈值 3）
      ├─ 🟡 应用 WorkspacePolicy.derive(session) ∩ AgentContextScope
      └─ 返回 AuthoringScopeCapabilities

4. Surface 构建 🟢
   └─ AuthoringScopeManager.buildSurfaceFromScope(scope)
      → resolveRuntimeToolSurface（含 draft compose/stale 子策略）

5. pi-agent 推理循环 🟢（含超时 60s 🟡、token 上限 🟡、step 上限 🟢、transient retry 🟡）
   └─ Agent.prompt(messages, tools, systemPrompt)
      ├─ [model] stageChart → WorkingDraft
      ├─ [model] runCheck
      ├─ [model] composePatch → PendingProposal { proposalId, baseVersion, fingerprint, 🟡 expires_at }
      └─ tool hook → observability.emit("agent.tool.*", ...) 🟡

6. SSE 流推送 Proposal 到客户端 🟢
   └─ 渲染 Approval Card（含 proposalId + fingerprint + 🟡 倒计时）

7. 用户点击 Approve 🟢

8. applyPatch 执行
   └─ 🟡 requireServerSession + CSRF + requirePermission("dashboard.edit")
   └─ 验证 proposalId + baseVersion + fingerprint + 🟡 expires_at > now
   └─ patch 写入 DashboardDocument（🟡 schema_version = "1.0"）
   └─ 🟡 容量校验（quota guards，见 §8.1）
   └─ 持久化 DashboardDocument

9. 触发查询执行 🟢
   └─ POST /api/query/execute-batch
   └─ server/execution → BindingResults
      （单 query 失败不阻塞 batch）

10. 渲染结果推送 🟢
    └─ deriveRenderedViews()
       ├─ 所有 binding status === "ok" → materializeEChartsOptionTemplate()
       ├─ 🟡 任一 binding status === "loading" → Skeleton
       └─ 🟡 任一 binding status === "error" → ChartErrorPlaceholder
    └─ useEChartsChart → ECharts.setOption
```

---

## 12. 数据流：Viewer 渲染路径

已 publish 的 dashboard 从加载到渲染完成的路径：

```
1. 加载 DashboardDocument
   └─ GET /api/dashboards/[dashboardId]
      ├─ 🟡 requireServerSession + requirePermission("dashboard.read")
      ├─ 从存储读取 + migrateToCurrent (v0.3 → v1.0)
      │   └─ migrate 失败：返回 502，前端展示"无法加载"
      └─ viewer-api.ts → ViewerSnapshot

2. 初始化 Viewer 状态 🟢
   └─ viewer-state.ts

3. 批量查询执行 🟢
   └─ POST /api/query/execute-batch (🟡 requireServerSession + CSRF + rate limit)

4. 派生渲染状态 🟢（🟡 处理 binding status: loading/error）

5. materializeEChartsOptionTemplate 🟢

6. 图表挂载 🟢（🟡 ErrorBoundary 包裹）
```

**Filter 变更触发的刷新** 🟢：用户调整过滤器 → 重建 `ExecuteBatchRequest` → 重新执行步骤 3-6。

---

## 13. 国际化（i18n）架构 🟡

### 13.1 设计原则

- 所有用户可见字符串走 i18n key，禁止 hardcode 中英文字面量到组件
- 模型 / 服务端错误以 `message_i18n_key` 字段返回，前端解析
- 渲染层 `$i18n` ref 在 `materializeEChartsOptionTemplate` 中按当前 locale 解析

### 13.2 目录结构 🟡

```
src/web/i18n/
├── locales/
│   ├── zh-CN.ts
│   ├── en-US.ts
│   └── index.ts
├── keys.ts               # 所有 i18n key 字面量集中导出
├── context.tsx
├── format.ts
└── AGENTS.md
```

### 13.3 Key 命名规范

`<feature>.<sub-area>.<purpose>`：
- `error.quota.views_per_dashboard`
- `authoring.approval.expired_message`
- `chart.placeholder.error.schema_drift`

### 13.4 缺失 Key 行为

- **开发模式**：渲染显示 `⟦missing: error.quota.views⟧`，控制台 warn
- **生产模式**：渲染显示英文 fallback；emit `error.unhandled`，payload `{ code: "I18N_KEY_MISSING", key, locale }`

### 13.5 多语言切换

- locale 由 `Accept-Language` header + 用户偏好（`user_preferences` 表）决定
- 切换 locale 不刷新页面
- ECharts 内嵌字符串通过 `$i18n` ref，locale 变更时重新调用 `materializeEChartsOptionTemplate`

### 13.6 服务端 i18n

- 邮件通知（quota.warning 告警邮件）
- PDF / Excel 导出（未来）

在 `src/server/i18n/` 维护一份与前端同步的 key/locale 对照（构建时校验一致性）。

---

## 14. 数据存储与持久化

### 14.1 数据库 🟢→🟡

PostgreSQL 16，单实例。表结构由 SQL migration 文件管理：

```
src/server/db/migrations/  🟡
├── 0001_init_workspace.sql
├── 0002_dashboards.sql
├── 0003_sessions.sql
├── 0004_session_revocations.sql
├── 0005_user_preferences.sql
├── 0006_datasource_workspace_id.sql   # ★ 评审 #2 修复
└── runner.ts
```

🔴 **现状**：DB schema 由 `src/server/cloud/schema.ts` 的 `ensureCloudAuthoringSchema` 内联 DDL 在启动时执行。  
🟡 **目标**：拆为顺序编号的 SQL 文件 + runner，每文件单 transaction，不支持 down migration（回滚靠新写一个 reverse migration）。

### 14.2 主要表

| 表 | 用途 | 关键约束 | 状态 |
|----|------|---------|------|
| `workspaces` | 工作区元数据 | PK `id` | 🟢 |
| `workspace_users` | 用户 / workspace 成员关系 | UQ `(workspace_id, user_id)` | 🟢 |
| `workspace_dashboards` | dashboard 索引 | PK `id`，FK `workspace_id` | 🟢 |
| `dashboard_documents` | `DashboardDocument` 完整 JSON + version + checksum | PK `(dashboard_id, version)` | 🟢 |
| `authoring_sessions` | session 状态快照 | PK `id` | 🟢 |
| `datasource_connections` | 数据源凭据 | 🔴 当前**无 workspace_id**（评审 #2）；🟡 加 `workspace_id text not null references workspaces(id)` | 🔴→🟡 |
| `session_revocations` | JWT jti 黑名单 | PK `jti`，TTL 自动清理 | 🟡 |
| `user_preferences` | locale、theme、可见性偏好 | PK `user_id` | 🟡 |
| `quota_usage` | 每 workspace 用量缓存 | PK `workspace_id` | 🟡 |

### 14.3 文档存储 🟢

`DashboardDocument` 完整 JSON 存 `dashboard_documents.document_jsonb`，每次写入 `version + 1`。Viewer 默认读最大 version，启用 publish 后 publishedVersion 字段固定到具体版本。

**Backup** 🟡：DB 每日 `pg_dump` 至 S3-compatible 对象存储；保留 30 天。

### 14.4 日志与 trace 🟢

详见 §5.6。文件系统存储，按 dashboard / session hash 分目录。

### 14.5 缓存

- 🟡 session_revocations 60s 内存 LRU 缓存（每实例）
- 🟢 materialize / theme 解析不缓存（纯函数）
- 🟢 查询结果不缓存（BI 数据时效性敏感）

---

## 15. 部署与运维

### 15.1 部署形态 🟢

**单体 Next.js Node.js 服务**：

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

**多实例扩展**：横向扩 Next.js 进程，前置负载均衡（无需 sticky session）。

### 15.2 配置加载 🟡

所有 ENV 通过 `src/server/config/load.ts` 集中加载，启动时 Zod 校验：

```typescript
const schema = z.object({
  SDS_SESSION_SECRETS: zJsonObject,
  SDS_SESSION_TTL_DAYS: z.coerce.number().default(7),
  SDS_ALLOWED_ORIGINS: z.string().transform(s => s.split(",")),
  SDS_DATABASE_URL: z.string().url(),
  SDS_QUOTA_VIEWS_PER_DASHBOARD: z.coerce.number().default(50),
  // ...
  SDS_LLM_PROVIDER: z.enum(["openai", "anthropic", "mock"]),
  SDS_LLM_API_KEY: z.string(),
});

export const config = schema.parse(process.env);
```

**未声明的 ENV 在启动时 fail-fast**。

### 15.3 启动 / 健康检查 🟡

- `GET /api/health` 返回 `{ status, schemaVersion, dbConnected, llmConfigured }`
- 启动顺序：load config → DB migration runner → ensureCloudAuthoringSchema（过渡期保留）→ 注册 sinks → bind port

### 15.4 后台任务 🟡

| 任务 | 触发方式 | 频率 |
|------|---------|------|
| Trace 文件清理（archive → delete） | systemd timer / cron | 每日 02:00 |
| Quota usage 重算 | systemd timer | 每 5 分钟 |
| Session revocations 过期清理 | DB trigger / cron | 每日 |
| 邮件批量发送（quota.warning 聚合） | cron | 每 30 分钟 |

后台任务用同一份代码库的 CLI 入口，避免单独 worker 服务。

### 15.5 部署变更管理 🟡

- ENV 变更需在 `docs/operations.md` 记录
- DB migration 在生产部署前必须先在 staging 跑过
- Schema 1.0 → 2.0 这类 MAJOR 升级需要发布 changelog 与回退预案

---

## 16. 关键设计决策记录（ADR）

### ADR-01：Agent 只写 WorkingDraft，不直接变更 Document 🟢

**背景**：AI 模型会产生幻觉，生成不合法的 schema 结构。

**决策**：Agent 工具只写内存中的 `WorkingDraft`。`DashboardDocument` 的变更路径必须经过 `composePatch → 用户 Approval → applyPatch`。`PendingProposal` 携带 `proposalId + baseVersion + fingerprint + 🟡 expires_at`，applyPatch 时四项全部校验。

**理由**：
1. `runCheck` 在 compose 前校验 draft
2. fingerprint 防 TOCTOU
3. `expires_at` 防长时间挂起的 approval 卡片被误用
4. 用户 Approval 是业务上的确认节点

**后果**：每轮 authoring 至少需要两轮网络请求；前端需管理 Approval Card 生命周期与 TTL 倒计时。

---

### ADR-02：RecipeRegistry 单一注册表 + 编译期 cross-check 🟢→🟡

**背景**：AI skill 与 renderer 都需要描述"图表类型"，若各自维护 option template，必然产生漂移。

**决策**：`src/renderers/echarts/recipes/chart-recipe-registry.ts` 是 ECharts option template 的唯一来源。Recipe ID 字面量集中在 `src/contracts/dashboard-chart-recipes.ts`，🟡 通过类型层等式强制两个 registry 必须同时覆盖每个 ID。

**当前状态**：option template 重复已通过 `recipe-build.ts` 桥接消除；🟡 编译期类型等式待加。

---

### ADR-03：materializeOption 纯函数，server/browser 共用 🟢

**背景**：server-side 与 browser-side 不同代码路径会导致校验与渲染不一致。

**决策**：`materializeEChartsOptionTemplate` 是纯函数，无副作用，同一函数在 server 与 browser 调用。

**后果**：函数不能使用任何浏览器 API 或 Node.js 专用 API。

---

### ADR-04：ObservabilityBus + LogSink 标准接口 🟡

**背景**：多 sink 支持应不影响上层调用方；同一 session 的事件顺序必须可靠。

**决策**：所有可观测事件统一通过 `observability.emit(event)` 发出。`ObservabilityBus` 按 `sessionId` 串行化写入；sink 通过 `register(sink)` 装配。事件类型遵循 §5.4 命名规范，`level` 与 `type` 正交。

**后果**：所有原始 `writeSessionTraceEvent` 调用方迁移到 `observability.emit`；事件类型从 `{scope}.{event}` 改为 §5.4 标准命名。

---

### ADR-05：WorkspacePolicy 与 AgentContextScope 分离 🟢→🟡

**背景**：工具可见性受两类因素影响：用户权限（静态）和对话状态（动态）。

**决策**：`WorkspacePolicy`（权限）由 Auth Layer 管理；`AgentContextScope`（对话语境）由 Agent Layer 管理。最终可见工具是两者的交集。

**后果**：工具注册需要同时声明 `requiredPermissions` 和 `readScopes`/`authorScopes` 两个维度的 metadata。

---

### ADR-06：Auth 统一 `requireServerSession`，cookie-based JWT，接受 7d 权限滞后 🟡

**背景**：API 边界的 identity 必须服务端验证。

**决策**：
1. 所有 server-side 路由第一行 `requireServerSession() → UserSession`
2. Token 为 HS256 JWT，存放在 `sds_session` HTTP-only cookie，支持密钥轮换
3. Mutating 路由追加 CSRF 校验（Origin / Referer 白名单）
4. `permissions` 写入 JWT claims，**接受最长 7d 滞后**；紧急撤销走 `session_revocations` 表 + 60s 缓存
5. Lint 规则强制禁止从 `req.json()` / `searchParams` 读 `userId` / `workspaceId`
6. 前端不持有 token，依赖浏览器 cookie 机制；401 → 跳转 `/login`

**理由**：最小安全原则；权限滞后是性能/复杂度的合理 trade-off，紧急撤销有 escape hatch。

**后果**：旧 `LocalAuthSession` localStorage 机制完全删除；`/api/auth/login` / `/refresh` / `/logout` 成为新的 API 入口；管理 UI 文案说明权限滞后规则。

---

### ADR-07：失败模式矩阵 + 隔离单点原则 🟡

**决策**：在 §7.1 集中维护"失败模式矩阵"，每种失败明确：检测方式、用户可见行为（UI 规约）、系统行为。

**后果**：新增失败模式必须更新矩阵 + 加 contract test + 加 i18n 文案；不允许仅 `try/catch` 后吞掉。

---

### ADR-08：硬性容量上限 + 路由级限流，fail-fast 拒绝 🟡

**决策**：
1. **Quotas**：所有容量上限集中在 `src/server/guards/quotas.ts`，ENV 可覆盖
2. **Rate Limit**：路由级令牌桶，分组独立上限
3. 用量达 80% emit `quota.warning`

**后果**：管理 UI 需展示当前用量；前端对 `QUOTA_*` / `RATE_LIMIT_*` 错误做友好提示。

---

### ADR-09：Schema 显式版本化 + 自动迁移；v0.3 (in spec) → v1.0 (顶层) 🟡

**背景**：Dashboard 文档是长生命周期资产；当前 `dashboard_spec.schema_version: "0.3"` 不便于演进。

**决策**：
- `DashboardDocument.schema_version` 顶层字段，格式 `MAJOR.MINOR`
- v0.3 → v1.0 migrator 把版本"提升到顶层"，spec 内冗余字段保留至 v2.0
- 不用 JSON Schema 而用 TypeScript + Zod
- Migrator 必须幂等、确定性，失败抛 `MigrationError`

**后果**：所有读取路径必须经过 `migrateToCurrent`；前端永远只见 `CURRENT_SCHEMA_VERSION = "1.0"`。

---

### ADR-10：Contract test 为系统大脑的主防线（含例外条款）🟡

**决策**：纯函数模块视为"系统大脑"，要求 ≥ 95% 分支覆盖 + snapshot 锁定。

**例外条款**（不计入覆盖率）：
- `default: throw new Error("unreachable")` 类型 narrow 后的 unreachable defaults
- TypeScript exhaustive check 辅助函数（如 `assertNever`）
- 纯类型层断言函数（无运行时逻辑）

例外通过 `/* istanbul ignore next */` 注释 + PR review 双重把关。

---

### ADR-11：单体 Next.js 部署，按需横向扩展 🟢

**决策**：单体 Next.js Node.js 进程承载所有 API、SSR、SSE；前置 Nginx / Caddy。多实例扩展时横向加进程，session 状态走 PG。

**后果**：单实例 OOM / restart 影响所有用户；可观测告警需重点覆盖进程健康。

---

### ADR-12：LLM Provider 抽象 🟡

**决策**：pi-agent 通过 `LlmProvider` 接口对接模型；具体实现在 `src/ai/providers/` 下。选择由 ENV `SDS_LLM_PROVIDER` 决定，API key 由 ENV `SDS_LLM_API_KEY` 提供。Provider 接口暴露 token 计数、流式输出、tool call 协议三个能力。

**streaming 协议适配**：OpenAI SSE 与 Anthropic SSE 协议不同；各 provider 在内部统一映射到 pi-agent 期望的事件流形状。tool call schema 差异同样在 provider 内部隔离。

**后果**：新增 provider 需实现完整接口 + 通过 `tests/providers/` 中的契约测试套件。

---

### ADR-13：API 路径暂不引入版本前缀 🟢

**决策**：当前阶段不加版本前缀，所有 API 维持 `/api/*`。Schema 版本化（§10）覆盖文档结构演进；API 边界破坏性变更通过协调发布解决。

**后果**：未来引入 `/v1/` 时需要一次 routing 层重构。

---

## 17. 各层 AGENTS.md 约束摘要

| 层 | 文件路径 | 核心约束 | 状态 |
|----|---------|---------|------|
| Contracts | `src/contracts/AGENTS.md` | 只含类型/schema/validation | 🟢 |
| Domain | `src/domain/AGENTS.md` | 纯业务规则，无 React/fetch/DB/FS | 🟢 |
| Server | `src/server/AGENTS.md` | 仅 server-only；**所有路由首行必须 `requireServerSession`** | 🟢；🟡 路由约束待加 |
| Web | `src/web/AGENTS.md` | feature-scoped；`fetch` 全部 `credentials: "include"` + mutating 加 `X-CSRF-Token` | 🟢；🟡 fetch 约束待加 |
| App | `src/app/AGENTS.md` | 仅路由入口；**禁止从 req.json/searchParams 读 userId/workspaceId** | 🟢；🟡 identity 约束待加 |
| Renderers | `src/renderers/AGENTS.md` | 禁止导入 React viewer/authoring UI/DB | 🟢 |
| ECharts | `src/renderers/echarts/AGENTS.md` | 新 recipe 必须注册到 `chart-recipe-registry.ts` | 🟢 |
| Presentation | `src/presentation/AGENTS.md` | 无 React/DB/FS；颜色用 `DashboardTheme.chart` token | 🟢 |
| Dashboard Render | `src/web/dashboard/render/AGENTS.md` | `chart-frame.tsx` 只渲染已物化好的 option 外框 | 🟢 |
| Viewer State | `src/web/viewer/state/AGENTS.md` | `materializeEChartsOptionTemplate` 在渲染前调用一次 | 🟢 |
| Guards | `src/server/guards/AGENTS.md` | 容量上限集中在 `quotas.ts`；rate limit 在 `rate-limit.ts` | 🟡 |
| Auth | `src/server/auth/AGENTS.md` | 唯一入口 `requireServerSession`；密钥支持轮换；token 不出现在日志 payload；mutating 必查 CSRF | 🟡 |
| Migrations | `src/server/dashboards/migrations/AGENTS.md` | 每个 migrator 必须幂等、确定性；必须有 fixture 测试；失败 throw `MigrationError` | 🟡 |
| Observability | `src/server/logs/AGENTS.md` | 调用方只能通过 `observability.emit`；事件类型遵循 §5.4 命名；`level` 与 `type` 正交 | 🟡 |
| Config | `src/server/config/AGENTS.md` | 所有 ENV 在 `load.ts` Zod schema 中声明；启动时 fail-fast | 🟡 |
| LLM Providers | `src/ai/providers/AGENTS.md` | 新 provider 实现 `LlmProvider` 接口；通过契约测试套件 | 🟡 |
| i18n | `src/web/i18n/AGENTS.md` | 所有 key 在 `keys.ts` 集中导出；en-US 必须完整；模型/服务端错误返 `message_i18n_key` 字段 | 🟡 |
| DB | `src/server/db/AGENTS.md` | Migration 文件命名 `{seq:0000}_{snake_case}.sql`；单文件单 transaction；不支持 down migration | 🟡 |

---

## 附录 A：术语表

| 术语 | 定义 |
|------|------|
| `DashboardDocument` | 系统单一真相来源，由 `dashboard_spec + query_defs + bindings + 🟡 schema_version` 构成 |
| `WorkingDraft` | Agent 内存中暂存的 dashboard 变更草稿，未持久化前不影响真实文档 |
| `PendingProposal` | composePatch 产出的变更提案，含 `proposalId + baseVersion + fingerprint + 🟡 expires_at` |
| `Recipe` | 一种图表类型的封装，包含 ECharts option template + slot 定义 + 数据 transforms |
| `Skill` | AI 视角下的 recipe，附加 `buildQueryDef` 等"如何生成查询"的逻辑 |
| `Surface` | 当前 turn 允许 Agent 使用的工具集合 + 提示词块组合（chat/inspect/author/approval 四种 mode） |
| `AuthoringCapabilityProfile` | turn-level 高层意图分类（chat / explore / author-* / approval） |
| `AuthoringScope` | turn-level 上下文范围（whole dashboard / focused view / empty） |
| `WorkspacePolicy` 🟡 | 从 `UserSession.permissions` 派生的工具可见性策略 |
| `AgentContextScope` | 从对话语境派生的工具可见性策略 |
| `BindingResult` | 单 binding 的查询结果状态（loading / ok / error） |
| `UserSession` 🟡 | `requireServerSession` 返回的服务端验证身份，identity 唯一来源 |
| `Quota` 🟡 | 绝对资源上限（如 view 数、文档大小） |
| `Rate Limit` 🟡 | 按时间窗口的请求频率上限 |
| `Migrator` 🟡 | Schema 版本之间的纯函数转换器，必须幂等 |
| `SchemaVersion` 🟡 | DashboardDocument 的显式版本字段；现状是 spec 内 v0.3，目标顶层 v1.0 |
| `Sink` 🟡 | ObservabilityBus 的事件接收方（JsonlFileSink / OpenTelemetrySink / ...） |

---

## 附录 B：目标态新增类型与字段清单

下列符号当前实现中**不存在**或与目标态**不一致**，迁移完成后均应到位。详见 [docs/migration.md](./migration.md) 对应 Sprint。

### B.1 类型 / 接口

| 符号 | 位置 | 用途 | 状态 |
|------|------|------|------|
| `UserSession` | `src/server/auth/require-session.ts` | 服务端验证身份（含 permissions、requestId） | 🟡 |
| `Permission` (enum) | `src/server/auth/permissions.ts` | 权限粒度联合类型 | 🟡 |
| `WorkspacePolicy` | `src/server/auth/workspace-policy.ts` | 从 session 派生的工具可见性 | 🟡 |
| `ObservabilityEvent` | `src/server/logs/observability.ts` | 统一事件结构 | 🟡 |
| `LogSink` | `src/server/logs/observability.ts` | sink 接口 | 🟡 |
| `ObservabilityBus` | `src/server/logs/observability.ts` | 事件总线 | 🟡 |
| `SchemaVersion` 提升至顶层 | `src/contracts/dashboard.ts` | DashboardDocument 顶层版本字段 | 🔴 现状在 spec 内，需迁移 |
| `Migrator` | `src/server/dashboards/migrations/types.ts` | 迁移器接口 | 🟡 |
| `LlmProvider` | `src/ai/providers/types.ts` | 模型供应商抽象 | 🟡 |
| `MigrationError` | `src/server/dashboards/migrations/errors.ts` | 迁移失败异常 | 🟡 |
| `ApiError` | `src/server/api-error.ts` | 标准 HTTP 错误（含 i18n key） | 🟡 |

### B.2 字段

| 位置 | 新增字段 | 状态 |
|------|---------|------|
| `DashboardDocument` 顶层 | `schema_version: SchemaVersion` | 🔴 现状在 `dashboard_spec.schema_version` |
| `BindingResultError` | `message_i18n_key: string`（替代 `message`） | 🟡 |
| `PendingProposal` | `expires_at: number` | 🟡 |
| `AuthoringToolRegistration` | `requiredPermissions: Permission[]` | 🟡 |
| `datasource_connections` 表 | `workspace_id text not null references workspaces(id)` | 🔴 现状无此字段 |

### B.3 模块 / 文件

| 路径 | 用途 | 状态 |
|------|------|------|
| `src/server/auth/` | Auth 模块 | 🟡 |
| `src/server/guards/quotas.ts` | Quota 常量与校验函数 | 🟡 |
| `src/server/guards/rate-limit.ts` | Rate limit 实现 | 🟡 |
| `src/server/config/load.ts` | ENV 加载与 Zod 校验 | 🟡 |
| `src/server/db/migrations/` | DB schema migration SQL 文件 | 🟡 |
| `src/server/dashboards/migrations/` | Dashboard schema migrator 集合 | 🟡 |
| `src/server/logs/observability.ts` | ObservabilityBus 主入口 | 🟡 |
| `src/server/logs/sinks/` | 各 sink 实现 | 🟡 |
| `src/ai/providers/` | LLM provider 抽象与实现 | 🟡 |
| `src/web/api/server-fetch.ts` | SSR cookie 转发封装 | 🟡 |
| `src/web/dashboard/render/chart-error-placeholder.tsx` | BindingResult 错误占位组件 | 🟡 |
| `src/web/auth/login/` | 登录页面与表单 | 🟡 |
| `eslint-rules/no-identity-in-request.js` | ESLint custom rule | 🟡 |

### B.4 ENV 变量

详见 §15.2 与 [docs/migration.md](./migration.md) Sprint 0 / -2。

---

*文档结束。如有架构变更，请同步更新对应的 ADR 条目和层约束说明；从旧实现的迁移路径见 [docs/migration.md](./migration.md)。*
