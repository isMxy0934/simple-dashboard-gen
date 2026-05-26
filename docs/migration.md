# Migration Plan — 从现有实现迁移到目标架构

> **目标架构**：见 [docs/architecture.md](./architecture.md)  
> **本文档定位**：把当前代码的实现状态，逐 Sprint 收敛到目标架构。一次性破坏性更新，**不保留兼容层**。  
> **总投入估算**：12–14 周（单人全职），可并行加速到 7–8 周。  
> **文档生命周期**：迁移完成后归档至 `docs/archive/migration-2026-q2.md`。

> **Finalization status (2026-05-26)**: Code-level migration work is complete for the provider-compatible local auth flow and single-workspace product shape. Current login uses local DB credentials, `auth_identities`, local roles/permissions, and the same `sds_session` app JWT that Auth0 will use later. Operational completion requires the commands in docs/operations.md: production backup, staging empty-database migration rehearsal, dashboard usage audit, and observability endpoint verification. Real Auth0 credential validation is a planned follow-up provider integration, not part of this finalized migration.

> **归档说明**：本文件保留为 finalized migration record。迁移前计划快照见 [docs/archive/migration-2026-q2.md](./archive/migration-2026-q2.md)。

> **本版本修订（v4）说明**：在 v2/v3 基础上继续吸收评审——
> 1. **Phase A 启动顺序**：`ensureCloudAuthoringSchema → migrations runner`（修复新 DB 启动失败）
> 2. **Schema 类型统一**：`DashboardDocumentSchemaVersion` / `LegacyDashboardSpecSchemaVersion` 两类型分离
> 3. **Sprint -2 前置**：`mkdir docs/audit docs/decisions` + **Lint 工具链决策**
> 4. **LLM Provider**：标注现有 `PiModelRuntime`；`SDS_*` fallback `PI_*`；保留 DeepSeek
> 5. **存储模型 / 路由 / quota / BindingResult** 等与代码对齐（v3 评审项）
> 6. **v4 补充**：LLM ENV fail-fast 范围、差距表 10 项、Sprint 1 覆盖 #1/#2/#7/#8
>
> v2 初版要点：Sprint -2 Baseline、Sprint 重排、Schema v0.3→v1.0 路径、回滚方案。

---

## 目录

