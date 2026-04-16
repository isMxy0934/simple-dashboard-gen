# 深度技术审计与架构分析

## 项目概览

AI 驱动的 BI Dashboard 生成系统，基于 Next.js + Vercel AI SDK + PostgreSQL。核心架构围绕 `DashboardDocument = DashboardSpec + QueryDefs + Bindings` 契约内核展开。Agent 通过 tool-first 模式操作 dashboard 文档，用户通过聊天界面与 Agent 交互。

---

## 1. Agent 与 Sub-agent 架构设计

### 1.1 任务拆解与职责边界

当前采用二级路由模式：`Main Agent (Router)` → `Dashboard Worker` / `View Worker`。

**优点**：
- 职责边界清晰：Dashboard Worker 负责全局布局/多视图操作，View Worker 聚焦单视图编辑
- Worker 通过 `activeTools` 白名单严格限制可用工具，防止越权
- `prepareWorkerStep` 在 `applyPatch` 后立即设 `toolChoice: "none"`，阻止 Worker 继续操作

**风险点**：

| # | 风险 | 严重度 | 位置 | 建议 |
|---|------|--------|------|------|
| R1 | **路由基于正则硬编码** — `GLOBAL_REQUEST_PATTERN` 用正则匹配中英文关键词判断是否升级到 dashboard worker，脆弱且不可扩展 | 🔴 高 | `src/ai/main-agent/routing.ts` | 用 LLM 做轻量级 intent classification 或 embedding + threshold，保留正则作为快速 short-circuit，增加 fallback 语义路由 |
| R2 | **View 标题精确匹配** — `latestUserText.includes(view.title)` 做视图匹配，用户说"销售趋势图"但视图标题是"Sales Trend"时会失败 | 🔴 高 | `src/ai/main-agent/routing.ts` | 改用模糊匹配或 embedding 相似度，加上 i18n 视图别名映射 |
| R3 | **Dashboard Worker 与 View Worker 的 `workflow.ts` 高度重复** — `WorkerWorkflow`、`WorkerEngineControl`、`createWorkerWorkflow` 几乎完全一致 | 🟡 中 | `src/ai/dashboard-worker/workflow.ts` vs `src/ai/view-worker/workflow.ts` | 抽取共享的 `BaseWorkerWorkflow` 到 `src/ai/shared/`，各 worker 只扩展差异部分 |
| R4 | **缺少 Orchestrator 层** — 当前路由是一次性决策，不支持 Worker 间协作（如"在每个视图上加过滤器"需要多次 View Worker 迭代） | 🟡 中 | `src/server/main-agent/chat-service.ts` | 增加 `AgentOrchestrator`，支持将复合任务拆解为多个 Worker 子任务并聚合结果 |

### 1.2 通信与协作机制

Worker 之间无直接通信。Main Agent 做一次路由后全权委托给单个 Worker。上下文通过 `MainAgentDependencies` 接口注入。

**问题**：`MainAgentDependencies` 所有字段都是可选的（`?`），运行时任何依赖都可能不存在，工具代码中大量使用 `input.dependencies?.executePreview?.()` 可选链调用。如果关键依赖缺失，Agent 会静默跳过而非显式失败。建议将核心依赖标为 required，仅 `writeTraceEvent` 保持 optional。

### 1.3 容错处理

| # | 风险 | 严重度 | 位置 | 建议 |
|---|------|--------|------|------|
| R5 | **静默吞异常** — `listMainAgentChecks`、`listAgentDatasources`、`listMainAgentSkills` 的失败被 `.catch(() => [])` 吞掉，Agent 在无数据源/无技能情况下仍然启动，用户无法感知降级 | 🔴 高 | `src/server/main-agent/chat-service.ts` | 至少将失败写入 trace event 并在 UI 显示降级警告 |
| R6 | **无 LLM 调用重试** — `ToolLoopAgent` 使用 `stepCountIs(20)` 做硬上限，但 LLM API 本身的 429/500 错误无重试逻辑 | 🟡 中 | `src/ai/dashboard-worker/engine/loop.ts` | 在 Worker 层增加指数退避重试（Vercel AI SDK 支持 `maxRetries`） |
| R7 | **maxDuration = 30** — 30 秒超时对复杂多步 Agent 任务可能不足 | 🟡 中 | `src/server/main-agent/chat-service.ts` | 根据任务复杂度动态设置，或使用流式长连接模式 |

---

## 2. 用户交互设计 (UX/UI)

### 2.1 交互流反馈

使用 Vercel AI SDK 的 `useChat` + `DefaultChatTransport` 实现流式输出，状态有 `submitted`/`streaming` 两个关键阶段。

