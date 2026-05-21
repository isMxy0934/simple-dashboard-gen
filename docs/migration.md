# Migration Plan — 从现有实现迁移到目标架构

> **目标架构**：见 [docs/architecture.md](./architecture.md)  
> **本文档定位**：把当前代码的实现状态，逐 Sprint 收敛到目标架构。一次性破坏性更新，**不保留兼容层**。  
> **总投入估算**：10–12 周（单人全职），可并行加速到 5–6 周。  
> **文档生命周期**：迁移完成后归档至 `docs/archive/migration-2026-q2.md`。

---

## 目录

1. [迁移总览](#1-迁移总览)
2. [Sprint -1：前置 Audit](#2-sprint--1前置-audit05-1-周)
3. [Sprint 0：脚手架与契约](#3-sprint-0脚手架与契约1-周)
4. [Sprint 1：Auth 统一](#4-sprint-1auth-统一3-4-周)
5. [Sprint 2：ObservabilityBus](#5-sprint-2observabilitybus1-2-周)
6. [Sprint 3：失败模式与降级](#6-sprint-3失败模式与降级2-周)
7. [Sprint 4：容量上限与限流](#7-sprint-4容量上限与限流1-2-周)
8. [Sprint 5：Schema 版本化](#8-sprint-5schema-版本化1-周)
9. [Sprint 6：Contract 测试加固](#9-sprint-6contract-测试加固1-周)
10. [横向工作流](#10-横向工作流)
11. [清理与文档同步](#11-清理与文档同步)
12. [最终验收清单](#12-最终验收清单)
13. [风险与回滚](#13-风险与回滚)
14. [时间预估](#14-时间预估)

---

## 1. 迁移总览

### 1.1 当前 vs 目标

| 维度 | 当前实现 | 目标 | Sprint |
|------|---------|------|--------|
| Auth | A/B/C 三档（`resolveServerRequestContext` + query string + 完全裸奔） | 唯一 `requireServerSession`，cookie-based JWT，支持密钥轮换 | 1 |
| CSRF | 无 | Origin 校验 + 可选 token | 1 |
| 前端登录态 | `LocalAuthSession` in localStorage | HTTP-only cookie，前端无 token；SSR cookie 转发封装 | 1 |
| 工具注册 | 无 `requiredPermissions` 字段 | `AuthoringToolRegistration` 含 `requiredPermissions`；`WorkspacePolicy.derive` 在 turn 入口过滤 | 1 |
| 可观测性 | `writeSessionTraceEvent` 直接写 JSONL | `observability.emit` + `ObservabilityBus` + 多 sink；`level` 与 `type` 正交 | 2 |
| 事件命名 | `{scope}.{event}`（如 `authoring-agent.turn_start`） | 标准 `agent.*` / `query.*` / `document.*` / ...（见架构 §5.4） | 2 |
| 失败处理 | 散落在各层 try/catch | 集中"失败模式矩阵"（架构 §7.1）+ i18n 文案 | 3 |
| 容量上限 | 隐式 / 无 | `src/server/guards/quotas.ts` 集中声明 | 4 |
| Rate Limit | 无 | `src/server/guards/rate-limit.ts` 路由级令牌桶 | 4 |
| Schema 版本 | 无 `schema_version` 字段 | 显式版本 + migrator + fixture 测试 | 5 |
| 测试金字塔 | 不成体系 | Contract 主防线（95% 覆盖），Integration 配合，E2E 兜底 | 6 |
| DB Schema 管理 | 隐式 `ensureCloudAuthoringSchema` | 显式 `src/server/db/migrations/*.sql` + runner | 横向（§10.1） |
| Config 加载 | 散读 `process.env` | `src/server/config/load.ts` 集中 Zod 校验，启动 fail-fast | 横向（§10.2） |
| LLM Provider | 直连模型 | `LlmProvider` 抽象 + `MockProvider` | 横向（§10.3） |
| i18n | 部分 hardcode | 所有用户可见走 i18n key；服务端返 `message_i18n_key` | 横向（贯穿 Sprint 3）|

### 1.2 顺序依赖

```
Sprint -1 (Audit)
    ↓
Sprint 0  (脚手架)
    ↓
Sprint 1  (Auth)  ★ 强依赖 ★
    ↓
   ┌────────┬────────┬────────┐
Sprint 2  Sprint 5  Sprint 6
(Observ)  (Schema)  (Contract)
    ↓
Sprint 3  (失败)  ← 依赖 Sprint 2 的事件类型
    ↓
Sprint 4  (Quota + Rate)
```

**强依赖**：Sprint 1（Auth）必须先于 Sprint 3 / 4，因为失败矩阵与 quota 拒绝都要 emit 关联 `UserSession.requestId` 的事件。  
**可并行**：Sprint 2 / 5 / 6 在 Sprint 1 完成后可三线并行（2–3 人协作时）。

### 1.3 破坏性更新声明

本次迁移**不提供向后兼容**：

- 所有 API 路由签名变更（删除 body / query 中的 identity 字段）
- 前端 `LocalAuthSession` 彻底删除
- `DashboardDocument` 增加 `schema_version`，旧文档加载强制走 migrator
- `writeSessionTraceEvent` 删除，所有调用方迁移到 `observability.emit`
- 事件命名格式变更（旧 trace 文件不再被新 trace viewer 解析）
- 所有 mutating 路由必须带 CSRF 校验（Origin / Token），未带的请求 403

**部署窗口前必须完成**：
- 提前 1 周通过站内通知 + 邮件告知所有用户"系统升级期间将强制重新登录"
- Staging 环境跑通完整 E2E + 一组真实用量的 dashboard 样本
- 准备回滚预案（详见 §13）

---

## 2. Sprint -1：前置 Audit（0.5–1 周）

**目标**：在开始 Sprint 0 前 ~1 周，盘点现状，避免后续 Sprint 才发现"路由数远超预估"或"现有 dashboard 触发新 quota"。

### 2.1 路由清单

```bash
# 列出所有 API 路由文件，输出 docs/audit/route-inventory.md
find src/app/api -type f -name "route.ts" | sort > docs/audit/route-inventory.md
```

对每个路由记录：HTTP method、当前是否走 `resolveServerRequestContext`、读取 identity 的方式、所需权限（待定）。

### 2.2 ENV 清单

```bash
# 抓取所有 process.env.* 使用
rg -o "process\.env\.([A-Z_]+)" -r '$1' src/ | sort -u > docs/audit/env-inventory.md
```

### 2.3 现有 dashboard 用量盘点

```sql
-- 在 staging DB 跑（不要在生产）
SELECT
  workspace_id,
  count(*) as dashboard_count,
  max(jsonb_array_length(document_jsonb->'dashboard_spec'->'views')) as max_views,
  max(jsonb_array_length(document_jsonb->'query_defs')) as max_queries,
  max(octet_length(document_jsonb::text)) as max_doc_bytes
FROM dashboard_documents
GROUP BY workspace_id
ORDER BY dashboard_count DESC LIMIT 50;
```

输出 `docs/audit/dashboard-usage.md`，与架构 §8.1 默认 quota 对比。**如有现存数据超 quota，必须先调整默认值或通知用户拆分，否则 Sprint 4 上线即破坏现有 dashboard 加载**。

### 2.4 现有事件统计

```bash
# 统计 trace.jsonl 中出现的事件类型频率
find logs/sessions -name "trace.jsonl" -exec jq -r '.scope + "." + .event' {} \; \
  | sort | uniq -c | sort -rn > docs/audit/event-inventory.md
```

用于 Sprint 2 设计事件命名映射时确认覆盖。

### 2.5 验收

- [ ] `docs/audit/route-inventory.md` 完整列出所有路由
- [ ] `docs/audit/env-inventory.md` 与架构 §15.2 / §1.3 中提到的 ENV 对照，差异有解释
- [ ] `docs/audit/dashboard-usage.md` 显示无现存 dashboard 触发 default quota；如有，记录建议覆盖值
- [ ] `docs/audit/event-inventory.md` 与架构 §5.4 / §5.5 事件命名映射对照表（Sprint 2 §5.4 用）

---

## 3. Sprint 0：脚手架与契约（1 周）

**目标**：为后续 Sprint 准备目录、类型契约、ENV 变量、空实现，**不改变现有行为**。

### 3.1 新建目录

```bash
mkdir -p src/server/auth src/server/guards src/server/config
mkdir -p src/server/dashboards/migrations
mkdir -p src/server/db/migrations
mkdir -p src/server/logs/sinks
mkdir -p src/ai/providers
mkdir -p docs/audit docs/archive
```

### 3.2 新建文件（空实现 + 类型）

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
| `src/server/config/load.ts` | `config` 单例，Zod schema 覆盖所有 ENV |
| `src/server/config/AGENTS.md` | 见架构 §17 |
| `src/server/logs/observability.ts` | `ObservabilityEvent` / `LogSink` / `ObservabilityBus` 接口 + `observability` 单例（内部 stub） |
| `src/server/logs/sinks/jsonl-file-sink.ts` | 空实现 |
| `src/server/logs/sinks/ai-trace-sink.ts` | 空实现 + 新白名单常量 |
| `src/server/logs/AGENTS.md` | 见架构 §17 |
| `src/server/dashboards/migrations/types.ts` | `Migrator` / `MigrationError` |
| `src/server/dashboards/migrations/index.ts` | `migrateToCurrent(doc)` 空实现（直接返回原文档 + 补 v1.0） |
| `src/server/dashboards/migrations/AGENTS.md` | 见架构 §17 |
| `src/server/db/migrations/runner.ts` | DB migration runner 空实现 |
| `src/server/db/AGENTS.md` | 见架构 §17 |
| `src/server/api-error.ts` | `ApiError` 类（含 `code` / `i18nKey` / `status` / `payload`） |
| `src/contracts/schema-version.ts` | `SchemaVersion` 类型、`CURRENT_SCHEMA_VERSION = "1.0"` |
| `src/ai/providers/types.ts` | `LlmProvider` 接口 |
| `src/ai/providers/mock-provider.ts` | `MockProvider` 实现 |
| `src/ai/providers/AGENTS.md` | 见架构 §17 |
| `src/web/api/server-fetch.ts` | SSR cookie 转发封装空实现 |
| `src/web/dashboard/render/chart-error-placeholder.tsx` | 空组件 + i18n key |
| `eslint-rules/no-identity-in-request.js` | 自定义 ESLint 规则 |
| `src/web/i18n/keys.ts` | i18n key 集中导出（已有的迁入；新的预留） |

### 3.3 ENV 变量

新增 `.env.example` 条目，`src/server/config/load.ts` 用 Zod 校验所有 ENV 存在。

```bash
# Auth
SDS_SESSION_SECRETS='{"current":{"kid":"k1","secret":"REPLACE_ME_32B"},"previous":[]}'
SDS_SESSION_TTL_DAYS=7
SDS_SESSION_REFRESH_GRACE_HOURS=24
SDS_ALLOWED_ORIGINS=http://localhost:3000

# Database
SDS_DATABASE_URL=postgresql://...

# LLM
SDS_LLM_PROVIDER=mock   # openai | anthropic | mock
SDS_LLM_API_KEY=        # 非 mock 时必填
SDS_LLM_MODEL=          # 由 provider 决定

# Quotas（可覆盖默认值）
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
SDS_OBSERVABILITY_SINKS=jsonl,ai-trace   # 逗号分隔；可加 sentry, otel
SDS_SENTRY_DSN=
SDS_OTEL_ENDPOINT=
```

### 3.4 ESLint 规则

`eslint-rules/no-identity-in-request.js`：禁止 `src/app/api/**/*.ts` 中：

- `req.json()` 后访问 `.userId` / `.workspaceId`
- `searchParams.get("userId")` / `searchParams.get("workspaceId")`

本 Sprint 以 `warn` 模式启用，Sprint 1 完成后切 `error`。

### 3.5 验收

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过（新规则为 warn）
- [ ] `pnpm test`（既有测试）全部通过（行为未变）
- [ ] 所有新文件均有对应 `AGENTS.md`
- [ ] `.env.example` 与 `src/server/config/load.ts` Zod schema 一一对应

---

## 4. Sprint 1：Auth 统一（3–4 周）

**目标**：实现 `requireServerSession` + CSRF + 密钥轮换 + 前端 cookie 化 + 工具权限过滤；删除三档共存。

### 4.1 子任务拆分

| 子任务 | 周期 | 可并行 |
|--------|------|--------|
| 1.1 JWT 签发 / 验证（含 kid 选择） | 3 天 | — |
| 1.2 `requireServerSession` 实现 + revocations 缓存 | 3 天 | — |
| 1.3 CSRF 中间件（Origin / Referer 白名单） | 2 天 | 1.1 后 |
| 1.4 登录 / 续期 / 登出路由 | 3 天 | 1.2 后 |
| 1.5 改造所有 API 路由（加 `requireServerSession` + `requirePermission` + CSRF） | 5–8 天 | 1.4 后 |
| 1.6 前端 cookie 化（删 LocalAuthSession、加 server-fetch、跳转 /login） | 4 天 | 与 1.5 并行 |
| 1.7 `AuthoringToolRegistration.requiredPermissions` + `WorkspacePolicy.derive` | 3 天 | 1.2 后 |
| 1.8 删除旧代码 + lint 切 error | 1 天 | 全部后 |

### 4.2 实现 `requireServerSession`

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

  const claims = await verifySessionToken(token);  // 内部按 kid 选密钥
  if (claims.exp * 1000 < Date.now()) {
    throw new ApiError(401, "SESSION_EXPIRED", "error.auth.session_expired");
  }

  if (await isRevoked(claims.jti)) {
    throw new ApiError(401, "SESSION_REVOKED", "error.auth.session_revoked");
  }

  // 非 GET/HEAD 必查 CSRF
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

`isRevoked` 内部带 60s LRU 缓存。

### 4.3 JWT 密钥轮换实现

```typescript
// src/server/auth/jwt.ts
import { config } from "@/server/config/load";

const SECRETS = config.SDS_SESSION_SECRETS;  // { current: {kid, secret}, previous: [{kid, secret}] }

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

### 4.4 实现登录 / 续期 / 登出路由

| 路由 | 行为 |
|------|------|
| `POST /api/auth/login` | 验证凭证 → 签发 JWT → `Set-Cookie: sds_session=...; HttpOnly; Secure; SameSite=Lax` |
| `POST /api/auth/refresh` | 验证旧 token 在 grace period 内 → 签发新 token → 覆盖 cookie |
| `POST /api/auth/logout` | 写 `session_revocations`（即时撤销） + 清除 cookie |

### 4.5 改造所有 API 路由

基于 Sprint -1 的 `route-inventory.md` 完整清单，对每个路由：

1. **首行加入** `const session = await requireServerSession(req);`
2. **删除 body / query 中的 `userId` / `workspaceId` 字段**，统一从 `session` 取
3. **加权限校验**：根据路由职责加 `requirePermission(session, ...)`
4. **替换 i18n 文案**：错误响应使用 `message_i18n_key` 字段

**重点路由所需权限**：

| 路由 | 所需权限 |
|------|---------|
| `POST /api/authoring/chat/[id]/stream` | `dashboard.edit` |
| `PUT /api/authoring/ui-session` | `dashboard.edit` |
| `POST /api/authoring/session/open` | `dashboard.edit` 或 `dashboard.read` |
| `POST /api/dashboards/[id]/publish` | `dashboard.publish` |
| `GET /api/dashboards/[id]` | `dashboard.read` |
| `GET /api/dashboards` | `dashboard.read` |
| `POST /api/query/execute-batch` | `dashboard.read`（viewer）/ `dashboard.edit`（authoring）—— 通过 `dashboardId` 判定 |
| `POST /api/query/preview` | `datasource.read` |
| `GET /api/authoring/trace` | `dashboard.read` |
| `POST /api/datasources/*` | `datasource.manage` |

**完整清单以 Sprint -1 audit 输出为准**，每条改造后在 audit 文件中打 `✓`。

### 4.6 工具权限过滤 (子任务 1.7)

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

实现 `WorkspacePolicy.derive(session)`：返回 `Set<AuthoringToolName>`，包含 session.permissions 满足 `requiredPermissions` 的工具。

`computeAuthoringScope` 出口处加 `allowedTools = allowedTools ∩ WorkspacePolicy.derive(session).allowedToolNames`。

### 4.7 前端迁移 (子任务 1.6)

| 改动 | 文件 |
|------|------|
| 删除 `LocalAuthSession` 相关代码 | `src/web/auth/*` |
| 新建 `LoginPage` + `useAuth` hook | `src/web/auth/login/*` |
| 全部 `fetch` 调用加 `credentials: "include"` | grep `fetch\(` 全仓库 |
| Mutating fetch 加 `X-CSRF-Token` header（如启用 token 模式） | 同上 |
| SSR Server Component fetch 通过 `server-fetch.ts` 转发 cookie | grep server-side fetch |
| 全局 401 拦截 → 跳转 `/login` | `src/web/api/fetch-with-auth.ts`（新建） |
| 删除 body / query 中的 `userId` / `workspaceId` | grep `userId.*:.*currentUser` |

### 4.8 删除旧代码 + 切 lint

完成全部路由改造后：

```bash
rm src/server/request-context.ts
rm src/web/auth/auth-session.ts
```

```diff
- "no-identity-in-request": "warn"
+ "no-identity-in-request": "error"
```

CI 验证：所有 `src/app/api/**` 不再有 identity 读取；旧导入全部报编译错误（修复后再合入）。

### 4.9 验收

- [ ] 所有 API 路由首行 `requireServerSession`（grep 验证）
- [ ] 所有 mutating 路由通过 CSRF 校验（contract test 覆盖）
- [ ] `src/server/request-context.ts` 不存在
- [ ] `src/web/auth/auth-session.ts` 不存在
- [ ] `AuthoringToolRegistration.requiredPermissions` 在 registry 中全覆盖
- [ ] 未登录请求所有 API 返回 401
- [ ] 篡改 cookie 返回 401
- [ ] kid 不匹配返回 401
- [ ] 跨站 POST（Origin 不在白名单）返回 403
- [ ] 缺少权限的用户调用工具不在 Agent surface 中出现
- [ ] E2E：登录 → 创建 dashboard → publish 全流程通过
- [ ] Lint `no-identity-in-request` 为 `error` 且 CI 通过
- [ ] **性能基准**：`requireServerSession` P95 < 3ms（含 revocations 缓存）

---

## 5. Sprint 2：ObservabilityBus（1–2 周）

**目标**：所有事件统一通过 `observability.emit` 发出，事件类型迁移到标准命名。

### 5.1 完成 `ObservabilityBus` 实现

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

  private handleSinkError(err: unknown) {
    process.stderr.write(`[observability] sink error: ${String(err)}\n`);
  }
}

export const observability = new ObservabilityBusImpl();
```

启动时注册（在 `src/server/config/load.ts` 加载后）：

```typescript
const sinkNames = config.SDS_OBSERVABILITY_SINKS;
if (sinkNames.includes("jsonl")) observability.register(new JsonlFileSink());
if (sinkNames.includes("ai-trace")) observability.register(new AiTraceJsonlSink());
if (sinkNames.includes("sentry") && config.SDS_SENTRY_DSN) observability.register(new SentrySink());
if (sinkNames.includes("otel") && config.SDS_OTEL_ENDPOINT) observability.register(new OpenTelemetrySink());
```

### 5.2 实现 sink

| Sink | 文件 | 备注 |
|------|------|------|
| `JsonlFileSink` | `src/server/logs/sinks/jsonl-file-sink.ts` | 复用现有 `session-log-writer` 内部逻辑；加 trace 文件 rotation |
| `AiTraceJsonlSink` | `src/server/logs/sinks/ai-trace-sink.ts` | 白名单内事件镜像写入 trace.ai.jsonl |
| `ConsoleSink` | `src/server/logs/sinks/console-sink.ts` | 仅 dev 模式启用 |
| `SentrySink` (可选) | `src/server/logs/sinks/sentry-sink.ts` | `level: "error"` 事件转 Sentry |
| `OpenTelemetrySink` (可选) | `src/server/logs/sinks/otel-sink.ts` | OTLP / HTTP 转发 |

### 5.3 迁移调用方

```bash
rg -l "writeSessionTraceEvent" src/
```

对每个调用：

```diff
- await writeSessionTraceEvent({
-   sessionId,
-   scope: "authoring-agent",
-   event: "turn_start",
-   payload,
- });
+ observability.emit({
+   type: "agent.turn.start",          // 见 §5.4 命名映射
+   sessionId,
+   dashboardId,
+   turnId,
+   requestId: session.requestId,
+   timestamp: new Date().toISOString(),
+   level: "info",
+   payload,
+ });
```

**level 选择**遵循架构 §5.2 正交规则：
- 正常流程 → `info`
- 异常但可自动恢复 → `warn`
- 需告警 → `error`

### 5.4 事件命名映射表

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
| **新增**（之前未打点） | `agent.tool.call` / `agent.tool.result` |
| **新增** | `query.start` / `query.complete` / `query.error` / `query.timeout` |
| **新增** | `document.draft.stage` / `document.patch.compose` / `document.patch.apply` / `document.publish` / `document.migrate` |
| **新增** | `render.materialize.error` / `render.validate.fail` |
| **新增** | `auth.session.create` / `auth.session.invalid` / `auth.session.forbidden` |
| **新增** | `quota.exceeded` / `quota.warning` |
| **新增** | `rate_limit.exceeded` |
| **新增** | `error.unhandled` |

**注**："新增"事件不在本 Sprint 一次性全打。本 Sprint 只完成命名映射与基础设施；新增事件随后续 Sprint（特别是 Sprint 3 失败模式、Sprint 4 quotas）落地。

### 5.5 更新 AI trace 白名单

`AI_TRACE_EVENT_WHITELIST` 内容更新为架构 §5.5 中的新事件类型列表。

### 5.6 删除旧代码

```bash
rm src/server/logs/session-log-writer.ts
```

### 5.7 Trace viewer API 兼容

`GET /api/authoring/trace` 内部解析事件结构变更：从 `{scope, event}` 拼接，改为直接读 `type`。前端 trace viewer 同步更新。

### 5.8 归档旧 trace 文件

```bash
mv logs/sessions logs/archive/legacy-$(date +%Y%m%d)
mkdir -p logs/sessions
```

部署文档（`docs/operations.md`）记录此操作时间，后续支持 / 调试参考。

### 5.9 验收

- [ ] `writeSessionTraceEvent` 在仓库内不存在
- [ ] 所有事件 `type` 符合架构 §5.4 命名规范
- [ ] 所有事件含 `requestId`（来自 `UserSession`）
- [ ] 新 trace 文件能被 trace viewer API 读取
- [ ] 旧 trace 文件已归档
- [ ] Contract test：注册 2 个 mock sink，emit 1 个事件，验证两个 sink 都收到
- [ ] Contract test：单 sink throw，其它 sink 仍写入

---

## 6. Sprint 3：失败模式与降级（2 周）

**目标**：实现架构 §7.1 失败矩阵中所有项的检测、传播、降级行为。

### 6.1 失败模式审计（第一周前 2 天）

为矩阵中每行失败，定位现有代码：

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
  - [ ] 60s 硬超时（当前 ≥ 120s）
  - [ ] SSE 流送 specific error code "agent.turn.error.timeout"
  - [ ] 前端 toast + 重试按钮
  - [ ] i18n key "error.authoring.agent_timeout"
- 责任人：xxx
```

### 6.2 实现缺口

按矩阵补齐缺失项，重点：

| 矩阵项 | 实施位置 |
|--------|---------|
| 数据源 retry + 5s 超时 | `src/server/datasource/postgres.ts`（包装 query 调用） |
| 数据源 30s 超时 | 同上 |
| 数据源 schema 漂移检测 | `src/server/execution/` + 错误代码 `SCHEMA_DRIFT` |
| pi-agent 模型 60s 硬超时 | `src/ai/authoring/agent/session.ts` |
| 模型 transient retry（2 次，指数退避） | pi-agent 配置 |
| Approval `expires_at`（10min） | `composePatch` tool → PendingProposal 加字段 + applyPatch 校验 |
| ECharts ErrorBoundary | `src/web/dashboard/render/chart-frame.tsx` |
| ChartErrorPlaceholder 组件 | `src/web/dashboard/render/chart-error-placeholder.tsx` |
| Trace rotate（50MB） | `JsonlFileSink.write` 写入前检查文件大小 |
| `BindingResult.error.message_i18n_key` | `src/contracts/binding.ts` + 查询执行层 |

### 6.3 i18n 文案

所有用户可见错误新增 i18n key。**先在 `src/web/i18n/keys.ts` 集中声明**，再在 `zh-CN.ts` / `en-US.ts` 填充：

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

构建时校验：zh-CN 与 en-US 必须覆盖 `keys.ts` 中所有路径，缺失即 CI fail。

### 6.4 失败模式 contract test

在 `src/server/__tests__/failure-modes/` 新建测试套件，每种失败 1 个测试：

```typescript
test("数据源连接失败 → 单 view ChartErrorPlaceholder", async () => {
  mockDatasourceConnectionFail();
  const result = await executeBatch(mockBatchRequest);
  expect(result.bindings[0].status).toBe("error");
  expect(result.bindings[0].message_i18n_key).toBe("error.dashboard.query_failed");
  expect(emitted).toContainEqual(expect.objectContaining({
    type: "query.error", level: "warn",
  }));
});
```

### 6.5 验收

- [ ] §7.1 矩阵中每行均有 audit 记录 + 实现 + 测试
- [ ] 所有用户可见失败有对应 i18n key（CI 校验 zh-CN + en-US 全覆盖）
- [ ] 注入数据源失败，单 view 显示 placeholder，其他 view 正常（E2E）
- [ ] 注入模型超时，前端展示重试按钮（E2E mock）
- [ ] Approval 卡 11min 后触发 expired 错误
- [ ] 任意 view 渲染 throw，其它 view 仍正常显示
- [ ] 任一 sink 失败，其它 sink 仍正常写入（已在 Sprint 2 覆盖，此处验证未回归）

---

## 7. Sprint 4：容量上限与限流（1–2 周）

**目标**：完成 `src/server/guards/quotas.ts` 与 `rate-limit.ts`，所有相关入口强制校验。

### 7.1 完成 quotas

```typescript
// src/server/guards/quotas.ts
import { config } from "@/server/config/load";

export const QUOTAS = {
  VIEWS_PER_DASHBOARD: config.SDS_QUOTA_VIEWS_PER_DASHBOARD,
  QUERIES_PER_DASHBOARD: config.SDS_QUOTA_QUERIES_PER_DASHBOARD,
  DOCUMENT_SIZE_BYTES: config.SDS_QUOTA_DOCUMENT_SIZE_MB * 1024 * 1024,
  QUERY_ROWS: config.SDS_QUOTA_QUERY_ROWS,
  QUERY_BYTES: config.SDS_QUOTA_QUERY_BYTES,
  BATCH_SIZE: config.SDS_QUOTA_BATCH_SIZE,
  AGENT_STEPS: 16,
  MODEL_INPUT_TOKENS: config.SDS_QUOTA_MODEL_INPUT_TOKENS,
  MODEL_OUTPUT_TOKENS: config.SDS_QUOTA_MODEL_OUTPUT_TOKENS,
  TRACE_FILE_BYTES: config.SDS_QUOTA_TRACE_FILE_MB * 1024 * 1024,
  SESSIONS_PER_WORKSPACE: config.SDS_QUOTA_SESSIONS_PER_WORKSPACE,
  DASHBOARDS_PER_WORKSPACE: config.SDS_QUOTA_DASHBOARDS_PER_WORKSPACE,
  STORAGE_BYTES_PER_WORKSPACE: config.SDS_QUOTA_STORAGE_GB * 1024 ** 3,
} as const;

export function assertQuota(
  code: keyof typeof QUOTAS,
  current: number,
  context: { scope: string; scope_id?: string; sessionId?: string },
): void {
  const limit = QUOTAS[code];
  if (current > limit) {
    observability.emit({
      type: "quota.exceeded",
      sessionId: context.sessionId ?? "n/a",
      dashboardId: null,
      turnId: null,
      requestId: "n/a",
      timestamp: new Date().toISOString(),
      level: "warn",
      payload: { code: `QUOTA_${code}`, limit, current, ...context },
    });
    throw new ApiError(409, `QUOTA_${code}`, `error.quota.${code.toLowerCase()}`, {
      limit, current, scope: context.scope, scope_id: context.scope_id,
    });
  }
  if (current >= limit * 0.8) {
    observability.emit({
      type: "quota.warning",
      sessionId: context.sessionId ?? "n/a",
      dashboardId: null,
      turnId: null,
      requestId: "n/a",
      timestamp: new Date().toISOString(),
      level: "info",
      payload: { code: `QUOTA_${code}`, limit, current, ...context },
    });
  }
}
```

### 7.2 检查点注入（完整清单）

| 检查点 | 调用位置 |
|--------|---------|
| `VIEWS_PER_DASHBOARD` | `applyPatch` + `publish` 入口 |
| `QUERIES_PER_DASHBOARD` | 同上 |
| `DOCUMENT_SIZE_BYTES` | 同上（序列化后检查） |
| `QUERY_ROWS` | 单 query 返回后；超限截断 + warn 事件 + binding `status: "error"` |
| `QUERY_BYTES` | 同上 |
| `BATCH_SIZE` | `execute-batch` 入口 |
| `MODEL_INPUT_TOKENS` / `MODEL_OUTPUT_TOKENS` | pi-agent 配置 + 超时同等处理 |
| `TRACE_FILE_BYTES` | `JsonlFileSink.write` 写入前 → rotate |
| `SESSIONS_PER_WORKSPACE` | session 创建 |
| `DASHBOARDS_PER_WORKSPACE` | dashboard 创建 |
| `STORAGE_BYTES_PER_WORKSPACE` | 后台 sweeper（每日一次），超限 emit warning |

### 7.3 Rate Limit 实现

```typescript
// src/server/guards/rate-limit.ts
const buckets = new Map<string, TokenBucket>();

const SCOPES = {
  login:   { capacity: 5,   refillPerSec: 5/60 },
  auth:    { capacity: 10,  refillPerSec: 10/60 },
  query:   { capacity: 60,  refillPerSec: 60/60 },
  agent:   { capacity: 30,  refillPerSec: 30/60 },
  generic: { capacity: 300, refillPerSec: 300/60 },
} as const;

export function assertRateLimit(
  scope: keyof typeof SCOPES,
  key: string,  // userId / IP / sessionId
): void {
  const bucketKey = `${scope}:${key}`;
  const bucket = buckets.get(bucketKey) ?? new TokenBucket(SCOPES[scope]);
  if (!bucket.tryConsume()) {
    observability.emit({
      type: "rate_limit.exceeded",
      // ...
    });
    throw new ApiError(429, `RATE_LIMIT_${scope.toUpperCase()}`, `error.rate_limit.${scope}`, {
      retry_after_seconds: bucket.secondsUntilNextToken(),
    });
  }
  buckets.set(bucketKey, bucket);
}
```

路由入口调用：

```typescript
// 例：execute-batch route
const session = await requireServerSession(req);
assertRateLimit("query", session.userId);
```

### 7.4 前端展示

- 全局 `QUOTA_*` 错误拦截器 → 模态弹窗（含 limit / current / 升级或拆分建议）
- 全局 `RATE_LIMIT_*` 错误拦截器 → toast + `Retry-After` 倒计时
- 管理 UI workspace usage 卡片：实时显示各维度占比，标红 ≥ 80%

### 7.5 Contract test

每个 quota / rate limit 加边界值测试。

### 7.6 验收

- [ ] `pnpm test:contract` 覆盖所有 quota 边界（`limit` pass、`limit+1` reject）
- [ ] 每个 rate limit 分组的"窗口内通过、超出拒绝"测试
- [ ] 强行 publish 51 个 view 的 dashboard 返回 `QUOTA_VIEWS_PER_DASHBOARD`
- [ ] 强行 execute-batch 21 个 query 返回 `QUOTA_BATCH_SIZE`
- [ ] 1 分钟内连续 6 次 login 第 6 次返回 `RATE_LIMIT_LOGIN`
- [ ] 管理 UI 展示当前用量
- [ ] 80% 阈值 emit `quota.warning` 事件
- [ ] 触发 quota 后 stage 中的 draft **保留**（用户可调整内容后重试，不丢工作）—— 这是 §7.2 "保留状态" 原则的具体落实

---

## 8. Sprint 5：Schema 版本化（1 周）

**目标**：所有现存 dashboard 加 `schema_version: "1.0"`，新建 migration 机制。

### 8.1 加字段

`src/contracts/dashboard.ts`：

```diff
 type DashboardDocument = {
+  schema_version: SchemaVersion;
   dashboard_spec: DashboardSpec;
   query_defs: QueryDef[];
   bindings: Binding[];
 };
```

`contract-kernel.ts` 校验：`schema_version` 必须等于 `CURRENT_SCHEMA_VERSION`（"1.0"）。

### 8.2 migrator 框架

```typescript
// src/server/dashboards/migrations/index.ts
const MIGRATORS: Migrator[] = [
  // 当前没有历史版本可迁移，留待未来变更
];

export function migrateToCurrent(rawDoc: unknown): DashboardDocument {
  if (!isObject(rawDoc)) throw new MigrationError("INVALID_DOCUMENT");
  
  let current = rawDoc as { schema_version?: string };
  
  // 兼容历史无版本字段的文档：视为 v1.0
  if (!current.schema_version) {
    current = { ...current, schema_version: "1.0" };
  }
  
  for (const migrator of MIGRATORS) {
    if (current.schema_version === migrator.from) {
      try {
        current = migrator.apply(current as any);
      } catch (err) {
        throw new MigrationError(`MIGRATION_FAILED_${migrator.from}_TO_${migrator.to}`, { cause: err });
      }
    }
  }
  
  if (current.schema_version !== CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(`UNABLE_TO_REACH_CURRENT_VERSION`, {
      reached: current.schema_version,
      expected: CURRENT_SCHEMA_VERSION,
    });
  }
  
  assertDashboardDocument(current);
  return current as DashboardDocument;
}
```

### 8.3 加载路径接入

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

### 8.4 写入路径

所有 `applyPatch` / `publish` 写入前**强制覆盖** `schema_version = CURRENT_SCHEMA_VERSION`：

```typescript
// applyPatch
const merged = { ...mergedDoc, schema_version: CURRENT_SCHEMA_VERSION };
await persistDashboardDocument(merged);
```

这是与架构 §10.3 的契约："前端永远只见 `CURRENT_SCHEMA_VERSION`"——写入路径必须保证。

### 8.5 Fixture 测试

新建 `src/server/dashboards/migrations/__fixtures__/`：

```
v1.0/
  ├── basic-bar.json
  ├── focused-kpi.json
  └── full-featured.json
no-version/
  └── legacy-without-version.json
```

每个 fixture 写三类测试：

```typescript
test("v1.0 fixture migrate to current 等于自身", () => {
  const fixture = loadFixture("v1.0/basic-bar.json");
  expect(migrateToCurrent(fixture)).toEqual(fixture);
});

test("无版本字段的文档自动补 v1.0", () => {
  const legacy = loadFixture("no-version/legacy-without-version.json");
  const migrated = migrateToCurrent(legacy);
  expect(migrated.schema_version).toBe("1.0");
});

test("migrateToCurrent 幂等", () => {
  const doc = loadFixture("v1.0/full-featured.json");
  expect(migrateToCurrent(migrateToCurrent(doc))).toEqual(migrateToCurrent(doc));
});
```

未来新增 v1.0→v2.0 migrator 时，必须新增 `v2.0/` 同名 fixture，CI 校验。

### 8.6 主动 batch 迁移工具（可选）

```bash
pnpm script:migrate-all-dashboards --workspace-id=<id> --dry-run
```

输出"将迁移 N 个 dashboard"，加 `--apply` 实际执行；每秒限流 10 个，避免冲击 DB。**仅在需要主动持久化时运行**，平时靠 applyPatch / publish 时自然回写。

### 8.7 验收

- [ ] 旧文档（无 `schema_version`）能被加载（自动补 v1.0）
- [ ] `migrateToCurrent` 幂等（测试）
- [ ] `migrateToCurrent` 失败时返回 502 而非 500
- [ ] `pnpm test:contract` 覆盖所有 fixture
- [ ] `applyPatch` 写入后文档 `schema_version === "1.0"`
- [ ] `publish` 写入后文档 `schema_version === "1.0"`
- [ ] migration 工具能在 staging 跑通完整 workspace 的 dry-run

---

## 9. Sprint 6：Contract 测试加固（1 周）

**目标**：架构 §9.2 测试不变量全部达成。

### 9.1 覆盖率目标

| 模块 | 目标 |
|------|------|
| `contract-kernel` | ≥ 95% 分支（不含 ADR-10 例外） |
| `capability-scope` | 100% profile × scope.kind 组合 |
| `tool-surface` | 7 个优先级 + 2 个 draft 子策略各 ≥ 1 测试 |
| `materialize-option` | 8 recipe × ≥ 3 case snapshot |
| Quota guards | 边界值全部 |
| Rate limit | 每组分组的边界测试 |
| `requireServerSession` | 7 场景全（valid / expired / missing / tampered / revoked / kid mismatch / csrf fail） |
| Migrations | 每 migrator fixture in/out + 幂等 + 无版本兼容 |

### 9.2 测试工具

- Vitest + `@vitest/coverage-v8`
- snapshot **按 recipe 分目录**：`src/renderers/echarts/browser/__tests__/__snapshots__/{recipe-id}/{case}.snap`
- 不使用 `toMatchInlineSnapshot`（会让测试文件巨大）

### 9.3 CI 集成

`package.json` 新增：

```json
"scripts": {
  "test:contract": "vitest run src/{domain,contracts,ai/authoring/runtime,ai/authoring/agent/tool-surface,renderers/echarts/browser/materialize-option,server/guards,server/auth,server/dashboards/migrations}",
  "test:contract:coverage": "vitest run --coverage --coverage.branches=95 --coverage.statements=90 --coverage.functions=95 ..."
}
```

CI 添加 step：`pnpm test:contract:coverage`，覆盖率不达标即 fail。

### 9.4 性能基准

在 `src/__benchmarks__/` 新建基准测试套件，CI 运行但不阻塞：

- 单 turn 完整 agent 循环（mock model） — P95 < 200ms
- `materializeEChartsOptionTemplate` 单次 — P95 < 5ms
- `execute-batch` 10 个简单 query（local PG） — P95 < 500ms
- `requireServerSession` 验证 — P95 < 3ms

历史结果保存到 `docs/benchmarks/`，回归 2× 自动开 issue。

### 9.5 验收

- [ ] `pnpm test:contract:coverage` 通过
- [ ] 所有架构 §9.2 不变量有对应测试
- [ ] CI 强制覆盖率门槛
- [ ] 性能基准基线建立并存档

---

## 10. 横向工作流（跨 Sprint）

以下工作不属于单一 Sprint，应在合适的 Sprint 中穿插完成。

### 10.1 DB schema migration runner（Sprint 0–1）

`src/server/db/migrations/runner.ts` 实现：

```typescript
async function applyDbMigrations() {
  const applied = await pool.query<{ seq: string }>(`SELECT seq FROM schema_migrations`);
  const appliedSet = new Set(applied.rows.map(r => r.seq));
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const seq = file.split("_")[0];
    if (appliedSet.has(seq)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(`INSERT INTO schema_migrations (seq, applied_at) VALUES ($1, now())`, [seq]);
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }
}
```

启动时调用，替换隐式 `ensureCloudAuthoringSchema`。

### 10.2 Config loader（Sprint 0）

详见 §3.3 与架构 §15.2。

### 10.3 LLM Provider 抽象（Sprint 1 或 Sprint 6）

- 定义 `LlmProvider` 接口（Sprint 0 已加 stub）
- 把 pi-agent 内部直连模型代码抽取到 `OpenAiProvider` / `AnthropicProvider`
- 实现 `MockProvider`，作为 contract + integration 测试的默认 provider
- `src/ai/getLlmProvider.ts` 根据 ENV 返回单例

可在 Sprint 1 完成（如 Auth 团队空闲）或推迟到 Sprint 6 后。

### 10.4 PR review 时间预留

每个 Sprint 时间不包括 PR review。每个 Sprint 实际投入额外加 20%。

### 10.5 长 feature branch 的 rebase 频率

Sprint 1 / 3 是较长的 branch，建议：

- **每 2 个工作日** rebase 一次 main
- 每周一次小范围 squash（避免巨大 PR）
- 每周一次跨 Sprint 同步会，对齐接口（特别是 i18n key、事件命名）

---

## 11. 清理与文档同步

每个 Sprint 完成后：

### 11.1 删除"过渡代码"

- 不允许保留"兼容旧版本"分支
- 不允许保留 `// TODO: remove after migration` 注释
- 删除即删除，靠 git history 回看

### 11.2 文档同步

- 任何架构变更同步更新 `docs/architecture.md` 对应章节
- 任何 ADR 决策变化追加 ADR-N，**不修改已有 ADR**（保留决策历史）
- 各层 `AGENTS.md` 与代码同步
- 附录 B（目标态新增清单）在每个 Sprint 完成对应项后从清单中删除

### 11.3 archive 历史

- 旧 trace 文件搬到 `logs/archive/legacy-{date}/`（Sprint 2 §5.8）
- 本文档 (`docs/migration.md`) 在 Sprint 6 完成后归档至 `docs/archive/migration-2026-q2.md`
- `docs/architecture.md` 顶部移除"从旧实现迁移：见 migration.md"链接
- `docs/architecture.md` 中所有 `(new)` 标记删除（已成为现状）
- `docs/architecture.md` 附录 B 删除或归档（清单已成现状）

---

## 12. 最终验收清单

迁移完成的 acceptance criteria，按"自动 / 手动"分类。

### 12.1 自动验收（CI 强制）

#### 代码扫描

- [ ] `grep -r "resolveServerRequestContext" src/` 无结果
- [ ] `grep -r "LocalAuthSession" src/` 无结果
- [ ] `grep -r "writeSessionTraceEvent" src/` 无结果
- [ ] ESLint `no-identity-in-request` 在所有 `src/app/api/**` 不触发
- [ ] 类型检查：`AuthoringToolRegistration.requiredPermissions` 在所有工具都存在
- [ ] 类型检查：`DashboardDocument.schema_version` 必填

#### 编译 / 类型

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm lint` 通过（含自定义规则 error 模式）

#### 测试

- [ ] `pnpm test`（全部）通过
- [ ] `pnpm test:contract:coverage` 达到目标覆盖率
- [ ] `pnpm test:e2e` 通过
- [ ] 性能基准未回归超过 2×（CI 信号，开 issue 不阻塞）

#### 配置

- [ ] `pnpm script:check-env` 验证所有 ENV 在 `config/load.ts` 中已声明
- [ ] `pnpm script:check-i18n` 验证 zh-CN + en-US 覆盖所有 `keys.ts` 中的 key

### 12.2 手动验收（验收人员执行）

#### 行为

- [ ] 未登录访问任意 API 返回 401
- [ ] 篡改 cookie 返回 401
- [ ] kid 不匹配返回 401
- [ ] 跨站 POST 返回 403
- [ ] 缺少权限的用户无法看到对应工具（Authoring UI 验证）
- [ ] 触发任意 quota 返回 `QUOTA_*` + 409 + 友好弹窗
- [ ] 触发 rate limit 返回 429 + Retry-After
- [ ] 单 view 渲染失败不影响其他 view
- [ ] 单 query 失败不影响其他 query
- [ ] 旧 schema 文档（无 `schema_version`）自动 migrate 后加载成功
- [ ] 模型超时 60s 后前端展示重试按钮，session 状态保留
- [ ] Approval Card 11min 后倒计时归零并展示"已超时"

#### 文档

- [ ] `docs/architecture.md` 与代码 100% 一致（无 `(new)` 标记）
- [ ] 各层 `AGENTS.md` 已更新
- [ ] 本文档 (`docs/migration.md`) 已归档至 `docs/archive/`
- [ ] `docs/operations.md` 已记录 ENV 变更与归档操作

---

## 13. 风险与回滚

### 13.1 Sprint 级风险

| Sprint | 风险 | 缓解 |
|--------|------|------|
| 1 | Auth 切换后老用户被强制重新登录 | 提前 1 周通知；登录页提供清晰指引；保留回跳 deep link |
| 1 | 路由改造遗漏导致部分 API 仍不安全 | ESLint 规则 + grep 验证双重把关 |
| 2 | 事件命名变更后旧 trace 不可读 | 归档老 trace 到 `logs/archive/`；trace viewer 加"legacy 模式"链接（只读，可选实现） |
| 4 | Quota 默认值过严导致已有大 dashboard 加载失败 | Sprint -1 audit 已盘点，按需调整默认 |
| 5 | Schema migration 失败导致 dashboard 不可加载 | 加载失败返回 502 而非吞错；管理 UI 提示"导出原始 JSON" |
| 6 | 95% 覆盖率门槛阻塞日常开发 | 仅 contract test 模块强制；新增普通模块不在范围内 |

### 13.2 验收失败决策树

任一 Sprint 验收失败：

```
是否阻塞用户使用？
├─ 是 → revert 该 Sprint 全部 commits，回到上一稳定状态；重新规划
└─ 否 → 在 hotfix branch 修复，不阻塞下一 Sprint 启动
```

任一最终验收（§12）失败：

```
是否安全相关（Auth / CSRF / Quota）？
├─ 是 → 阻塞上线，回到对应 Sprint 重新走流程
└─ 否 → 评估是否可作为 known issue 上线，开 P1 工单跟踪
```

### 13.3 部署回滚

- DB migration **不支持 down migration**，回滚靠：
  - 新写一个 reverse migration
  - 或恢复 DB backup（`pg_dump` 每日，30 天保留）
- 应用回滚：保留旧版本 release artifact 至少 1 个月，可即时回滚二进制
- Schema 1.0 → 2.0 等 MAJOR 升级前，必须在 release notes 明确"回滚需先恢复 DB"

### 13.4 Long branch 管理

- Sprint 1 / 3 是 ≥ 2 周的长 branch，每 2 天 rebase 一次 main
- 子任务可拆为内部 PR，但不合入 main 直到整个 Sprint 完成
- 每周跨 Sprint 同步会，对齐共享接口（i18n key / 事件命名 / config schema）

---

## 14. 时间预估

| Sprint | 周期 | 主要交付 | 含 PR review |
|--------|------|---------|------------|
| -1 | 0.5–1 周 | 现状 audit 报告 | +0.2 周 |
| 0 | 1 周 | 脚手架、ENV、空实现、lint warn | +0.2 周 |
| 1 | 3–4 周 | Auth 完全统一 + CSRF + 权限工具过滤 + 前端 cookie 化 | +0.6 周 |
| 2 | 1–2 周 | ObservabilityBus + 事件迁移 + 旧 trace 归档 | +0.3 周 |
| 3 | 2 周 | 失败矩阵实现 + i18n 全覆盖 | +0.4 周 |
| 4 | 1–2 周 | Quota guards + Rate limit + 管理 UI 用量 | +0.3 周 |
| 5 | 1 周 | Schema versioning + migrator framework + fixture | +0.2 周 |
| 6 | 1 周 | Contract 测试加固 + 性能基准 | +0.2 周 |
| **合计** | **10–12 周** | （单人 + review）| |
| **并行（2 人）** | **6–7 周** | Sprint 2/5/6 + LLM Provider 并行 | |
| **并行（3 人）** | **5–6 周** | 进一步切前后端 | |

---

*迁移完成后，本文档归档至 `docs/archive/migration-2026-q2.md`；`docs/architecture.md` 移除迁移链接，删除所有 `(new)` 标记，附录 B 删除或归档。*