1. [迁移总览](#1-迁移总览)
2. [Sprint -2：Baseline 对齐](#2-sprint--2baseline-对齐1-周)
3. [Sprint -1：前置 Audit](#3-sprint--1前置-audit05-1-周)
4. [Sprint 0：脚手架与契约](#4-sprint-0脚手架与契约1-周)
5. [Sprint 1：Auth + Datasource 权限 + CSRF](#5-sprint-1auth--datasource-权限--csrf3-4-周)
6. [Sprint 2：ObservabilityBus](#6-sprint-2observabilitybus1-2-周)
7. [Sprint 3：失败模式与降级](#7-sprint-3失败模式与降级2-周)
8. [Sprint 4：容量上限与限流](#8-sprint-4容量上限与限流1-2-周)
9. [Sprint 5：Schema 版本化（v0.3 → v1.0）](#9-sprint-5schema-版本化v03--v101-周)
10. [Sprint 6：Contract 测试加固 + E2E](#10-sprint-6contract-测试加固--e2e1-2-周)
11. [横向工作流](#11-横向工作流)
12. [清理与文档同步](#12-清理与文档同步)
13. [最终验收清单](#13-最终验收清单)
14. [回滚方案](#14-回滚方案)
15. [风险与时间预估](#15-风险与时间预估)

---

## 1. 迁移总览

### 1.1 Finalized Status

| 维度 | 完成状态 | 最终状态 | Sprint |
|------|---------|------|--------|
| 包管理 / 测试 | 已完成：`npm` + `node --test --experimental-strip-types` + Playwright | Finalized test tooling | **-2** |
| Auth | 已完成：统一 `requireServerSession`，local DB credential provider，`auth_identities` 身份映射，本地 roles/permissions，HTTP-only `sds_session` JWT；Auth0 接入后复用同一 provider identity → app session 流程 | Finalized provider-compatible identity boundary | 1 |
| Datasource 权限 | 已完成：管理、执行、schema 探查入口均执行 `requireServerSession + requirePermission + default workspace namespace`；当前产品为单 workspace，`ws_default` 是唯一 active workspace | Finalized single-workspace datasource namespace | 1 |
| execute-batch body identity | 已完成：服务端以 `session.workspaceId` 的默认 namespace 覆盖执行上下文；请求体 workspace 字段不再是身份来源 | Finalized session-scoped execution | 1 |
| CSRF | 已完成：Origin 校验 + 可选 double-submit token | Finalized mutating-route CSRF policy | 1 |
| 前端登录态 | 已完成：HTTP-only cookie，前端无 token/localStorage identity；SSR cookie 转发封装；当前 login 为 local DB credential provider | Finalized browser session flow | 1 |
| 工具注册 | 已完成：`AuthoringToolRegistration.requiredPermissions` 全覆盖，`WorkspacePolicy.derive` 在 turn 入口过滤 | Finalized tool permission surface | 1 |
| 可观测性 | 已完成：`observability.emit` + `ObservabilityBus` + 多 sink；含 `requestId` / `level` | Finalized observability bus | 2 |
| 事件命名 | 已完成：标准 `agent.*` / `query.*` / `document.*` / ...（见架构 §5.4） | Finalized event taxonomy | 2 |
| 失败处理 | 已完成：集中失败模式矩阵（架构 §7.1）+ i18n 文案 | Finalized failure model | 3 |
| 容量上限 | 已完成：`src/server/guards/quotas.ts` 集中声明 | Finalized quota guards | 4 |
| Rate Limit | 已完成：`src/server/guards/rate-limit.ts` 路由级令牌桶 | Finalized rate limiting | 4 |
| Schema 版本类型 | 已完成：`DashboardDocumentSchemaVersion = "1.0"`（顶层）+ `LegacyDashboardSpecSchemaVersion = "0.3"`（spec 内，v2.0 删除） | Finalized schema version split | 5 |
| 测试金字塔 | 已完成：Contract 主防线 + E2E（Playwright）+ final acceptance gate | Finalized verification stack | 6 |
| DB Schema 管理 | 已完成：显式 `src/server/db/migrations/*.sql` + runner | Finalized migration runner | 横向（§11.1） |
| Config 加载 | 已完成：`src/server/config/load.ts` 校验 SDS_* + 映射 PI_*；provider auth ENV passthrough allowlist | Finalized config loader | 横向（§11.2） |
| LLM Provider | 已完成：`PiModelRuntime` provider resolution、`SDS_LLM_*` 映射、DeepSeek/OpenAI 配置测试 | Finalized provider runtime | 横向（§11.3） |
| i18n | 已完成：用户可见错误走 i18n key；服务端返 `message_i18n_key` | Finalized i18n coverage | 横向（贯穿 Sprint 3） |

### 1.2 Sprint 顺序与依赖（已重排，打破循环）

```
Sprint -2 (Baseline)        ← 必须先做：工具链 / 真实命令 / 路由清单 / Schema 路径
    ↓
Sprint -1 (Audit)
    ↓
Sprint 0 (脚手架)
    ↓
Sprint 1 (Auth + Datasource + CSRF)     ★ 强依赖 ★ 安全收敛
    ↓
Sprint 2 (ObservabilityBus + 事件命名)
    ↓
Sprint 3 (失败矩阵 + i18n)              ← 依赖 Sprint 2 的事件类型
    ↓
Sprint 4 (Quota + Rate Limit)           ← 用 Sprint 2 的 observability 打点
    ↓
Sprint 5 (Schema v0.3 → v1.0)           ← 依赖 Sprint 0 的 schema-version.ts
    ↓
Sprint 6 (Contract + E2E 加固)          ★ 整体覆盖 ★ 验证全栈不变量
```

**关键变化**：
- Sprint 6 改为**整体加固**，不再"提前"被 Sprint 4 验收依赖
- Sprint 4 的边界值测试用 Sprint -2 选定的测试工具直接写，不等 Sprint 6
- Sprint 5 的 migrator fixture 测试同样在自己 Sprint 内完成

### 1.3 破坏性更新声明

本次迁移**不提供向后兼容**：

- 所有 API 路由签名变更（删除 body / query 中的 identity 字段）
- 前端 localStorage identity session 彻底删除
- `DashboardDocument` 顶层增加 `schema_version`；旧文档加载强制走 migrator
- `datasource_connections` 表 schema 变更：加 `workspace_id` 字段，旧数据归属单 workspace namespace `ws_default`
- 旧 trace 直写入口删除，所有调用方迁移到 `observability.emit`
- 事件命名格式变更（旧 trace 文件不再被新 trace viewer 解析）
- 所有 mutating 路由必须带 CSRF 校验（Origin / Token），未带的请求 403

**部署窗口前必须完成**：
- Auth0 未接入前，登录为 local DB credential provider；Auth0 上线前需另行完成 Auth0 tenant/client/callback/CI secret/E2E 策略，并复用 `auth_identities` 与本地 roles/permissions
- Staging 环境跑通完整 E2E + 一组真实用量的 dashboard 样本
- 数据库备份点已建立（详见 §14 回滚方案）

---

## 2. Sprint -2：Baseline 对齐（1 周）

**目标**：在任何"目标态"代码动工之前，先把**工具链、命令脚本、真实 Schema 路径、ENV 兼容**这些基础事实对齐文档与代码。这一步避免后续 Sprint 用到不存在的命令、错误的 Schema 假设。

### 2.0 前置步骤（Sprint -2 第 1 步，评审 v4 #3）

当前仓库只有 `docs/archive/`，Sprint -2 的 audit 命令会直接写 `docs/audit/*` 和 `docs/decisions/*`。**必须先创建目录**，否则 `tee` / 重定向失败：

```bash
mkdir -p docs/audit docs/decisions docs/archive
```

Sprint 0 §4.1 不再重复创建 `docs/audit` / `docs/decisions`（保留 `docs/archive` 幂等创建即可）。

### 2.1 决策项（必须在本 Sprint 内拍板）

#### 决策 1：包管理与测试工具链

文档前版多处假设 `pnpm + vitest + playwright`，但实际是 `npm + node --test --experimental-strip-types`。三选一：

| 选项 | 优点 | 缺点 | 推荐场景 |
|------|------|------|---------|
| **A. 保留 npm + node --test** | 零迁移成本；Node 22 原生支持 TS（strip-types） | 无内置 snapshot；coverage 工具弱；watch 体验差；无 BDD 风格 | 团队对现状满意；不打算花精力升级 |
| **B. 切到 vitest（推荐）** | 强 snapshot、watch、coverage；与 Vite/Next 生态对齐 | 引入新依赖；需要迁移现有 `tests/*.test.ts` 文件 | 想长期提升测试能力 |
| **C. 混合**：Contract 用 vitest，老 integration 保留 node --test | 渐进迁移成本最低 | 两套测试 runner 维护负担 | 团队规模较大、风险厌恶 |

**E2E** 不可避免：**新增 Playwright**（`node --test` 不做 E2E）。

**决策产出**（Sprint -2 第 1 天确定）：
- 写入 `docs/decisions/0001-test-tooling.md`，含选型 + 理由
- 更新 `package.json` 的 `scripts`，新增（按选型）：
  - 选 A：`"test:contract": "node --test --experimental-strip-types src/**/__contract__/*.test.ts"`
  - 选 B：`"test:contract": "vitest run src/{domain,contracts,...}"`
  - 共同：`"test:e2e": "playwright test"`

#### 决策 2：包管理器（npm vs pnpm）

文档此前预设 pnpm。同样三选一：

- **A. 保留 npm**（推荐）：当前已用，迁移工具链是无谓投入
- **B. 切 pnpm**：磁盘节省、workspaces 友好，但本仓库是单包

**默认推荐 A（保留 npm）**，除非有强诉求。所有文档中 `pnpm` 替换为 `npm`。

#### 决策 3：CI 平台

文档假设有 CI（"CI fail"），但仓库未确认 CI 配置。本 Sprint 确认：

- 用 GitHub Actions（最常见）
- 还是其它（Jenkins / GitLab / 自建）？

输出：`.github/workflows/ci.yml` 骨架（在 Sprint 0 完成实际接入）。

#### 决策 4：Lint 工具链（评审 v4 #4）

当前 `package.json` **无** `lint` script，仓库也**无** ESLint 依赖或配置文件；但 Sprint 0/1/6 多处验收要求 `npm run lint` 和 custom rule `no-identity-in-request`。必须在 Sprint -2 拍板：

| 选项 | 内容 | 推荐 |
|------|------|------|
| **A. 新增 ESLint flat config（推荐）** | 安装 `eslint` + `@eslint/js` + `typescript-eslint`；`eslint.config.js`；`package.json` 加 `"lint": "eslint src/app/api src/server/auth eslint-rules"`；custom rule 放 `eslint-rules/no-identity-in-request.js` | ✅ |
| **B. 暂不用 ESLint，改用 tsc + rg 脚本** | `"lint": "npm run typecheck && node scripts/check-no-identity-in-request.mjs"`；验收改口径 | 团队极度排斥 ESLint 时 |

**决策产出**（Sprint -2 第 1–2 天确定）：
- 写入 `docs/decisions/0002-lint-tooling.md`
- Sprint 0 §4.4 按决策落地依赖、配置、`lint` script（warn 模式）
- Sprint 1 完成后切 error 模式

### 2.2 真实 Schema 路径校准（评审 #3）

修订架构 §10 / migration §9 的 Schema 描述，对齐**真实代码**：

- 当前 `src/contracts/dashboard.ts:3`：`export type SchemaVersion = "0.3";`
- 当前 `:15`：`DashboardSpec.schema_version: SchemaVersion`
- 当前 `:298`：`DashboardDocument` 顶层**无** `schema_version`

**目标迁移路径**（v0.3 → v1.0）：

```typescript
// 现状文档结构
{
  dashboard_spec: { schema_version: "0.3", views: [...], ... },
  query_defs: [...],
  bindings: [...]
}

// v0.3 → v1.0 migrator 输出
{
  schema_version: "1.0",                                     // ★ 新增顶层
  dashboard_spec: { schema_version: "0.3", views: [...], ... },  // 内部冗余保留至 v2.0
  query_defs: [...],
  bindings: [...]
}
```

**冗余字段保留原因**：v1.0 阶段允许旧二进制（仍读 `dashboard_spec.schema_version`）继续工作，便于回滚；v2.0 时再通过 migrator 删除该冗余。

Sprint -2 产出：
- 在 `docs/decisions/` 或 `docs/audit/schema-version-design.md` 中记录目标类型方案（**禁止**使用单一 `SchemaVersion = "0.3" | "1.0"`）：
  - `DashboardDocumentSchemaVersion = "1.0"`（顶层）
  - `LegacyDashboardSpecSchemaVersion = "0.3"`（spec 内冗余）
  - `CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION = "1.0"`
- Sprint 0 创建 `src/contracts/schema-version.ts` 时按上述两类型实现（见 §9.1）
- 写一份 v0.3 真实文档的 fixture 到 `src/server/dashboards/migrations/__fixtures__/v0.3/sample.json`（从 staging DB 导出一个真实 dashboard）

### 2.3 API Route 真实清单

```bash
find src/app/api -type f -name "route.ts" | sort | tee docs/audit/route-inventory.md
```

对每个路由记录（输出 `docs/audit/route-inventory.md`）：

```markdown
| 路由 | HTTP method | 当前 identity 来源 | 目标权限 | Sprint 1 改造状态 |
|------|------------|------------------|---------|------------------|
| /api/dashboards | GET | searchParams.workspaceId | dashboard.read | [x] |
| /api/dashboards | POST | searchParams.workspaceId+userId | dashboard.edit | [x] |
| /api/datasources | GET | 无 | datasource.read | [x] |
| /api/datasources | POST | 无 | datasource.manage | [x] |
| /api/authoring/trace | GET | searchParams.userId+workspaceId | dashboard.read | [x] |
| ... | ... | ... | ... | ... |
```

完整清单作为 Sprint 1 §5.5 路由改造的 driver。

### 2.4 ENV 兼容映射

当前实际使用的 ENV：

```bash
rg -o "process\.env\.([A-Z_]+)" -r '$1' src/ | sort -u > docs/audit/env-inventory.md
```

记录每个现有 ENV 到目标 `SDS_*` 命名的兼容映射（如有重命名）。

### 2.5 现有 Dashboard 用量盘点（评审 v3 #1 修正：表名与列名以代码为准）

实际存储是 `workspace_dashboard_drafts.dashboard_document` 与 `workspace_dashboard_published.dashboard_document`，不是 `dashboard_documents.document_jsonb`。

```sql
-- 在 staging DB（不要生产）
-- 1. 草稿态 dashboard 当前用量
SELECT
  d.workspace_id,
  count(distinct d.dashboard_id)                                              as draft_count,
  max(jsonb_array_length(d.dashboard_document->'dashboard_spec'->'views'))     as max_views,
  max(jsonb_array_length(d.dashboard_document->'query_defs'))                  as max_queries,
  max(octet_length(d.dashboard_document::text))                                as max_doc_bytes
FROM workspace_dashboard_drafts d
INNER JOIN (
  SELECT workspace_id, dashboard_id, max(version) AS max_v
  FROM workspace_dashboard_drafts GROUP BY 1, 2
) latest USING (workspace_id, dashboard_id)
WHERE d.version = latest.max_v
GROUP BY d.workspace_id
ORDER BY draft_count DESC LIMIT 50;

-- 2. 已发布态 dashboard 当前用量（同上替换 drafts → published）
SELECT
  p.workspace_id,
  count(distinct p.dashboard_id)                                              as published_count,
  max(jsonb_array_length(p.dashboard_document->'dashboard_spec'->'views'))     as max_views,
  max(jsonb_array_length(p.dashboard_document->'query_defs'))                  as max_queries,
  max(octet_length(p.dashboard_document::text))                                as max_doc_bytes
FROM workspace_dashboard_published p
INNER JOIN (
  SELECT workspace_id, dashboard_id, max(version) AS max_v
  FROM workspace_dashboard_published GROUP BY 1, 2
) latest USING (workspace_id, dashboard_id)
WHERE p.version = latest.max_v
GROUP BY p.workspace_id
ORDER BY published_count DESC LIMIT 50;

-- 3. 当前 schema_version 真实分布（用于验证 Sprint 5 fixture 覆盖）
SELECT
  d.dashboard_document->'dashboard_spec'->>'schema_version' AS spec_schema_version,
  count(*)
FROM workspace_dashboard_drafts d
GROUP BY 1
ORDER BY 1;

-- 4. datasource 用量与 workspace 关联现状（评审 v3 #2 / #5：当前 datasource_connections 无 workspace_id）
SELECT count(*) AS datasource_count, count(distinct kind) AS distinct_kinds
FROM datasource_connections;
-- 现有 datasource 全部归属 workspace=ws_default（DEFAULT_WORKSPACE_ID）
-- 详见 §5.7 Sprint 1 数据迁移
```

输出 `docs/audit/dashboard-usage.md`，与架构 §8.1 默认 quota 对比。**如有现存 dashboard 超 quota，必须在 Sprint 4 上线前调整默认值或通知用户拆分**。

### 2.6 现有事件清单

```bash
find logs/sessions -name "trace.jsonl" -exec jq -r '.scope + "." + .event' {} \; 2>/dev/null \
  | sort | uniq -c | sort -rn > docs/audit/event-inventory.md
```

用于 Sprint 2 设计事件命名映射时确认覆盖。

### 2.7 验收

- [x] `docs/audit/`、`docs/decisions/` 目录已创建（§2.0）
- [x] `docs/decisions/0001-test-tooling.md` 写定
- [x] `docs/decisions/0002-lint-tooling.md` 写定（评审 v4 #4）
- [x] `package.json` `scripts` 含 `test:contract` / `test:e2e`，能跑通最小用例（empty test 也行）
- [x] `docs/audit/route-inventory.md` 完整列出所有路由
- [x] `docs/audit/env-inventory.md` 与架构 §15.2 ENV 对照表已映射
- [x] `docs/audit/dashboard-usage.md` 无现存 dashboard 触发 default quota；如有，记录建议覆盖值
- [x] `docs/audit/event-inventory.md` 与架构 §5.4 / §5.5 命名对照表
- [x] v0.3 真实 fixture 已从 staging 导出
- [x] CI 平台已确认（GitHub Actions 骨架文件存在）
- [x] **架构文档 §1.3 技术栈表 + §10 Schema 部分已经过 Sprint -2 决策回填**（已在评审 v2 完成）

---

## 3. Sprint -1：前置 Audit（0.5–1 周）

> 与 Sprint -2 部分内容有重叠。建议合并：**Sprint -2 与 -1 一并完成**，时间总计 1–1.5 周。

**目标**：在已经选定工具链后，跑通失败模式 audit、事件命名 audit、性能基线测量。

### 3.1 失败模式 audit

为架构 §7.1 矩阵中每行失败，定位现有代码：

```bash
rg "timeout|abort|catch" src/ai/authoring/
rg "try {" src/server/
```

输出审计报告 `docs/audit/failure-modes-audit.md`，每个失败一条，模板：

```
### 失败：模型超时
- 当前实现位置：src/ai/authoring/agent/session.ts:xxx
- 当前行为：catch + emit error event；前端无明确提示
- 缺口：
  - [x] 60s 硬超时（当前 ≥ 120s）
  - [x] SSE 流送 specific error code "agent.turn.error.timeout"
  - [x] 前端 toast + 重试按钮
  - [x] i18n key "error.authoring.agent_timeout"
- 责任人：xxx
```

### 3.2 性能基线测量

跑当前代码下的性能基线，作为 Sprint 6 性能基准对照：

```bash
# 例：node --test 跑 100 次 capability-scope 计算
# 输出 P50/P95/P99
node --test src/__benchmarks__/baseline.test.ts > docs/audit/perf-baseline.md
```

### 3.3 验收

- [x] `docs/audit/failure-modes-audit.md` 覆盖架构 §7.1 全部行
- [x] `docs/audit/perf-baseline.md` 含 4 项关键基准的当前数值

---

## 4. Sprint 0：脚手架与契约（1 周）

**目标**：为后续 Sprint 准备目录、类型契约、ENV 变量、空实现，**不改变现有行为**。

### 4.1 新建目录

```bash
mkdir -p src/server/auth src/server/guards src/server/config
mkdir -p src/server/dashboards/migrations
mkdir -p src/server/db/migrations
mkdir -p src/server/logs/sinks
mkdir -p src/ai/providers
mkdir -p docs/archive
# docs/audit、docs/decisions 已在 Sprint -2 §2.0 创建
```

### 4.2 新建文件（空实现 + 类型）

| 文件 | 内容 |
|------|------|
| `src/server/auth/require-session.ts` | `UserSession` 类型、`requireServerSession`（throw "NOT_IMPLEMENTED"） |
| `src/server/auth/jwt.ts` | `signSessionToken` / `verifySessionToken` 空实现，支持 kid |
| `src/server/auth/permissions.ts` | `Permission` enum、`requirePermission` |
| `src/server/auth/workspace-policy.ts` | `WorkspacePolicy.derive` 空实现 |
| `src/server/auth/csrf.ts` | `assertCsrf(req)` 空实现 |
| `src/server/auth/AGENTS.md` | 见架构 §17 |
| `src/server/guards/quotas.ts` | `QUOTAS` 常量表 + `assertQuota` 空实现 |
| `src/server/guards/rate-limit.ts` | `assertRateLimit(scope, key)` 空实现 |
| `src/server/guards/AGENTS.md` | 见架构 §17 |
| `src/server/config/load.ts` | `config` 单例，Zod schema 覆盖 SDS_* + optional PI_* fallback |
| `src/server/config/provider-auth-env-allowlist.ts` | Provider 鉴权 ENV passthrough 列表（`OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 等，不进 Zod） |
| `src/server/config/AGENTS.md` | 见架构 §17 |
| `src/server/logs/observability.ts` | `ObservabilityEvent` / `LogSink` / `ObservabilityBus` 接口 + `observability` 单例（内部 stub） |
| `src/server/logs/sinks/jsonl-file-sink.ts` | 空实现 |
| `src/server/logs/sinks/ai-trace-sink.ts` | 空实现 + 新白名单常量 |
| `src/server/logs/AGENTS.md` | 见架构 §17 |
| `src/server/dashboards/migrations/types.ts` | `Migrator` / `MigrationError` |
| `src/server/dashboards/migrations/index.ts` | `migrateToCurrent(doc)` 空实现 |
| `src/server/dashboards/migrations/v0.3-to-v1.0.ts` | v0.3→v1.0 migrator 空实现（见 Sprint 5 完成） |
| `src/server/dashboards/migrations/AGENTS.md` | 见架构 §17 |
| `src/server/db/migrations/runner.ts` | DB migration runner 空实现 |
| `src/server/db/AGENTS.md` | 见架构 §17 |
| `src/server/api-error.ts` | `ApiError` 类（含 `code` / `i18nKey` / `status` / `payload`） |
| `src/contracts/schema-version.ts` | `DashboardDocumentSchemaVersion = "1.0"`、`LegacyDashboardSpecSchemaVersion = "0.3"`、`CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION = "1.0"`（**两个独立类型**，见 §9.1） |
| `src/ai/providers/types.ts` | `LlmProvider` 接口 |
| `src/ai/providers/mock-provider.ts` | `MockProvider` 实现 |
| `src/ai/providers/AGENTS.md` | 见架构 §17 |
| `src/web/api/server-fetch.ts` | SSR cookie 转发封装空实现 |
| `src/web/dashboard/render/chart-error-placeholder.tsx` | 空组件 + i18n key |
| `eslint-rules/no-identity-in-request.js` | 自定义 ESLint 规则（按 Sprint -2 决定的 lint 工具） |
| `src/web/i18n/keys.ts` | i18n key 集中导出 |

### 4.3 ENV 变量

按 Sprint -2 §2.4 的 ENV 映射表，新增 `.env.example`。ENV 分三层（与 architecture.md §15.2 / §15.2.1 一致）：

| 层 | 内容 | 校验方式 |
|----|------|---------|
| **应用 ENV** | `SDS_*` required keys | `config/load.ts` Zod schema |
| **LLM 路由 fallback** | `PI_PROVIDER` / `PI_MODEL` / `PI_THINKING_LEVEL`（optional） | 同上 Zod schema（optional 字段） |
| **Provider 鉴权 passthrough** | `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / … | `provider-auth-env-allowlist.ts` 文档化；**不进 Zod** |

`.env.example` 必须覆盖：**Zod schema 全部 key** + **allowlist 中至少一种当前示例 provider 的 auth key**（默认示例 DeepSeek，与 `tests/provider-config.test.ts` 一致）。

```bash
# Auth
SDS_SESSION_SECRETS='{"current":{"kid":"k1","secret":"REPLACE_ME_32B"},"previous":[]}'
SDS_SESSION_TTL_DAYS=7
SDS_SESSION_REFRESH_GRACE_HOURS=24
SDS_ALLOWED_ORIGINS=http://localhost:3000

# Database
SDS_DATABASE_URL=postgresql://...

# LLM 路由（SDS_* 优先；未设时 fallback 到 PI_*）
SDS_LLM_PROVIDER=deepseek
SDS_LLM_MODEL=deepseek-chat
SDS_LLM_THINKING_LEVEL=medium
# 兼容 fallback（optional，与 Zod schema 中 PI_* 字段对应）
# PI_PROVIDER=deepseek
# PI_MODEL=deepseek-chat
# PI_THINKING_LEVEL=medium

# Provider 鉴权（passthrough allowlist；不进 config/load.ts Zod schema）
# 当前示例 provider=deepseek 时必填：
DEEPSEEK_API_KEY=REPLACE_ME
# 若改用 OpenAI，注释上一行并启用：
# OPENAI_API_KEY=REPLACE_ME
# 完整 allowlist 见 src/server/config/provider-auth-env-allowlist.ts

# Quotas
SDS_QUOTA_VIEWS_PER_DASHBOARD=50
SDS_QUOTA_QUERIES_PER_DASHBOARD=100
SDS_QUOTA_DOCUMENT_SIZE_MB=2
SDS_QUOTA_QUERY_ROWS=10000
SDS_QUOTA_QUERY_BYTES=5242880
SDS_QUOTA_BATCH_SIZE=20
SDS_QUOTA_MODEL_INPUT_TOKENS=32000
SDS_QUOTA_MODEL_OUTPUT_TOKENS=8000
SDS_QUOTA_TRACE_FILE_MB=50
SDS_QUOTA_SESSIONS_PER_WORKSPACE=50
SDS_QUOTA_DASHBOARDS_PER_WORKSPACE=200
SDS_QUOTA_STORAGE_GB=10

# Observability
SDS_OBSERVABILITY_SINKS=jsonl,ai-trace
SDS_SENTRY_DSN=
SDS_OTEL_ENDPOINT=
```

### 4.3.1 `script:check-env`（Sprint 0 新增）

`package.json` 加 `"script:check-env": "node scripts/check-env.mjs"`，分三段校验（**不要求 provider auth key 进入 Zod**）：

1. **SDS_* 覆盖**：扫描 `src/` 中 `process.env.SDS_*` 引用 → 每个必须在 `config/load.ts` Zod schema 中声明
2. **PI_* fallback 覆盖**：扫描 `PI_PROVIDER` / `PI_MODEL` / `PI_THINKING_LEVEL` 引用 → 必须在 Zod schema 中声明为 optional
3. **Allowlist 隔离 + 示例 provider auth key**（与 architecture.md §15.2.1 / §1460 对齐）：
   - allowlist 中的 key **不得**出现在 Zod schema 中（防 regress）
   - `.env.example` **不要求** allowlist 全量列出；只要求**当前示例 provider** 的 auth key 有值或 `REPLACE_ME`（默认：`SDS_LLM_PROVIDER=deepseek` → 必须有 `DEEPSEEK_API_KEY`）
   - 其它 allowlist key（如 `OPENAI_API_KEY`）可在 `.env.example` 中以注释形式出现，**不强制**
   - `.env.example` 须含一行指向 `provider-auth-env-allowlist.ts` 的注释（完整列表见该文件）

`.env.example` 与 Zod schema 的关系：**Zod schema keys ⊆ `.env.example`**（required 必须有值示例；optional 可注释）。Provider auth：**当前示例 provider 的 key 必填**；allowlist 其余 key 可选注释。

### 4.4 Lint 规则（按 Sprint -2 决策 4 落地）

若选 ESLint（推荐）：

```bash
npm install -D eslint @eslint/js typescript-eslint
```

- 新建 `eslint.config.js`（flat config）
- `package.json` 加 `"lint": "eslint src/app/api src/server/auth eslint-rules"`
- `eslint-rules/no-identity-in-request.js`：禁止 `src/app/api/**/*.ts` 中：
  - `req.json()` 后访问 `.userId` / `.workspaceId`
  - `searchParams.get("userId" | "workspaceId")`

本 Sprint 以 `warn` 模式启用，Sprint 1 完成后切 `error`。

若选 B（rg 脚本），则 `"lint"` 指向 `scripts/check-no-identity-in-request.mjs`，验收口径同步调整。

### 4.5 验收

- [x] `npm run typecheck` 通过
- [x] `npm run lint` 通过（新规则为 warn）
- [x] `npm test`（既有测试）全部通过（行为未变）
- [x] 所有新文件均有对应 `AGENTS.md`
- [x] `.env.example` 覆盖：`config/load.ts` Zod schema 全部 key（required 有值、optional 可注释）+ `provider-auth-env-allowlist.ts` 至少一种示例 provider auth key（默认 `DEEPSEEK_API_KEY`）
- [x] `npm run script:check-env` 通过（§4.3.1 三段校验）
- [x] `npm run test:contract`（Sprint -2 选型的命令）能跑通空骨架

---

## 5. Sprint 1：Auth + Datasource 权限 + CSRF + execute-batch identity（3–4 周）

**目标**：一次性收敛架构 §1.5 中四个 P0 安全缺口：**#1 Auth/identity、#2 Datasource 管理权限、#7 execute-batch body `workspace_id`、#8 Datasource 执行/schema/preview/test 边界**。

### 5.1 子任务拆分

| 子任务 | 周期 | 可并行 |
|--------|------|--------|
| 1.1 JWT 签发 / 验证（含 kid 选择） | 3 天 | — |
| 1.2 `requireServerSession` 实现 + revocations 缓存 | 3 天 | — |
| 1.3 CSRF 中间件（Origin / Referer 白名单） | 2 天 | 1.1 后 |
| 1.4 登录 / 续期 / 登出路由 | 3 天 | 1.2 后 |
| 1.5 改造所有 API 路由 | 5–8 天 | 1.4 后 |
| 1.6 前端 cookie 化（删本地 identity session、加 server-fetch、跳转 /login） | 4 天 | 与 1.5 并行 |
| 1.7 `AuthoringToolRegistration.requiredPermissions` + `WorkspacePolicy.derive` | 3 天 | 1.2 后 |
| 1.8 **`datasource_connections` 加 workspace_id**（评审 #2） | 2 天 | 1.4 后 |
| 1.9 **`/api/datasources` 加 auth/permission/CSRF + default workspace namespace**（评审 #2，按单 workspace 产品修订） | 2 天 | 1.8 后 |
| 1.10 删除旧代码 + lint 切 error | 1 天 | 全部后 |

### 5.2 实现 `requireServerSession`

```typescript
// src/server/auth/require-session.ts
import { cookies } from "next/headers";
import { verifySessionToken } from "./jwt";
import { assertCsrf } from "./csrf";
import { ApiError } from "@/server/api-error";

export async function requireServerSession(
  req: Request,
  opts?: { skipCsrf?: boolean },
): Promise<UserSession> {
  const token = cookies().get("sds_session")?.value;
  if (!token) throw new ApiError(401, "AUTH_REQUIRED", "error.auth.required");

  const claims = await verifySessionToken(token);
  if (claims.exp * 1000 < Date.now()) {
    throw new ApiError(401, "SESSION_EXPIRED", "error.auth.session_expired");
  }

  if (await isRevoked(claims.jti)) {
    throw new ApiError(401, "SESSION_REVOKED", "error.auth.session_revoked");
  }

  if (!opts?.skipCsrf && !isSafeMethod(req.method)) {
    assertCsrf(req);
  }

  return {
    userId: claims.userId,
    workspaceId: claims.workspaceId,
    permissions: new Set(claims.permissions),
    sessionId: claims.jti,
    requestId: crypto.randomUUID(),
    issuedAt: claims.iat * 1000,
    expiresAt: claims.exp * 1000,
  };
}
```

### 5.3 JWT 密钥轮换

```typescript
// src/server/auth/jwt.ts
import { config } from "@/server/config/load";

const SECRETS = config.SDS_SESSION_SECRETS;

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  const { kid, secret } = SECRETS.current;
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", kid })
    .setIssuedAt()
    .setExpirationTime(`${config.SDS_SESSION_TTL_DAYS}d`)
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(secret));
}

export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { kid } = decodeProtectedHeader(token);
  const entry = [SECRETS.current, ...SECRETS.previous].find(e => e.kid === kid);
  if (!entry) throw new ApiError(401, "SESSION_KID_UNKNOWN", "error.auth.invalid");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(entry.secret));
  return payload as SessionClaims;
}
```

### 5.4 实现登录 / 续期 / 登出路由

| 路由 | 行为 |
|------|------|
| `POST /api/auth/login` | 当前为 local DB credential provider：校验 `local_user_credentials` scrypt hash → `auth_identities` 映射本地用户 → 本地 roles/permissions 展开 → 签发 JWT → `Set-Cookie: sds_session=...; HttpOnly; Secure; SameSite=Lax`；Auth0 后续作为同一 provider flow 接入 |
| `POST /api/auth/refresh` | 验证旧 token 在 grace period 内 → 签发新 token → 覆盖 cookie |
| `POST /api/auth/logout` | 写 `session_revocations` + 清除 cookie |

### 5.5 改造所有 API 路由

基于 Sprint -2 的 `route-inventory.md` 完整清单，对每个路由：

1. **首行加入** `const session = await requireServerSession(req);`
2. **删除 body / query 中的 `userId` / `workspaceId` 字段**，统一从 `session` 取
3. **加权限校验**：根据路由职责加 `requirePermission(session, ...)`
4. **替换 i18n 文案**：错误响应使用 `message_i18n_key` 字段

**重点路由所需权限**（评审 v3 #3 修正：HTTP method + 真实路径，完整以 audit 输出为准）：

| 路由 | HTTP method | 所需权限 | 备注 |
|------|------------|---------|------|
| `/api/auth/login` | POST | （免登录） | local DB credential provider，rate limit 5/IP/min；Auth0 接入后新增/替换 provider verification |
| `/api/auth/refresh` | POST | （免登录，验证旧 token） | rate limit 10/session/min |
| `/api/auth/logout` | POST | 任意有效 session | |
| `/api/authoring/chat` | **POST** | `dashboard.edit` | 启动 turn；body 移除 userId/workspaceId/chatSessionId 中的 identity 字段 |
| `/api/authoring/chat/[id]/stream` | **GET**（SSE resume，非 POST） | `dashboard.edit` | 评审 v3 #3 修正 |
| `/api/authoring/chat/[id]/steer` | POST | `dashboard.edit` | |
| `/api/authoring/session/open` | POST | `dashboard.edit` 或 `dashboard.read` | |
| `/api/authoring/session/save` | POST | `dashboard.edit` | |
| `/api/authoring/ui-session` | PUT | `dashboard.edit` | |
| `/api/authoring/checks` | POST | `dashboard.read` | |
| `/api/authoring/task` | POST | `dashboard.read` | |
| `/api/authoring/settings` | PUT | `dashboard.edit` | |
| `/api/authoring/trace` | GET | `dashboard.read` | |
| `/api/dashboards` | GET | `dashboard.read` | 用 session.workspaceId，移除 searchParams.workspaceId |
| `/api/dashboards` | POST | `dashboard.edit` | 同上 |
| `/api/dashboards/[dashboardId]` | GET | `dashboard.read` | |
| `/api/dashboards/[dashboardId]/publish` | POST | `dashboard.publish` | |
| `/api/dashboard/save` | POST | `dashboard.edit` | legacy 路径 |
| `/api/dashboard/publish` | POST | `dashboard.publish` | legacy 路径 |
| `/api/query/execute-batch` | POST | `dashboard.read` 或 `dashboard.edit`（按 mode） | **body 中 `workspace_id` 必须移除/忽略**（评审 v3 #4），用 session.workspaceId 重写 `request.workspace_id` 再调 `resolveExecuteBatchDocument` |
| `/api/preview` | **POST**（评审 v3 #3 修正路径） | `datasource.read` | 内部 secret 使用 session 的默认 workspace namespace |
| `/api/datasources` | GET | `datasource.read` | 按 session.workspaceId 的默认 namespace 过滤 |
| `/api/datasources` | POST | `datasource.manage` | 写入时 set `workspace_id = session.workspaceId`（当前为 `ws_default`） |
| `/api/datasources/[datasourceId]` | GET | `datasource.read` | 校验归属 |
| `/api/datasources/[datasourceId]` | DELETE | `datasource.manage` | 校验归属 |
| `/api/datasources/[datasourceId]/schema` | GET | `datasource.read` | 校验归属（评审 v3 #5）|
| `/api/datasources/test` | POST | `datasource.manage` | 测试时使用 session 的默认 workspace namespace |
| `/api/workspace/context` | GET | 任意有效 session | |
| `/api/workspace/presence` | POST | 任意有效 session | |

**execute-batch body 字段处理**（评审 v3 #4 显式要求）：

```typescript
// src/app/api/query/execute-batch/route.ts
export async function POST(req: Request): Promise<Response> {
  const session = await requireServerSession(req);
  requirePermission(session, "dashboard.read");

  const raw = await req.json();
  // 强制忽略 body 中的 workspace_id；用 session 覆盖
  const request: ExecuteBatchRequest = {
    ...raw,
    workspace_id: session.workspaceId,  // ★ 总是覆盖
  };
  // 现有 validation.ts:1823 校验 workspace_id 存在的逻辑保留，
  // 但来源已是服务端覆盖值，客户端不再可控
  return handleExecuteBatchRoute(request);
}
```

**Datasource 执行边界全覆盖**（评审 v3 #5，按当前单 workspace 产品修订）：所有按 `datasourceId` 走的入口都使用 session 的 default workspace namespace；`workspaceId` 字段保留为内部 namespace，不代表当前支持多租户：

```typescript
// src/server/datasource/datasource-resolve.ts
export async function resolveDatasourceSecretForExecution(
  datasourceId: string,
  workspaceId: string,  // 当前为 DEFAULT_WORKSPACE_ID = "ws_default"
): Promise<{ kind: DatasourceEngineKind; secretJson: string }> {
  const row = await getDatasourceConnectionForWorkspace({ workspaceId, datasourceId });
  if (!row) throw new ApiError(404, "DATASOURCE_NOT_FOUND", "error.datasource.not_found");
  return { kind: row.kind, secretJson: decryptConnectionSecretJson(row) };
}
```

同步修改：
- `getDatasourceConnectionById(datasourceId)` → 使用 session/default workspace namespace 查询 datasource
- `getDatasourceSchemaTree(datasourceId)` → `getDatasourceSchemaTree({ workspaceId, datasourceId })`
- `getDatasourceReferences(datasourceId)` → `getDatasourceReferences({ workspaceId, datasourceId })`
- `deleteDatasource(datasourceId)` → `deleteDatasource({ workspaceId, datasourceId })`

### 5.6 工具权限过滤（子任务 1.7）

修改 `src/ai/authoring/tools/registry.ts`：

```diff
 export interface AuthoringToolRegistration {
   name: AuthoringToolName;
   category: AuthoringToolCategory;
   inspectLane: boolean;
   readScopes?: readonly ("dashboard" | "focused")[];
   authorScopes?: readonly ("dashboard" | "focused")[];
+  requiredPermissions: readonly Permission[];
   lifecycleWrite?: boolean;
   labelKey: string;
 }
```

每个工具补 `requiredPermissions`（示例）：

| 工具 | requiredPermissions |
|------|-------------------|
| `getViews` / `getView` / `getQuery` / `getBinding` / `getDraftStatus` / `loadSkill` | `["dashboard.read"]` |
| `getDatasources` / `listDatasourceTables` / `getTableSchema` / `previewTableData` | `["datasource.read"]` |
| `declareAuthoringGoal` | `["dashboard.edit"]` |
| `runCheck` / `stageChart` / `stageReplaceChart` / `stageQuery` / `stageDelete` / `composePatch` | `["dashboard.edit"]` |
| `applyPatch` | `["dashboard.edit"]` |

实现 `WorkspacePolicy.derive(session)`：返回 `Set<AuthoringToolName>`。

`computeAuthoringScope` 出口处加 `allowedTools = allowedTools ∩ WorkspacePolicy.derive(session).allowedToolNames`。

### 5.7 Datasource 单 workspace namespace 归属（子任务 1.8, 1.9）

#### 5.7.1 表结构变更（评审 v3 #2 修正：默认 workspace ID 是 `ws_default`，非 `default`）

新建 DB migration 文件：

```sql
-- src/server/db/migrations/0006_datasource_workspace_id.sql

-- 1. 加字段（暂时 nullable，便于历史数据迁移）
alter table datasource_connections
  add column workspace_id text references workspaces(id) on delete cascade;

-- 2. 历史数据归属：将所有现有 datasource_connections 绑定到 DEFAULT_WORKSPACE_ID = 'ws_default'
--    （见 src/shared/workspace-defaults.ts:1；ensureCloudAuthoringSchema 启动时已 insert 该 workspace）
--    Sprint -2 §2.5 已盘点真实 datasource 数量；当前产品不支持多 workspace，
--    在执行此 migration 前用 staging 数据生成 mapping CSV 并 import 到临时表，再按 mapping 更新
update datasource_connections set workspace_id = 'ws_default' where workspace_id is null;

-- 3. 设为 not null + 加索引
alter table datasource_connections
  alter column workspace_id set not null;
create index if not exists idx_datasource_connections_workspace_id
  on datasource_connections (workspace_id);
```

**为什么是 `ws_default` 而非 `default`**：当前默认 workspace ID 常量定义在 `src/shared/workspace-defaults.ts:1`：

```typescript
export const DEFAULT_WORKSPACE_ID = "ws_default";
```

`ensureCloudAuthoringSchema` 启动时 insert 此 workspace 行 + 默认用户 `usr_alice`。若 migration 用 `'default'` 会导致旧 datasource 关联到一个**不存在**的 workspace，**默认用户 `usr_alice` 看不到任何 datasource**（评审 v3 #2 指出的问题）。

#### 5.7.2 API 改造

```typescript
// src/app/api/datasources/route.ts
export async function GET(req: Request): Promise<Response> {
  const session = await requireServerSession(req);
  requirePermission(session, "datasource.read");
  const data = await listManagementDatasources({ workspaceId: session.workspaceId });
  return Response.json({ status_code: 200, reason: "OK", data });
}

export async function POST(req: Request): Promise<Response> {
  const session = await requireServerSession(req);
  requirePermission(session, "datasource.manage");
  const payload = await req.json();
  const parsed = parseCreateDatasourceRequest(payload);
  const created = await createDatasource({ ...parsed, workspaceId: session.workspaceId });
  return Response.json({ status_code: 200, reason: "OK", data: created });
}
```

#### 5.7.3 Service 层改造

`datasource-admin-service.ts` 所有方法使用 session/default workspace namespace；listManagement / create / delete 全部加 `where workspace_id = $1`。

### 5.8 前端迁移（子任务 1.6）

| 改动 | 文件 |
|------|------|
| 删除本地 identity session 相关代码 | `src/web/auth/*` |
| 新建 `LoginPage` + `useAuth` hook | `src/web/auth/login/*` |
| 全部 `fetch` 调用加 `credentials: "include"` | grep `fetch\(` 全仓库 |
| Mutating fetch 加 `X-CSRF-Token` header（如启用 token 模式） | 同上 |
| SSR Server Component fetch 通过 `server-fetch.ts` 转发 cookie | grep server-side fetch |
| 全局 401 拦截 → 跳转 `/login` | `src/web/api/fetch-with-auth.ts`（新建） |
| 删除 body / query 中的 `userId` / `workspaceId` | grep `userId.*:.*currentUser` |

### 5.9 删除旧代码 + 切 lint

```bash
rm legacy server identity module
rm legacy browser auth module
```

```diff
- "no-identity-in-request": "warn"
+ "no-identity-in-request": "error"
```

### 5.10 验收

- [x] 所有受保护 API 路由在解析 request body 前执行 `requireServerSession` / `requireApiSession`（contract test 覆盖）
- [x] 所有 mutating 路由通过 CSRF 校验（contract test 覆盖）
- [x] `legacy server identity module` 不存在
- [x] `legacy browser auth module` 不存在
- [x] `AuthoringToolRegistration.requiredPermissions` 在 registry 中全覆盖
- [x] **`datasource_connections.workspace_id` 字段存在且 not null**
- [x] **`/api/datasources/*` 全部走 `requireServerSession + requirePermission + default workspace namespace`**
- [x] 未登录请求所有 API 返回 401
- [x] 篡改 cookie 返回 401
- [x] kid 不匹配返回 401
- [x] 跨站 POST（Origin 不在白名单）返回 403
- [x] 缺少权限的用户无法看到对应工具
- [x] **单 workspace 产品中，`GET /api/datasources` 只读取 session 的 `ws_default` namespace**
- [x] E2E：当前覆盖 local login / session read-refresh-logout / CSRF 基础路径；创建 dashboard → publish 为后续 E2E 加固项
- [x] Lint `no-identity-in-request` 为 `error` 且 CI 通过
- [x] 性能基准：`requireServerSession` P95 < 3ms（含 revocations 缓存）

---

## 6. Sprint 2：ObservabilityBus（1–2 周）

**目标**：所有事件统一通过 `observability.emit` 发出，事件类型迁移到标准命名。

### 6.1 完成 `ObservabilityBus` 实现

```typescript
// src/server/logs/observability.ts
class ObservabilityBusImpl {
  private sinks: LogSink[] = [];
  private queues = new Map<string, Promise<void>>();

  register(sink: LogSink) { this.sinks.push(sink); }

  emit(event: ObservabilityEvent) {
    const key = event.sessionId;
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(async () => {
      await Promise.all(
        this.sinks.map(s => s.write(event).catch(this.handleSinkError))
      );
    });
    this.queues.set(key, next);
  }

  async flushAll(): Promise<void> {
    await Promise.all(this.queues.values());
    await Promise.all(this.sinks.map(s => s.flush?.()));
  }
}

export const observability = new ObservabilityBusImpl();
```

启动时（在 `src/server/config/load.ts` 加载后）注册 sink：

```typescript
const sinkNames = config.SDS_OBSERVABILITY_SINKS;
if (sinkNames.includes("jsonl")) observability.register(new JsonlFileSink());
if (sinkNames.includes("ai-trace")) observability.register(new AiTraceJsonlSink());
if (sinkNames.includes("sentry") && config.SDS_SENTRY_DSN) observability.register(new SentrySink());
if (sinkNames.includes("otel") && config.SDS_OTEL_ENDPOINT) observability.register(new OpenTelemetrySink());
```

### 6.2 实现 sink

| Sink | 文件 | 备注 |
|------|------|------|
| `JsonlFileSink` | `src/server/logs/sinks/jsonl-file-sink.ts` | 复用现有 `session-log-writer` 内部逻辑；加 trace 文件 rotation |
| `AiTraceJsonlSink` | `src/server/logs/sinks/ai-trace-sink.ts` | 白名单内事件镜像写入 trace.ai.jsonl |
| `ConsoleSink` | `src/server/logs/sinks/console-sink.ts` | 仅 dev 模式启用 |
| `SentrySink` (可选) | `src/server/logs/sinks/sentry-sink.ts` | `level: "error"` 事件转 Sentry |
| `OpenTelemetrySink` (可选) | `src/server/logs/sinks/otel-sink.ts` | OTLP / HTTP 转发 |

### 6.3 迁移调用方

```bash
rg -l "legacy trace writer" src/
```

对每个调用做替换（旧字段 `scope.event` → 新字段 `type`）。`level` 选择遵循架构 §5.2 正交规则。

### 6.4 事件命名映射表

| 旧 | 新 |
|----|-----|
| `authoring-chat-flow.request_start` | `stream.request.start` |
| `authoring-chat-flow.ui_stream_step_finish` | `stream.ui.step_finish` |
| `authoring-chat-flow.ui_stream_finish` | `stream.ui.finish` |
| `authoring-agent.turn_start` | `agent.turn.start` |
| `authoring-agent.turn_finish` | `agent.turn.end` |
| `authoring-agent.turn_error` | `agent.turn.error` |
| `authoring-agent.prepare-step` | `agent.step.prepare` |
| `authoring-agent.agent_step_finish` | `agent.step.finish` |
| `authoring-agent.inspect_decision` | `agent.inspect.decision` |
| `authoring-agent.goal_declared` | `agent.goal.declared` |
| `authoring-agent.tool_protocol_error` | `agent.tool.protocol_error` |
| **新增** | `agent.tool.call` / `agent.tool.result` |
| **新增** | `query.start` / `query.complete` / `query.error` / `query.timeout` |
| **新增** | `document.draft.stage` / `document.patch.compose` / `document.patch.apply` / `document.publish` / `document.migrate` |
| **新增** | `render.materialize.error` / `render.validate.fail` |
| **新增** | `auth.session.create` / `auth.session.invalid` / `auth.session.forbidden` |
| **新增** | `quota.exceeded` / `quota.warning` |
| **新增** | `rate_limit.exceeded` |
| **新增** | `error.unhandled` |

**注**："新增"事件不在本 Sprint 一次性全打。本 Sprint 完成命名映射与基础设施；新增事件随后续 Sprint 落地。

### 6.5 更新 AI trace 白名单

`AI_TRACE_EVENT_WHITELIST` 内容更新为架构 §5.5 中的新事件类型列表。

### 6.6 删除旧代码

```bash
rm src/server/logs/session-log-writer.ts
```

### 6.7 Trace viewer API 兼容

`GET /api/authoring/trace` 内部解析变更：从 `{scope, event}` 拼接改为直接读 `type`。前端 trace viewer 同步更新。

### 6.8 归档旧 trace 文件

```bash
mv logs/sessions logs/archive/legacy-$(date +%Y%m%d)
mkdir -p logs/sessions
```

部署文档（`docs/operations.md`）记录此操作时间。

### 6.9 验收

- [x] 旧 trace 直写入口在仓库内不存在
- [x] 所有事件 `type` 符合架构 §5.4 命名规范
- [x] 所有事件含 `requestId`
- [x] 新 trace 文件能被 trace viewer API 读取
- [x] 旧 trace 文件已归档
- [x] Contract test：注册 2 个 mock sink，emit 1 个事件，验证两个 sink 都收到
- [x] Contract test：单 sink throw，其它 sink 仍写入

---

## 7. Sprint 3：失败模式与降级（2 周）

**目标**：实现架构 §7.1 失败矩阵中所有项的检测、传播、降级行为。

### 7.1 实现缺口（基于 Sprint -1 §3.1 audit）

按矩阵补齐缺失项，重点：

| 矩阵项 | 实施位置 |
|--------|---------|
| 数据源 retry + 5s 超时 | `src/server/datasource/postgres.ts`（包装 query 调用） |
| 数据源 30s 超时 | 同上 |
| 数据源 schema 漂移检测 | `src/server/execution/` + 错误代码 `SCHEMA_DRIFT` |
| pi-agent 模型 60s 硬超时 | `src/ai/authoring/agent/session.ts` |
| 模型 transient retry（2 次，指数退避） | pi-agent 配置 |
| Approval `expires_at`（10min） | 已完成：`PendingProposal.expires_at`、compose 写入 TTL、applyPatch preflight、前端 Approval Card 倒计时 UI 均已落地；过期返回 `PROPOSAL_EXPIRED` |
| ECharts ErrorBoundary | `src/web/dashboard/render/chart-frame.tsx` |
| ChartErrorPlaceholder 组件 | `src/web/dashboard/render/chart-error-placeholder.tsx` |
| Trace rotate（50MB） | `JsonlFileSink.write` 写入前检查文件大小 |
| `BindingResultError.message_i18n_key` | `src/contracts/dashboard.ts` 改 `message` 为 `message_i18n_key` + 查询执行层 |

### 7.2 i18n 文案

所有用户可见错误新增 i18n key。**先在 `src/web/i18n/keys.ts` 集中声明**，再在 `zh-CN.ts` / `en-US.ts` 填充。

```typescript
// src/web/i18n/keys.ts
export const I18N_KEYS = {
  error: {
    quota: {
      views_per_dashboard: "error.quota.views_per_dashboard",
      queries_per_dashboard: "error.quota.queries_per_dashboard",
      document_size: "error.quota.document_size",
      query_rows: "error.quota.query_rows",
      query_bytes: "error.quota.query_bytes",
      batch_size: "error.quota.batch_size",
      model_input_tokens: "error.quota.model_input_tokens",
      model_output_tokens: "error.quota.model_output_tokens",
      sessions_per_workspace: "error.quota.sessions_per_workspace",
      dashboards_per_workspace: "error.quota.dashboards_per_workspace",
    },
    rate_limit: {
      login: "error.rate_limit.login",
      auth: "error.rate_limit.auth",
      query: "error.rate_limit.query",
      agent: "error.rate_limit.agent",
      generic: "error.rate_limit.generic",
    },
    auth: {
      required: "error.auth.required",
      session_expired: "error.auth.session_expired",
      session_revoked: "error.auth.session_revoked",
      forbidden: "error.auth.forbidden",
      invalid: "error.auth.invalid",
      csrf_invalid_origin: "error.auth.csrf_invalid_origin",
    },
    dashboard: {
      view_failed: "error.dashboard.view_failed",
      query_failed: "error.dashboard.query_failed",
      query_timeout: "error.dashboard.query_timeout",
      schema_drift: "error.dashboard.schema_drift",
      migration_failed: "error.dashboard.migration_failed",
    },
    authoring: {
      agent_timeout: "error.authoring.agent_timeout",
      proposal_stale: "error.authoring.proposal_stale",
      proposal_expired: "error.authoring.proposal_expired",
    },
  },
  chart: {
    placeholder: {
      loading: "chart.placeholder.loading",
      error: {
        generic: "chart.placeholder.error.generic",
        schema_drift: "chart.placeholder.error.schema_drift",
        timeout: "chart.placeholder.error.timeout",
      },
    },
  },
};
```

构建时校验：zh-CN 与 en-US 必须覆盖 `keys.ts` 中所有路径。

### 7.3 失败模式 contract test

在 `src/server/__tests__/failure-modes/` 新建测试套件，每种失败 1 个测试。

### 7.4 验收

- [x] §7.1 矩阵中每行均有实现 + 测试
- [x] 所有用户可见失败有对应 i18n key（CI 校验 zh-CN + en-US 全覆盖）
- [x] 注入数据源失败，单 view 显示 placeholder，其他 view 正常（E2E）
- [x] 注入模型超时，前端展示重试按钮（E2E mock）
- [x] Approval 卡 11min 后触发 expired 错误
- [x] 任意 view 渲染 throw，其它 view 仍正常显示
- [x] 任一 sink 失败，其它 sink 仍正常写入

---

## 8. Sprint 4：容量上限与限流（1–2 周）

**目标**：完成 `src/server/guards/quotas.ts` 与 `rate-limit.ts`，所有相关入口强制校验。

### 8.1 完成 quotas

参考 Sprint 0 的空骨架，按架构 §8.1 完成实现。每个 `assertQuota` 调用 emit `quota.exceeded` / `quota.warning` 事件。

### 8.2 检查点注入（完整清单，评审 v3 #8 修正语义）

| 检查点 | 调用位置 | 策略 |
|--------|---------|------|
| `VIEWS_PER_DASHBOARD` | `applyPatch` + `publish` 入口 | fail-fast 拒绝 |
| `QUERIES_PER_DASHBOARD` | 同上 | fail-fast |
| `DOCUMENT_SIZE_BYTES` | 同上（序列化后检查） | fail-fast |
| `QUERY_ROWS` | **执行前 push-down LIMIT**（Postgres: 编译 SQL 时注入 `LIMIT ($n + 1)`；Athena: 复用现有 5000 硬截断，与 ENV 对齐）+ **执行后行数 > 上限 → fail-fast 拒绝**（不再"截断 + warn"） | 双重 |
| `QUERY_BYTES` | 单 query 序列化后字节数 > 上限 → fail-fast | 执行后 |
| `BATCH_SIZE` | `execute-batch` 入口 query 数量 | fail-fast |
| `MODEL_INPUT_TOKENS` / `MODEL_OUTPUT_TOKENS` | pi-agent 配置 | fail-fast |
| `TRACE_FILE_BYTES` | `JsonlFileSink.write` 写入前 → rotate（非拒绝） | rotate |
| `SESSIONS_PER_WORKSPACE` | session 创建 | fail-fast |
| `DASHBOARDS_PER_WORKSPACE` | dashboard 创建 | fail-fast |
| `STORAGE_BYTES_PER_WORKSPACE` | 后台 sweeper（每日一次） | warn-only |

### 8.2.1 Query rows quota 实现细节（评审 v3 #8）

| Engine | 当前行为 | 目标行为 |
|--------|---------|---------|
| Postgres（`postgres-engine.ts:125`） | 仅 5s `statement_timeout`，无 row limit | 编译 SQL 时注入 `LIMIT ($SDS_QUOTA_QUERY_ROWS + 1)`；执行后若返回 = limit+1 → 拒绝 `QUOTA_QUERY_ROWS` |
| Athena（`athena-engine.ts:22`） | `MAX_RESULT_ROWS = 5000` 硬截断，**截断后悄悄继续** | 该常量改读 `config.SDS_QUOTA_QUERY_ROWS`；返回行数 = limit → 拒绝 `QUOTA_QUERY_ROWS`（去掉静默截断） |

**理由**：双重防护把"客户端无控制权"和"服务端拒绝大查询"两件事都做对了。Postgres push-down 节省 IO 和网络；执行后检查是兜底防止 push-down 失败（如未来引入聚合查询时 LIMIT 语义改变）。

### 8.3 Rate Limit 实现

按架构 §8.4 完成。路由入口示例：

```typescript
const session = await requireServerSession(req);
assertRateLimit("query", session.userId);
```

### 8.4 前端展示

- 全局 `QUOTA_*` 错误拦截器 → 模态弹窗
- 全局 `RATE_LIMIT_*` 错误拦截器 → toast + `Retry-After` 倒计时
- 管理 UI workspace usage 卡片

### 8.5 Contract test

每个 quota / rate limit 加边界值测试（用 Sprint -2 选定的测试工具）。

### 8.6 验收

- [x] 所有 quota 边界值（`limit` pass、`limit+1` reject）测试通过
- [x] 每个 rate limit 分组的"窗口内通过、超出拒绝"测试通过
- [x] 强行 publish 51 个 view 的 dashboard 返回 `QUOTA_VIEWS_PER_DASHBOARD`
- [x] 强行 execute-batch 21 个 query 返回 `QUOTA_BATCH_SIZE`
- [x] 1 分钟内连续 6 次 login 第 6 次返回 `RATE_LIMIT_LOGIN`
- [x] 管理 UI 展示当前用量
- [x] 80% 阈值 emit `quota.warning` 事件
- [x] 触发 quota 后 stage 中的 draft **保留**

---

## 9. Sprint 5：Schema 版本化（v0.3 → v1.0）（1 周）

**目标**：把 schema version 从 `DashboardSpec.schema_version: "0.3"` 提升到 `DashboardDocument.schema_version: "1.0"`，新建 migrator + fixture 测试。

### 9.1 加顶层字段（评审 v3 #6：拆为两个独立类型联合）

避免编译器允许 `"1.0"` 被误赋给 `DashboardSpec.schema_version`，使用**两个独立的类型联合**：

`src/contracts/schema-version.ts`（Sprint 0 创建的空壳此 Sprint 完成实现）：

```typescript
// 顶层 DashboardDocument 的版本（v1.0 起）
export type DashboardDocumentSchemaVersion = "1.0";  // 未来扩展 "1.1" | "2.0" ...
export const CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION: DashboardDocumentSchemaVersion = "1.0";

// DashboardSpec 内部遗留字段（v0.3，兼容期保留至 v2.0）
export type LegacyDashboardSpecSchemaVersion = "0.3";
```

`src/contracts/dashboard.ts`：

```diff
+import type {
+  DashboardDocumentSchemaVersion,
+  LegacyDashboardSpecSchemaVersion,
+} from "./schema-version";

 export interface DashboardDocument {
+  schema_version: DashboardDocumentSchemaVersion;  // 仅 "1.0"+
   dashboard_spec: DashboardSpec;
   query_defs: QueryDef[];
   bindings: Binding[];
 }

 export interface DashboardSpec {
-  schema_version: SchemaVersion;
+  schema_version: LegacyDashboardSpecSchemaVersion;  // 永远 "0.3"，v2.0 时删除
   // ... 其它字段
 }
```

**为什么不能用单一类型**：单一 `SchemaVersion = "0.3" | "1.0"` 会让 `DashboardSpec.schema_version = "1.0"` 在 TS 编译通过——但在 v1.0 阶段这是非法的状态。两个不相交的字面量类型联合是唯一安全表达。

**冗余字段保留期**：`DashboardSpec.schema_version: "0.3"` 在 v1.0 文档中冗余存在，旧二进制仍读该字段。v2.0 时 migrator 删除。

### 9.2 contract-kernel 校验

`assertDashboardDocument` 要求顶层 `schema_version === "1.0"`。`DashboardSpec` 内 `schema_version` 不做强制校验（兼容期）。

### 9.3 migrator 实现

```typescript
// src/server/dashboards/migrations/v0.3-to-v1.0.ts
import type { Migrator } from "./types";
import type {
  LegacyDashboardSpecSchemaVersion,
  DashboardDocumentSchemaVersion,
} from "@/contracts/schema-version";

interface LegacyDashboardDocument_v0_3 {
  dashboard_spec: { schema_version: LegacyDashboardSpecSchemaVersion; [k: string]: unknown };
  query_defs: unknown[];
  bindings: unknown[];
}

interface DashboardDocument_v1_0 {
  schema_version: DashboardDocumentSchemaVersion;          // "1.0"
  dashboard_spec: { schema_version: LegacyDashboardSpecSchemaVersion; [k: string]: unknown };
  query_defs: unknown[];
  bindings: unknown[];
}

export const migrate_0_3_to_1_0: Migrator = {
  from: "0.3",
  to: "1.0",
  apply(doc: LegacyDashboardDocument_v0_3): DashboardDocument_v1_0 {
    return {
      schema_version: "1.0",
      dashboard_spec: doc.dashboard_spec,
      query_defs: doc.query_defs,
      bindings: doc.bindings,
    };
  },
};
```

### 9.4 migrateToCurrent 完整实现

```typescript
// src/server/dashboards/migrations/index.ts
import { migrate_0_3_to_1_0 } from "./v0.3-to-v1.0";
import { MigrationError } from "./errors";

const MIGRATORS: Migrator[] = [
  migrate_0_3_to_1_0,
];

export function migrateToCurrent(rawDoc: unknown): DashboardDocument {
  if (!isObject(rawDoc)) throw new MigrationError("INVALID_DOCUMENT");
  
  let current = rawDoc as Record<string, unknown>;
  
  // 检测当前版本：
  // - 顶层有 schema_version → 用该值
  // - 否则看 dashboard_spec.schema_version
  // - 否则 throw（不认识的文档）
  let currentVersion: string | undefined =
    (current.schema_version as string | undefined) ??
    ((current.dashboard_spec as Record<string, unknown> | undefined)?.schema_version as string | undefined);
  
  if (!currentVersion) {
    throw new MigrationError("UNKNOWN_VERSION");
  }
  
  // 串联应用 migrator
  while (currentVersion !== CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION) {
    const migrator = MIGRATORS.find(m => m.from === currentVersion);
    if (!migrator) {
      throw new MigrationError(`NO_MIGRATOR_FOR_VERSION`, { from: currentVersion });
    }
    try {
      current = migrator.apply(current as any) as Record<string, unknown>;
      currentVersion = current.schema_version as string;
    } catch (err) {
      throw new MigrationError(`MIGRATION_FAILED_${migrator.from}_TO_${migrator.to}`, { cause: err });
    }
  }
  
  assertDashboardDocument(current);
  return current as DashboardDocument;
}
```

### 9.5 加载路径接入

所有 `GET /api/dashboards/*` 在读取后立即 `migrateToCurrent`：

```typescript
try {
  const doc = migrateToCurrent(rawDoc);
  return doc;
} catch (err) {
  if (err instanceof MigrationError) {
    observability.emit({
      type: "document.migrate.error",
      // ...
    });
    throw new ApiError(502, "MIGRATION_FAILED", "error.dashboard.migration_failed");
  }
  throw err;
}
```

### 9.6 写入路径

所有 `applyPatch` / `publish` 写入前**强制覆盖** `schema_version = CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION`：

```typescript
const merged = { ...mergedDoc, schema_version: CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION };
await persistDashboardDocument(merged);
```

### 9.7 Fixture 测试

新建 `src/server/dashboards/migrations/__fixtures__/`：

```
v0.3/
  └── sample.json       # Sprint -2 §2.2 已从 staging 导出
v1.0/
  └── sample.json       # 上述 sample 应用 migrator 后的预期输出
```

测试：

```typescript
// 1. v0.3 fixture migrate 等于 v1.0 fixture
test("v0.3 → v1.0", () => {
  const input = loadFixture("v0.3/sample.json");
  const expected = loadFixture("v1.0/sample.json");
  expect(migrateToCurrent(input)).toEqual(expected);
});

// 2. 幂等
test("migrateToCurrent 幂等", () => {
  const input = loadFixture("v0.3/sample.json");
  const once = migrateToCurrent(input);
  const twice = migrateToCurrent(once);
  expect(twice).toEqual(once);
});

// 3. v1.0 fixture migrate 等于自身
test("v1.0 fixture migrate to current 等于自身", () => {
  const fixture = loadFixture("v1.0/sample.json");
  expect(migrateToCurrent(fixture)).toEqual(fixture);
});
```

### 9.8 主动 batch 迁移工具（可选）

```bash
npm run script:migrate-all-dashboards -- --workspace-id=<id> --dry-run
```

输出"将迁移 N 个 dashboard"，加 `--apply` 实际执行；每秒限流 10 个。**仅在需要主动持久化时运行**，平时靠 applyPatch / publish 时自然回写。

### 9.9 验收

- [x] 旧文档（顶层无 `schema_version`，spec 内 `schema_version: "0.3"`）能被加载（自动 migrate）
- [x] `migrateToCurrent` 幂等（测试）
- [x] `migrateToCurrent` 失败时返回 502 而非 500
- [x] `applyPatch` 写入后文档**顶层** `schema_version === "1.0"`
- [x] `publish` 写入后文档**顶层** `schema_version === "1.0"`
- [x] migration 工具能在 staging 跑通完整 workspace 的 dry-run
- [x] **`DashboardSpec.schema_version` 字段仍存在**（冗余兼容直至 v2.0）

---

## 10. Sprint 6：Contract 测试加固 + E2E（1–2 周）

**目标**：架构 §9.2 测试不变量全部达成；E2E 覆盖关键用户路径。

### 10.1 覆盖率目标

| 模块 | 目标 |
|------|------|
| `contract-kernel` | ≥ 95% 分支（不含 ADR-10 例外） |
| `capability-scope` | 100% profile × scope.kind 组合 |
| `tool-surface` | 7 个优先级 + 2 个 draft 子策略各 ≥ 1 测试 |
| `materialize-option` | 8 recipe × ≥ 3 case snapshot |
| Quota guards | 边界值全部（Sprint 4 已覆盖） |
| Rate limit | 每组分组的边界测试（Sprint 4 已覆盖） |
| `requireServerSession` | 7 场景全（valid / expired / missing / tampered / revoked / kid mismatch / csrf fail） |
| Migrations | 每 migrator fixture in/out + 幂等 + 无顶层版本兼容（Sprint 5 已覆盖） |

### 10.2 E2E 用例

| 用例 | 描述 |
|------|------|
| 登录登出 | 完整 cookie 周期 |
| 创建 dashboard | 含 quota 边界（接近上限） |
| Agent 加 view | stage → check → compose → approve → apply 完整流程 |
| Agent 失败重试 | 注入 tool error 3 次，验证工具被移除 |
| 发布 dashboard | publish + publishedVersion 检查 |
| Viewer 渲染 | 完整 ViewerSnapshot 加载 + filter 切换 |
| 单 view 失败隔离 | 注入查询失败，其它 view 正常 |
| 单 workspace namespace | datasource / dashboard 读写均使用 session 的 `ws_default` namespace，不信任 body/query workspace identity |

### 10.3 性能基准

跑性能基准并对比 Sprint -1 §3.2 的 baseline：

| 基准 | 目标 | 不可回归 |
|------|------|---------|
| 单 turn 完整 agent 循环（mock model） | P95 < 200ms | < 2× baseline |
| `materializeEChartsOptionTemplate` 单次 | P95 < 5ms | < 2× baseline |
| `execute-batch` 10 个简单 query | P95 < 500ms | < 2× baseline |
| `requireServerSession` 验证 | P95 < 3ms | — |

### 10.4 CI 集成

按 Sprint -2 决策的工具链，更新 `.github/workflows/ci.yml`：

```yaml
- run: npm run typecheck
- run: npm run lint
- run: npm run test:contract -- --coverage
- run: npm run test:e2e
- run: npm run benchmark  # 非阻塞，warn-only
```

### 10.5 验收

- [x] `npm run test:contract -- --coverage` 达到目标覆盖率
- [x] 所有架构 §9.2 不变量有对应测试
- [x] CI 强制覆盖率门槛
- [x] 性能基准基线建立并存档（`docs/benchmarks/`）
- [x] E2E 全部用例通过

---

## 11. 横向工作流（跨 Sprint）

以下工作不属于单一 Sprint，应在合适的 Sprint 中穿插完成。

### 11.1 DB schema migration runner（Sprint 0–1，评审 v3 #6 修正：含 bootstrap + 冻结策略）

`src/server/db/migrations/runner.ts` 实现：

```typescript
const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    seq         text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    checksum    text NOT NULL
  );
`;

async function applyDbMigrations() {
  // 1. Bootstrap：先确保 schema_migrations 表存在
  //    这一步不读 .sql 文件，避免鸡生蛋
  await pool.query(BOOTSTRAP_SQL);

  // 2. 加载已 applied 的 seq + checksum
  const applied = await pool.query<{ seq: string; checksum: string }>(
    `SELECT seq, checksum FROM schema_migrations`,
  );
  const appliedMap = new Map(applied.rows.map(r => [r.seq, r.checksum]));

  // 3. 扫描文件，校验 checksum，按 seq 升序逐个应用
  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const seq = file.split("_")[0];  // 文件名前 4 位
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");

    const prev = appliedMap.get(seq);
    if (prev) {
      if (prev !== checksum) {
        throw new Error(
          `Migration ${file} content has changed after apply (checksum mismatch). ` +
          `Stored=${prev}, current=${checksum}. ` +
          `Edit-after-apply is forbidden; write a new migration instead.`,
        );
      }
      continue;  // 跳过已 applied
    }

    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(
        `INSERT INTO schema_migrations (seq, checksum) VALUES ($1, $2)`,
        [seq, checksum],
      );
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;  // fail-fast，不 partial-apply
    }
  }
}
```

**与 `ensureCloudAuthoringSchema` 的冻结与切换策略**：

| 阶段 | `ensureCloudAuthoringSchema` 行为 | `migrations runner` 行为 | 启动顺序 |
|------|--------------------------------|-------------------------|---------|
| **Phase A**（已完成） | 保留现有 DDL；冻结新 DDL | 在 `ensureCloudAuthoringSchema` **之后**运行，仅处理增量变更（`ALTER TABLE datasource_connections ADD workspace_id`、`CREATE TABLE session_revocations` 等） | 1. config load → 2. **ensureCloudAuthoringSchema** → 3. **migrations runner** |
| **Phase B**（当前） | 仅保留为调用 `applyDbMigrations` 的兼容入口；不再含内联 DDL | 接管全部 DDL；baseline migration 文件（0001–0005）可从空库创建目标 schema | 1. config load → 2. migrations runner |

> **评审 v4 #1 修正**：原 Phase A 顺序 `runner → ensureCloudAuthoringSchema` 会导致新 DB 在 runner 阶段执行 `0006_datasource_workspace_id.sql` 时找不到 `datasource_connections` / `workspaces`（这两张表由 `ensureCloudAuthoringSchema` 创建，`schema.ts:47` / `:135`）。必须先 ensure 再 runner。

**Phase A 冻结的 PR review 规则**（写入 `src/server/cloud/AGENTS.md`）：

- 任何对 `ensureCloudAuthoringSchema` 函数体的 `create table` / `alter table` / `do $$ ... $$` 块的新增 = **拒绝合并**
- 新 DDL 必须以 `src/server/db/migrations/{seq}_{name}.sql` 文件形式提交
- 例外：纯字符串/常量改动（如默认 user name）允许，但需要单独 PR 标记 `[schema-frozen-exempt]`

**Phase B 切换结果**：

1. `ensureCloudAuthoringSchema` 的内联 DDL 已拆为 `0001_workspace_identity.sql` ... `0005_authoring_runtime.sql`
2. `0006_datasource_workspace_boundary.sql`、`0007_session_revocations.sql`、`0008_user_preferences_quota_usage.sql` 保留为增量 migration
3. `src/server/cloud/schema.ts` 中的 `ensureCloudAuthoringSchema` 仅作为兼容入口调用 runner
4. 代码级验证由 `tests/db-phase-b-migrations.test.ts` 覆盖；生产发布前仍需在 staging 用全新数据库跑一次实际建库演练

### 11.2 Config loader（Sprint 0）

详见 §4.3 与架构 §15.2。

### 11.3 LLM Provider 抽象（Sprint 1 或 Sprint 6，评审 v4 #5 修正）

**现状（🟢 部分已实现，勿从零设计）**：
- `src/ai/providers/pi-model-runtime.ts`：`resolvePiModelRuntime()` 通过 pi-ai `ModelRegistry` + `AuthStorage` 解析模型
- ENV：`PI_PROVIDER`、`PI_MODEL`、`PI_THINKING_LEVEL`（必填前两项）
- 已有测试：`tests/provider-config.test.ts`（DeepSeek）、`tests/provider-observability.test.ts`
- pi-ai registry 支持的 provider（含 DeepSeek、OpenAI 等）由 registry 动态发现，**不限于 openai/anthropic**

**目标（增量演进，非替换）**：
1. 在现有 `PiModelRuntime` 外包一层 `LlmProvider` 接口（Sprint 0 stub）
2. `PiModelRuntimeProvider` adapter：内部委托 `resolvePiModelRuntime`
3. 新增 `MockProvider`（contract / integration 测试默认）
4. `src/ai/getLlmProvider.ts` 根据 ENV 返回单例

**ENV 兼容映射**（`src/server/config/load.ts` + `provider-auth-env-allowlist.ts`）：

| ENV 类别 | Key | 加载方式 |
|---------|-----|---------|
| LLM 路由（目标） | `SDS_LLM_PROVIDER` / `SDS_LLM_MODEL` / `SDS_LLM_THINKING_LEVEL` | Zod schema（optional）；未设则 fallback |
| LLM 路由（兼容） | `PI_PROVIDER` / `PI_MODEL` / `PI_THINKING_LEVEL` | 同上，声明为 optional；`resolveLlmConfig()` 优先 SDS_* |
| Provider 鉴权 | `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / … | **Passthrough allowlist**（`provider-auth-env-allowlist.ts`）；**不进 Zod schema**；pi-ai `AuthStorage` 直读 `process.env`（与 `tests/provider-config.test.ts:16` 一致） |

**Fail-fast 范围**（评审 v4 #1）：`config/load.ts` 仅对 schema 中 **required** 的 SDS_* 缺失时报错。**禁止**“整个 process.env 未声明即 fail-fast”，否则 `DEEPSEEK_API_KEY` 等会被误杀。

**运行时校验**：`resolvePiModelRuntime()` 在首次调用时验证当前 provider 是否有可用 auth；启动阶段不因未部署的 provider key 缺失而失败。

**禁止**：硬编码 `SDS_LLM_PROVIDER: z.enum(["openai", "anthropic", "mock"])`；禁止要求所有 auth key 统一为 `SDS_LLM_API_KEY`。

可在 Sprint 1 完成 adapter 层（如 Auth 团队空闲）或推迟到 Sprint 6 后。

### 11.4 PR review 时间预留

每个 Sprint 时间不包括 PR review。每个 Sprint 实际投入额外加 20%。

### 11.5 长 feature branch 的 rebase 频率

Sprint 1 / 3 是较长的 branch，建议：

- **每 2 个工作日** rebase 一次 main
- 每周一次小范围 squash
- 每周一次跨 Sprint 同步会，对齐接口（i18n key、事件命名、config schema）

---

## 12. 清理与文档同步

每个 Sprint 完成后：

### 12.1 删除"过渡代码"

- 不允许保留"兼容旧版本"分支
- 不允许保留 `// TODO: remove after migration` 注释
- 删除即删除，靠 git history 回看

### 12.2 文档同步

- 任何架构变更同步更新 `docs/architecture.md` 对应章节
- 任何 ADR 决策变化追加 ADR-N，**不修改已有 ADR**（保留决策历史）
- 各层 `AGENTS.md` 与代码同步
- 架构文档中对应章节的 historical yellow 标记改为 🟢；附录 B 对应行删除

### 12.3 archive 历史

- 旧 trace 文件搬到 `logs/archive/legacy-{date}/`（Sprint 2 §6.8）
- 本文档 (`docs/migration.md`) 在 Sprint 6 完成后归档至 `docs/archive/migration-2026-q2.md`
- `docs/architecture.md` 顶部移除"从旧实现迁移：见 migration.md"链接

---

## 13. 最终验收清单

迁移完成的 acceptance criteria，按"自动 / 手动 / 后续 Auth0"分类。当前迁移目标是 provider-compatible local auth 与单 workspace 产品形态；真实 Auth0 登录不在本次完成范围内。

### 13.1 自动验收（CI 强制）

#### 代码扫描

- [x] `grep -r "old identity resolver" src/` 无结果
- [x] `grep -r "localStorage identity session" src/` 无结果
- [x] `grep -r "legacy trace writer" src/` 无结果
- [x] ESLint `no-identity-in-request` 在所有 `src/app/api/**` 不触发
- [x] 类型检查：`AuthoringToolRegistration.requiredPermissions` 在所有工具都存在
- [x] 类型检查：`DashboardDocument.schema_version` 必填
- [x] DB schema：`datasource_connections.workspace_id` 为 `not null`

#### 编译 / 类型

- [x] `npm run typecheck` 通过
- [x] `npm run lint` 通过（含自定义规则 error 模式）

#### 测试

- [x] `npm test`（全部）通过
- [x] `npm run test:contract -- --coverage` 覆盖真实迁移不变量：schema version、lint error gate、受保护 route 先鉴权后解析、execute-batch 身份边界
- [x] `npm run test:e2e` 通过当前 local login / session / CSRF 基础路径（Playwright，Sprint -2 §2.1 加入）
- [x] 性能基准未回归超过 2×（CI 信号，开 issue 不阻塞）

#### 配置（评审 v3 #9 修正：列出的脚本需先添加）

- [x] Sprint 0 §4.3.1 已要求新增 `package.json` 脚本：
  - [x] `npm run script:check-env`（三段校验：① `SDS_*` 引用 ⊆ Zod schema；② `PI_*` fallback ⊆ Zod optional；③ allowlist keys ∉ Zod + 当前示例 provider auth key 在 `.env.example` 有值）
  - [x] `npm run script:check-i18n`（解析 `src/web/i18n/keys.ts` 与 `locales/*.ts`，求差集）
- [x] 上述脚本在 CI 中执行通过

### 13.2 手动验收（验收人员执行）

#### 行为（评审 v3 #9 修正：401 例外明确）

- [x] **除 `/api/auth/login` + `/api/auth/refresh` 外**，未登录访问任意受保护 API 返回 401；mutating routes 先鉴权/CSRF，再解析 body
- [x] `POST /api/auth/login` 当前为 local DB credential provider；错误凭证返回 401 `INVALID_CREDENTIALS`；连续 5 次后返回 429（rate limit）
- [x] `POST /api/auth/refresh` 旧 token 已超 grace period 返回 401
- [x] 篡改 cookie 返回 401
- [x] kid 不匹配返回 401
- [x] 跨站 POST 返回 403
- [x] 缺少权限的用户无法看到对应工具（Authoring UI / `WorkspacePolicy.derive` 验证）
- [x] 当前单 workspace 产品中，datasource list / get / schema / preview / test / delete / execute-batch 全部使用 session 的 `ws_default` namespace，不信任 body/query workspace identity
- [x] **execute-batch body 中故意伪造 `workspace_id`，服务端仍使用 session.workspaceId**（评审 v3 #4）
- [x] 触发任意 quota 返回 `QUOTA_*` + 409 + 友好弹窗
- [x] 触发 rate limit 返回 429 + Retry-After
- [x] 单 view 渲染失败不影响其他 view
- [x] 单 query 失败不影响其他 query
- [x] 旧 schema 文档（顶层无 `schema_version`，spec 内 `"0.3"`）自动 migrate 后加载成功；migrate 后顶层 `"1.0"` + spec 内仍 `"0.3"`（评审 v3 #6）
- [x] 模型超时 60s 后前端展示重试按钮，session 状态保留
- [x] **PendingProposal 11min 后 applyPatch 返回 `PROPOSAL_EXPIRED`**（评审 v3 #7b）
- [x] **`AUTHOR_TOOL_STEP_LIMIT = 20`，第 21 步自动转 chat-only**（评审 v3 #7d）
- [x] **BindingResult `status: "empty"` 时 view 渲染 empty 占位（非 error 占位、非 ChartErrorPlaceholder）**（评审 v3 #7c）

#### 文档与约束（评审 v3 #9 修正：AGENTS.md 真实落地）

- [x] `docs/architecture.md` 中 historical yellow 标记数量为 0（全部 🟢）；historical red 为 0
- [x] **架构 §17 中列出的所有 AGENTS.md 约束已真实写入对应文件**（不只是文档摘要表）：
  - [x] `src/server/auth/AGENTS.md` 含 "唯一入口 requireServerSession / token 不出现在日志 payload / mutating 必查 CSRF" 字面条款
  - [x] `src/app/AGENTS.md` 含 "禁止从 req.json/searchParams 读 userId/workspaceId"
  - [x] `src/web/AGENTS.md` 含 "fetch 全部 credentials: include / mutating 加 X-CSRF-Token"
  - [x] `src/server/cloud/AGENTS.md` 含 "Phase A 期间 ensureCloudAuthoringSchema 冻结，新 DDL 必走 migration 文件"
  - [x] 其它见架构 §17 表
- [x] 本文档 (`docs/migration.md`) 已归档至 `docs/archive/`
- [x] `docs/operations.md` 已记录 ENV 变更与归档操作
- [x] `docs/audit/route-inventory.md` 中所有路由"Sprint 1 改造状态"全部打勾

### 13.3 后续 Auth0 验收（不属于本次 finalized migration）

- [ ] 创建 Auth0 application / tenant 配置，并记录 callback/logout URLs
- [ ] 新增 Auth0 provider：验证 Auth0 callback/token 后产出 `NormalizedIdentity(provider="auth0", subject=Auth0 sub)`
- [ ] Auth0 user subject 通过 `auth_identities` 映射到本地 `userId`，`workspaceId` 固定为 `ws_default`
- [ ] Auth0 roles 如需使用，仅作为同步输入映射到本地 `workspace_user_roles`；运行时授权继续读取本地 permissions
- [ ] 错误凭证 / Auth0 callback 失败返回 401 或重定向登录错误页
- [ ] CI/E2E 建立 Auth0 测试策略或 session mock 策略

---

## 14. 回滚方案

### 14.1 回滚分级

| 级别 | 触发 | 行为 |
|------|------|------|
| L1 应用回滚 | 代码 bug、性能严重退化 | 部署旧 release artifact；DB 不动 |
| L2 DB schema 回滚 | DB migration 后发现问题 | 恢复 DB backup 至该 migration 之前；同时回滚代码 |
| L3 数据回滚 | 误操作导致数据损坏 | 恢复 DB backup + 重放部分事务（手动） |

### 14.2 各 Sprint 的回滚策略

#### Sprint 1（Auth）

| 场景 | 回滚 |
|------|------|
| 用户大量被强制登出 | L1：回滚到 Sprint 0 代码；临时恢复本地 identity session；用户重新进入旧流程 |
| `session_revocations` 表数据丢失 | L2 不需要：该表丢失仅影响紧急撤销，重启即可（cookie 自然过期） |
| `datasource_connections.workspace_id` 迁移错误（如错绑 workspace） | L2：恢复 DB backup 至 Sprint 1 之前；再次更新 workspace 归属 |
| JWT secret 泄漏 | 应急轮换：写入 ENV `SDS_SESSION_SECRETS.previous`，将泄漏 secret 标记为"已撤销"；所有用户重新登录 |

#### Sprint 2（Observability）

- 旧 trace 文件已归档至 `logs/archive/legacy-{date}/`，可随时复读（虽然 trace viewer 不再解析）
- 代码回滚：L1 即可；新 trace 文件保留作历史记录

#### Sprint 4（Quota）

- Quota 默认值过严 → 不需要代码回滚，调整 ENV `SDS_QUOTA_*` 立即生效（无需重启）
- 极端情况：在 `config/load.ts` 加 emergency override flag，禁用所有 quota（仅用于救火，使用后 24h 内必须修复）

#### Sprint 5（Schema）

| 场景 | 回滚 |
|------|------|
| Migrator 把数据写坏 | L2：恢复 DB backup 至 Sprint 5 之前 |
| 大量文档 migrate 失败 | L1：回滚代码，但 DB 不动——`dashboard_spec.schema_version: "0.3"` 仍然兼容旧二进制（这是 §9 冗余字段保留的目的） |
| 顶层 `schema_version` 字段使旧二进制崩溃 | 不会发生：旧二进制不读顶层字段，只读 spec 内字段 |

### 14.3 DB 备份点

每个 Sprint 上线前**必须**：

```bash
# 在生产 DB 创建命名 backup
pg_dump -Fc -f /backup/pre-sprint-${N}-$(date +%Y%m%d-%H%M%S).dump $DATABASE_URL

# 验证 backup 完整性
pg_restore --list /backup/pre-sprint-${N}-*.dump | head
```

保留至少 90 天，关键 Sprint backup（如 Sprint 5 Schema 升级）保留 1 年。

### 14.4 旧二进制兼容性矩阵

| Sprint 完成后 | 旧二进制（Sprint -1 代码）能否运行 | 备注 |
|--------------|--------------------------------|------|
| Sprint 0 | ✅ 完全兼容 | 仅加空骨架 |
| Sprint 1 | ❌ DB schema 变更（`workspace_id`）+ 旧前端 localStorage 失效 | 必须新版前后端同时部署 |
| Sprint 2 | ⚠️ 部分兼容 | 旧二进制仍用历史 trace writer（已删），启动失败 |
| Sprint 3 | ✅ 大部分兼容 | 行为差异（无失败矩阵），可读 DB |
| Sprint 4 | ✅ 兼容 | 旧二进制不会触发 quota 拒绝 |
| Sprint 5 | ✅ 兼容 | spec 内 `schema_version: "0.3"` 仍存在 |
| Sprint 6 | ✅ 兼容 | 仅加测试 |

**结论**：Sprint 1 / 2 完成后**不可单边回滚二进制**，必须代码 + DB 同步回滚。

### 14.5 失败后的恢复运行时

如果生产 Sprint 完成上线后失败（必须回滚）：

1. **5 分钟内**：
   - 部署运维通过 LB 切流到 maintenance 页（如果有 blue-green，切到 green）
   - 通知值班开发
2. **30 分钟内**：
   - 决定回滚级别（L1 / L2 / L3）
   - 备份当前生产 DB（防止"再坏"）：`pg_dump ... > /backup/incident-$(date +%s).dump`
3. **回滚执行**：
   - L1：换 release artifact 重启
   - L2：恢复 DB backup（`pg_restore`）+ 部署对应版本代码
4. **回滚后**：
   - 跑健康检查 + smoke test
   - 切流恢复
   - 24 小时内 postmortem

### 14.6 Reverse migration（DB 层）

DB migration 不支持 down migration。若需 schema 回退：

- **小变更**（加字段 nullable、加索引）：写新 migration 删除该字段/索引
- **大变更**（删字段、改类型、外键变更）：写 reverse migration + 恢复 backup 的混合方案

每个 Sprint 的 DB 改动都需在 `docs/decisions/` 写一份 reverse 方案（哪怕暂时不用），用于 incident 时快速参考。

---

## 15. 风险与时间预估

### 15.1 已识别风险

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| Sprint 1 时间过长导致 main 漂移严重 | 高 | 每 2 天 rebase；子 PR 拆分；周同步会 |
| `datasource_connections` 迁移到 workspace 出错 | 高 | Sprint -2 §2.5 dashboard 用量 audit 含 datasource 关联盘点；migrator 加 dry-run 模式 |
| 旧 trace 文件归档丢失 | 中 | 归档后 verify 文件数；保留 archive 至少 6 个月 |
| Quota 默认值过严导致已有 dashboard 加载失败 | 中 | Sprint -2 audit 已盘点，按需调整 |
| Schema migration 失败导致 dashboard 不可加载 | 高 | 加载失败返回 502 而非吞错；管理 UI 提示"导出原始 JSON" |
| 95% 覆盖率门槛阻塞日常开发 | 中 | 仅 contract test 模块强制；新增普通模块不在范围内 |
| 工具链切换（如 Sprint -2 决策 B）引入隐性 bug | 中 | 选 A 或 C 降低风险；选 B 时先在小模块试点 |

### 15.2 验收失败决策树

任一 Sprint 验收失败：

```
是否阻塞用户使用？
├─ 是 → revert 该 Sprint 全部 commits（参考 §14.2）；重新规划
└─ 否 → 在 hotfix branch 修复，不阻塞下一 Sprint 启动
```

任一最终验收失败：

```
是否安全相关（Auth / CSRF / Quota）？
├─ 是 → 阻塞上线，回到对应 Sprint 重新走流程
└─ 否 → 评估是否可作为 known issue 上线，开 P1 工单跟踪
```

### 15.3 时间预估

| Sprint | 周期 | 主要交付 | 含 PR review |
|--------|------|---------|------------|
| -2 | 1 周 | Baseline 对齐：工具链 / 路由清单 / Schema 路径 / ENV | +0.2 周 |
| -1 | 0.5–1 周 | 失败模式 audit + 性能基线 | +0.2 周 |
| 0 | 1 周 | 脚手架、ENV、空实现、lint warn | +0.2 周 |
| 1 | 3–4 周 | Auth + Datasource 权限 + CSRF + 前端 cookie 化 | +0.6 周 |
| 2 | 1–2 周 | ObservabilityBus + 事件迁移 + 旧 trace 归档 | +0.3 周 |
| 3 | 2 周 | 失败矩阵实现 + i18n 全覆盖 | +0.4 周 |
| 4 | 1–2 周 | Quota guards + Rate limit + 管理 UI 用量 | +0.3 周 |
| 5 | 1 周 | Schema v0.3 → v1.0 + migrator framework + fixture | +0.2 周 |
| 6 | 1–2 周 | Contract 测试加固 + E2E + 性能基准 | +0.3 周 |
| **合计** | **12–14 周** | （单人 + review）| |
| **并行（2 人）** | **7–8 周** | Sprint 2/5/6 + LLM Provider 并行 | |
| **并行（3 人）** | **6–7 周** | 进一步切前后端 | |

---

*迁移完成后，本文档归档至 `docs/archive/migration-2026-q2.md`；`docs/architecture.md` 将所有 historical yellow 标记改为 🟢，附录 B 删除或归档。*