| # | 风险 | 严重度 | 位置 | 建议 |
|---|------|--------|------|------|
| R8 | **工具执行无中间反馈** — Worker 可能运行 20 步 tool loop，用户只看到文字流和最终的 approval patch，不知道 Agent 当前在做什么 | 🟡 中 | `src/web/authoring/agent/use-agent-session.ts` | 利用 `experimental_onToolCallStart`/`Finish` 事件在 UI 展示 Agent 正在执行的工具名和简要描述 |
| R9 | **`agentUiAlert` 只保留最后一条** — 多次连续失败只能看到最后一次错误 | 🟢 低 | `src/web/authoring/agent/use-agent-session.ts` | 改为 alert 队列或 toast 通知 |

### 2.2 输入引导与约束

- 有基本的 intent 分类（`chat`/`authoring`/`approval`），能识别能力询问
- `buildWorkerSystemPrompt` 包含明确指令让 Agent 在用户未提供数据需求时主动追问
- **缺失**：没有前端层面的输入校验或引导（如空 dashboard 时的 onboarding 提示）

### 2.3 结果呈现

- Patch Approval 机制设计良好 — Agent 生成变更后通过 `composePatch` → `applyPatch` 走 human-in-the-loop 审批
- `redactHeavyDashboardSnapshotsForTransport` 在传输前裁剪大型快照，避免前端卡顿
- **建议**：增加可视化 Diff 预览，在 approval 阶段向用户展示 dashboard 变更前后的差异

---

## 3. 代码实现质量

### 3.1 模块化与解耦

**优点**：
- 严格分层：`contracts` → `domain` → `ai` → `server` → `web` → `app`
- `MainAgentDependencies` 依赖注入模式使 Worker 可测试
- `DashboardDocument` 作为单一契约内核，所有模块围绕同一数据结构运作

**问题**：

| # | 风险 | 严重度 | 位置 | 建议 |
|---|------|--------|------|------|
| R10 | **Dashboard Worker 和 View Worker 的 `tools.ts` 大量重复** | 🔴 高 | `src/ai/dashboard-worker/tools/tools.ts` vs `src/ai/view-worker/tools/tools.ts` | 抽取共享工具工厂到 `src/ai/shared/tools/` |
| R11 | **`engine/loop.ts` 完全重复** — 两个 Worker 的 `ToolLoopAgent` 构建代码几乎一致 | 🟡 中 | `dashboard-worker/engine/loop.ts` vs `view-worker/engine/loop.ts` | 提取 `createWorkerAgentLoop(workerId, ...)` 工厂函数 |
| R12 | **`chat-session-orchestrator.ts` 两处 `createWorkerWorkflow` 调用几乎一致** | 🟡 中 | 行 50-68 vs 行 134-158 | 抽取 `buildOrchestratorWorkflow(...)` |
| R13 | **全局变量污染** — `globalThis.__mainAgentActiveStreams`、`globalThis.__mainAgentTraceWriteQueues` 等 | 🟡 中 | `active-streams.ts`, `session-log-writer.ts` | 使用 `WeakRef`/`FinalizationRegistry` 或 Next.js 的 `unstable_cache` 替代 |


### 3.2 异常处理

- Tracing 的静默失败是合理设计（不因日志故障阻断业务）
- 但缺少 **fallback 日志通道**（如 stderr 或 sentry），磁盘满了/权限错误时完全无感知

### 3.3 性能与 DRY

| # | 风险 | 位置 | 建议 |
|---|------|------|------|
| R14 | `stripMainAgentMessagesForModel` 在请求链路中被调用多次 | `chat-service.ts` + `chat-session-orchestrator.ts` | 缓存结果或统一到入口处理一次 |
| R15 | `buildMainAgentModelInput` 每次都重新构建 context block 并计算 SHA-256 fingerprint | `src/server/main-agent/model-input.ts` | fingerprint 可与 session 缓存对比提前短路 |
| R16 | `resolveProviderModelConfig()` 每次请求都重新解析环境变量和创建 provider | `src/ai/providers/model-config.ts` | 在模块顶层单例化 |

---

## 4. 扩展维度

### 4.1 可扩展性 (Scalability)

**Agent 扩展**：
- 新增 Worker 类型需要复制大量样板代码（workflow.ts + engine/loop.ts + tools.ts），扩展成本高
- **建议**：建立 Worker 注册表模式：

```typescript
interface WorkerDefinition {
  id: string;
  match: (route: MainAgentWorkerRoute) => boolean;
  activeTools: ActiveWorkerToolName[];
  systemPrompt: (ctx: WorkerContext) => string;
}
const workerRegistry: WorkerDefinition[] = [
  dashboardWorkerDef,
  viewWorkerDef,
  // 未来: filterWorkerDef, dataWorkerDef, ...
];
```

**数据库扩展**：
- Schema 设计合理，workspace → dashboard → draft/published 层级关系清晰
- `editing_sessions` 和 `editing_presence` 为协作编辑预留了基础设施
- **风险**：`dashboard_document jsonb` 存储整个文档，当文档增长时查询和传输开销大。建议考虑增量存储或分离大型 `option_template` 字段

### 4.2 安全性与合规性

| # | 风险 | 严重度 | 位置 | 建议 |
|---|------|--------|------|------|
| R17 | **无身份认证/授权** — API 路由不验证 `workspaceId`/`userId` 的真实性，任何人可以伪造身份 | 🔴 高 | `src/app/api/` | 增加 JWT/Session 认证中间件，验证 `userId` 属于 `workspaceId` |
| R18 | **Prompt 注入风险** — 用户输入直接拼入 context block 和消息历史，未做清理 | 🔴 高 | `src/server/main-agent/model-input.ts` | 对用户输入做 prompt boundary 标记（如 XML tag 隔离），在 system prompt 中明确指令优先级 |
| R19 | **SQL 注入风险** — Agent 生成的 `sql_template` 直接执行，虽有 preview/check 机制，但恶意用户可通过 prompt 引导 Agent 写危险 SQL | 🔴 高 | `src/server/execution/` | 对 Agent 生成的 SQL 执行只读连接（`SET TRANSACTION READ ONLY`），加上 statement timeout 和 row limit |
| R20 | **API Key 存储** — `OPENAI_API_KEY` 通过环境变量管理（可接受），`DATASOURCE_ENCRYPTION_KEY` 使用 AES-256-GCM 加密数据源凭据 | ✅ | `src/server/datasource/datasource-crypto.ts` | 当前加密实现质量较高 |
| R21 | **Session ID 可预测** — `buildMainAgentCompositeSessionId` 用 `:` 拼接四个用户提供的参数，可被枚举 | 🟡 中 | `src/server/main-agent/session-key.ts` | 增加 HMAC 签名或使用服务端生成的不透明 session token |

### 4.3 可观测性 (Observability)

当前实现基于文件的 JSONL trace（`logs/sessions/{sessionId}.jsonl`），每个事件包含 `ts`/`seq`/`scope`/`event`/`payload`。AI 专用 trace 文件（`.ai.jsonl`）通过白名单过滤关键事件。每个 tool call 的 start/finish 都有 trace。

| # | 风险 | 严重度 | 建议 |
|---|------|--------|------|
| R22 | **无结构化 Metrics** — 没有 token usage 聚合、延迟 P99、工具调用成功率等指标 | 🟡 中 | 从 trace 事件中提取 metrics（`usage` 字段已在 `step-finished` 中记录），接入 Prometheus/StatsD |
| R23 | **无分布式 Tracing** — 依赖 `@opentelemetry` 包已安装但未集成到 Agent 链路 | 🟡 中 | 用 OTel span 包装 `handleAgentChatRoute` → `resolveRoute` → `workerLoop` → `toolCall`，形成完整 trace waterfall |
| R24 | **Trace 文件无生命周期管理** — 无自动清理，长期运行会占满磁盘 | 🟡 中 | 增加 log rotation（按大小/时间），或迁移到 structured logging service |
| R25 | **manifest.jsonl 无并发保护** — 多个请求同时 `appendFile` 到 manifest 可能出现写入交错 | 🟢 低 | 使用 file lock 或迁移到数据库存储 |

---

## 5. 数据库 Schema 审计

| # | 风险 | 位置 | 建议 |
|---|------|------|------|
| R26 | `editing_sessions.user_id` 没有外键约束到 `workspace_users`，可以写入不存在的用户 | `editing_sessions` | 增加 `FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_users(workspace_id, user_id)` |
| R27 | `workspace_dashboard_drafts` 和 `workspace_dashboard_published` 缺少对 `saved_by_user_id`/`published_by_user_id` 的外键约束 | 同名表 | 增加外键约束 |
| R28 | `worker_checks` 无历史记录 — 每次 upsert 覆盖，无法追溯检查结果变化 | `worker_checks` | 考虑增加 `check_history` 表或保留最近 N 次结果 |
| R29 | 所有 `id` 字段使用 `text` 类型 — 没有格式/长度约束，可能存入空字符串或超长值 | 全表 | 增加 `CHECK (length(id) > 0 AND length(id) <= 128)` |
| R30 | 缺少 `workspace_dashboards` 对 `created_by_user_id` 的外键 | `workspace_dashboards` | 如需追踪创建者，应加外键约束 |

---

## 6. 优先级排序的改进路线图

### Phase 1 — 安全（立即修复）

- R17: 增加 API 认证
- R19: SQL 执行只读化 + timeout
- R18: Prompt 注入防御
- R5: 静默吞异常 → 降级通知

### Phase 2 — 可靠性（2 周内）

- R1/R2: 路由语义化升级
- R6: LLM 调用重试
- R10/R11: Worker 代码去重
- R26-R30: 数据库约束加固

### Phase 3 — 可观测性（1 月内）

- R22: Metrics 采集
- R23: OTel 分布式 Tracing
- R24: Log rotation
- R8: 工具执行中间反馈

### Phase 4 — 可扩展性（长期）

- R4: Agent Orchestrator 层
- Worker Registry 模式
- 增量文档存储