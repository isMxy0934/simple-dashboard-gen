# Migration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Sprint -2, Sprint -1, and Sprint 0 migration foundation so later auth, datasource, quota, schema, and observability migrations start from audited facts and stable contracts.

**Architecture:** This plan is intentionally behavior-preserving. It adds audit outputs, decision records, scripts, CI skeletons, typed stubs, and validation guardrails while leaving existing API behavior unchanged. Sprint 1 security changes are out of scope and must get their own plan after this foundation passes.

**Tech Stack:** Next.js 15, React 19, TypeScript 5.7, Node 22 `node:test`, npm, Zod, PostgreSQL via `pg`, optional ESLint flat config, Playwright for future E2E.

---

## Scope Check

This plan covers only:

- Sprint -2 baseline alignment from `docs/migration.md`.
- Sprint -1 audit artifacts folded into the same foundation window.
- Sprint 0 scaffolding and contracts that do not change runtime behavior.

This plan does not implement Sprint 1 auth enforcement, CSRF enforcement, datasource workspace filtering, or execute-batch identity replacement. Those are safety-critical behavior changes and need a separate implementation plan after this foundation lands.

## File Structure

- `docs/decisions/`: records fixed project decisions before code changes depend on them.
- `docs/audit/`: generated or manually completed baseline audit artifacts used by later Sprints.
- `scripts/`: local Node scripts for deterministic audits and static checks.
- `.github/workflows/ci.yml`: CI skeleton that runs commands created in this plan.
- `src/server/config/`: config schema, LLM provider auth allowlist, and config ownership rules.
- `src/server/auth/`: auth API contracts and stubs only; no route enforcement in this plan.
- `src/server/guards/`: quota and rate-limit contracts and stubs only.
- `src/server/logs/`: observability bus contracts and no-op-safe sink stubs.
- `src/server/dashboards/migrations/`: dashboard document migration contracts and v0.3 fixture location.
- `src/server/db/`: DB migration runner contract and Phase A AGENTS rules.
- `src/contracts/schema-version.ts`: explicit document/spec schema version types.
- `src/ai/providers/`: LLM provider interface and mock implementation alongside existing `PiModelRuntime`.
- `src/web/api/` and `src/web/dashboard/render/`: frontend stubs needed by later Sprints.
- `eslint-rules/`: custom route identity lint rule.
- `tests/`: node:test regression and contract tests for the foundation.

## Execution Rules

- Keep commits small: one task equals one commit.
- Use TDD for code tasks: write failing tests first, run the targeted command, implement, rerun.
- For docs/audit tasks, verify by checking files exist and contain expected headings.
- Do not alter existing route behavior in this plan.
- Do not remove `resolveServerRequestContext`, `LocalAuthSession`, or body `workspace_id` handling in this plan.

---

### Task 1: Create Foundation Directories And Decision Records

**Files:**
- Create: `docs/audit/.gitkeep`
- Create: `docs/decisions/0001-test-tooling.md`
- Create: `docs/decisions/0002-lint-tooling.md`
- Create: `docs/superpowers/plans/2026-05-22-migration-foundation-plan.md`

- [ ] **Step 1: Create directories**

Run:

```bash
mkdir -p docs/audit docs/decisions docs/archive docs/superpowers/plans
```

Expected: command exits 0.

- [ ] **Step 2: Add `docs/audit/.gitkeep`**

Create `docs/audit/.gitkeep` with empty content.

- [ ] **Step 3: Add test tooling decision**

Create `docs/decisions/0001-test-tooling.md`:

```markdown
# Decision 0001: Test Tooling

Date: 2026-05-22

## Decision

Keep `npm` as the package manager and keep Node's built-in `node:test` runner for unit and contract tests during Sprint -2 and Sprint 0.

Add Playwright as the E2E runner before Sprint 6 hardening, with the initial `test:e2e` command introduced in Sprint 0 so CI shape is visible early.

## Rationale

The repository already uses npm and `node --test --experimental-strip-types tests/*.test.ts`. Preserving this path avoids a test-runner migration before security work begins.

Node's built-in runner is sufficient for the foundation contracts in Sprint 0. Playwright is still required for browser-level auth, CSRF, and dashboard user flows, but those tests can be introduced as real E2E coverage after the foundation is stable.

## Commands

- `npm test`
- `npm run test:contract`
- `npm run test:e2e`
```

- [ ] **Step 4: Add lint tooling decision**

Create `docs/decisions/0002-lint-tooling.md`:

```markdown
# Decision 0002: Lint Tooling

Date: 2026-05-22

## Decision

Use ESLint flat config with `eslint`, `@eslint/js`, and `typescript-eslint`.

Add a project-local custom rule in `eslint-rules/no-identity-in-request.js` to detect API route handlers reading identity fields from request body or query string.

Sprint 0 runs the rule in `warn` mode. Sprint 1 switches it to `error` after the auth migration removes legacy identity reads.

## Rationale

The migration relies on mechanical enforcement that route identity comes only from `requireServerSession`. TypeScript alone cannot enforce this route-handler policy.

Using ESLint keeps the policy close to the code and lets Sprint 0 introduce the guardrail without blocking current behavior.

## Commands

- `npm run lint`
```

- [ ] **Step 5: Verify files**

Run:

```bash
test -d docs/audit && test -d docs/decisions && test -f docs/decisions/0001-test-tooling.md && test -f docs/decisions/0002-lint-tooling.md
```

Expected: command exits 0.

- [ ] **Step 6: Commit**

```bash
git add docs/audit/.gitkeep docs/decisions/0001-test-tooling.md docs/decisions/0002-lint-tooling.md
git commit -m "docs: record migration foundation decisions"
```

---

### Task 2: Add Baseline Audit Scripts

**Files:**
- Create: `scripts/audit-route-inventory.mjs`
- Create: `scripts/audit-env-inventory.mjs`
- Create: `scripts/audit-event-inventory.mjs`
- Modify: `package.json`
- Output: `docs/audit/route-inventory.md`
- Output: `docs/audit/env-inventory.md`
- Output: `docs/audit/event-inventory.md`

- [ ] **Step 1: Create route inventory script**

Create `scripts/audit-route-inventory.mjs`:

Identity inference is per exported handler. The script indexes same-file function declarations and recursively includes helper function bodies only when the current handler analysis source calls them. This avoids whole-file false positives while still catching helper-based identity handling.

```javascript
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const apiDir = path.join(rootDir, "src/app/api");
const outputPath = path.join(rootDir, "docs/audit/route-inventory.md");
const methodPattern = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
const functionPattern = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile() && entry.name === "route.ts") {
      files.push(fullPath);
    }
  }
  return files;
}

function routeFromFile(filePath) {
  const relative = path.relative(apiDir, path.dirname(filePath));
  return `/api/${relative.split(path.sep).join("/")}`;
}

function inferIdentitySource(source) {
  const sources = [];
  if (/resolveServerRequestContext/.test(source)) sources.push("resolveServerRequestContext");
  if (/searchParams\.get\(["']workspaceId["']\)/.test(source)) sources.push("searchParams.workspaceId");
  if (/searchParams\.get\(["']userId["']\)/.test(source)) sources.push("searchParams.userId");
  if (
    /request\.json|req\.json/.test(source) &&
    /\.workspaceId\b|\.workspace_id\b|["']workspaceId["']\s+in\b|["']workspace_id["']\s+in\b/.test(source)
  ) {
    sources.push("body workspace");
  }
  if (
    /request\.json|req\.json/.test(source) &&
    /\.userId\b|\.user_id\b|["']userId["']\s+in\b|["']user_id["']\s+in\b/.test(source)
  ) {
    sources.push("body user");
  }
  return sources.length > 0 ? sources.join(" + ") : "none detected";
}

function inferTargetPermission(route, method) {
  if (route.includes("/datasources") && method === "GET") return "datasource.read";
  if (route.includes("/datasources")) return "datasource.manage";
  if (route.includes("/query/execute-batch")) return "dashboard.read or dashboard.edit";
  if (route.includes("/authoring")) return method === "GET" ? "dashboard.read" : "dashboard.edit";
  if (route.includes("/dashboard") || route.includes("/dashboards")) return method === "GET" ? "dashboard.read" : "dashboard.edit";
  if (route.includes("/workspace")) return "workspace.read";
  if (route.includes("/preview")) return "dashboard.read";
  return "dashboard.read";
}

function extractFunctionSource(source, matchIndex) {
  const paramsStart = source.indexOf("(", matchIndex);
  if (paramsStart === -1) return null;

  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (parenDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  if (paramsEnd === -1) return null;

  const bodyStart = source.indexOf("{", paramsEnd);
  if (bodyStart === -1) return null;

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(matchIndex, index + 1);
  }
  return null;
}

function indexFunctionDeclarations(source) {
  const functions = new Map();
  for (const match of source.matchAll(functionPattern)) {
    const body = extractFunctionSource(source, match.index);
    if (body) {
      functions.set(match[1], body);
    }
  }
  return functions;
}

function buildAnalysisSource(functions, functionName, fallbackSource = "") {
  const included = new Set();
  const chunks = [];

  function includeCalledFunctions(source) {
    let found = true;
    while (found) {
      found = false;
      for (const [name, body] of functions) {
        if (included.has(name)) continue;
        const callPattern = new RegExp(`\\b${name}\\s*\\(`);
        if (!callPattern.test(source)) continue;

        included.add(name);
        chunks.push(body);
        source += `\n${body}`;
        found = true;
      }
    }
    return source;
  }

  const handlerSource = functions.get(functionName) ?? fallbackSource;
  if (handlerSource) {
    included.add(functionName);
    chunks.push(handlerSource);
  }
  return includeCalledFunctions(chunks.join("\n"));
}

await mkdir(path.dirname(outputPath), { recursive: true });

const rows = [];
for (const filePath of (await walk(apiDir)).sort()) {
  const source = await readFile(filePath, "utf8");
  const functions = indexFunctionDeclarations(source);
  const matches = [...source.matchAll(methodPattern)];
  for (const match of matches.length > 0 ? matches : [{ 1: "UNKNOWN", index: -1 }]) {
    const method = match[1];
    const route = routeFromFile(filePath);
    const handlerSource =
      method === "UNKNOWN" ? source : buildAnalysisSource(functions, method);
    rows.push({
      route,
      method,
      identity: inferIdentitySource(handlerSource),
      permission: inferTargetPermission(route, method),
    });
  }
}

const lines = [
  "# API Route Inventory",
  "",
  "| Route | HTTP method | Current identity source | Target permission | Sprint 1 migration status |",
  "|---|---:|---|---|---|",
  ...rows.map((row) => `| \`${row.route}\` | ${row.method} | ${row.identity} | ${row.permission} | [ ] |`),
  "",
];

await writeFile(outputPath, lines.join("\n"));
console.log(`Wrote ${rows.length} route rows to ${path.relative(rootDir, outputPath)}`);
```

- [ ] **Step 2: Create env inventory script**

Create `scripts/audit-env-inventory.mjs`:

The script detects direct `process.env.KEY` reads and relevant `env.KEY` member reads for all-caps keys, then sorts deduped file lists for deterministic output.

```javascript
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const outputPath = path.join(rootDir, "docs/audit/env-inventory.md");
const sourceRoots = ["src", "tests"];
const envPattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
const envObjectPattern = /\benv\.([A-Z][A-Z0-9_]*)/g;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function targetKey(key) {
  if (key === "DATABASE_URL") return "SDS_DATABASE_URL";
  if (key === "DATASOURCE_ENCRYPTION_KEY") return "SDS_DATASOURCE_ENCRYPTION_KEY";
  if (key === "AUTHORING_AGENT_WALL_CLOCK_MS") return "SDS_AUTHORING_AGENT_WALL_CLOCK_MS";
  if (key === "PI_PROVIDER" || key === "PI_MODEL" || key === "PI_THINKING_LEVEL") return `${key} optional fallback for SDS_LLM_*`;
  if (key.endsWith("_API_KEY")) return "provider-auth-env-allowlist.ts passthrough";
  if (key.startsWith("SDS_")) return key;
  return "review required";
}

function recordUsage(usage, key, filePath) {
  const list = usage.get(key) ?? [];
  list.push(path.relative(rootDir, filePath));
  usage.set(key, list);
}

const usage = new Map();
for (const root of sourceRoots) {
  const rootPath = path.join(rootDir, root);
  for (const filePath of await walk(rootPath)) {
    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(envPattern)) {
      recordUsage(usage, match[1], filePath);
    }
    for (const match of source.matchAll(envObjectPattern)) {
      recordUsage(usage, match[1], filePath);
    }
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
const lines = [
  "# Environment Variable Inventory",
  "",
  "| Current key | Target handling | Files |",
  "|---|---|---|",
  ...[...usage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, files]) => `| \`${key}\` | ${targetKey(key)} | ${[...new Set(files)].sort().map((file) => `\`${file}\``).join("<br>")} |`),
  "",
];

await writeFile(outputPath, lines.join("\n"));
console.log(`Wrote ${usage.size} env keys to ${path.relative(rootDir, outputPath)}`);
```

- [ ] **Step 3: Create event inventory script**

Create `scripts/audit-event-inventory.mjs`:

The committed baseline is deterministic: by default this script does not read ignored local `logs/sessions`.
To audit local trace logs, run with `AUDIT_EVENT_LOCAL_LOGS=1` or pass `--local-logs`.
The missing logs directory is still tolerated, and event rows sort by count descending, then event name ascending.

```javascript
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const logsDir = path.join(rootDir, "logs/sessions");
const outputPath = path.join(rootDir, "docs/audit/event-inventory.md");
const readLocalLogs =
  process.env.AUDIT_EVENT_LOCAL_LOGS === "1" ||
  process.argv.includes("--local-logs");

async function walkJsonl(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walkJsonl(fullPath));
      } else if (entry.isFile() && entry.name === "trace.jsonl") {
        files.push(fullPath);
      }
    }
    return files;
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

const counts = new Map();
for (const filePath of readLocalLogs ? await walkJsonl(logsDir) : []) {
  const content = await readFile(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      const name = [event.scope, event.event].filter(Boolean).join(".");
      counts.set(name || "unknown", (counts.get(name || "unknown") ?? 0) + 1);
    } catch {
      counts.set("invalid-json", (counts.get("invalid-json") ?? 0) + 1);
    }
  }
}

await mkdir(path.dirname(outputPath), { recursive: true });
const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const lines =
  rows.length === 0
    ? [
        "# Event Inventory",
        "",
        "_No committed event fixture found. Ignored local logs are skipped by default; run with AUDIT_EVENT_LOCAL_LOGS=1 or --local-logs to audit local traces._",
        "",
      ]
    : [
        "# Event Inventory",
        "",
        "| Event | Count |",
        "|---|---:|",
        ...rows.map(([event, count]) => `| \`${event}\` | ${count} |`),
        "",
      ];

await writeFile(outputPath, lines.join("\n"));
console.log(`Wrote ${rows.length} event rows to ${path.relative(rootDir, outputPath)}`);
```

- [ ] **Step 4: Add audit scripts to `package.json`**

Modify `package.json` scripts to include:

```json
{
  "audit:routes": "node scripts/audit-route-inventory.mjs",
  "audit:env": "node scripts/audit-env-inventory.mjs",
  "audit:events": "node scripts/audit-event-inventory.mjs",
  "audit:baseline": "npm run audit:routes && npm run audit:env && npm run audit:events"
}
```

- [ ] **Step 5: Run audits**

Run:

```bash
npm run audit:baseline
```

Expected:

```text
Wrote ... route rows to docs/audit/route-inventory.md
Wrote ... env keys to docs/audit/env-inventory.md
Wrote ... event rows to docs/audit/event-inventory.md
```

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/audit-route-inventory.mjs scripts/audit-env-inventory.mjs scripts/audit-event-inventory.mjs docs/audit/route-inventory.md docs/audit/env-inventory.md docs/audit/event-inventory.md
git commit -m "chore: add migration baseline audit scripts"
```

---

### Task 3: Add Test And CI Command Skeletons

**Files:**
- Create: `tests/foundation.contract.test.ts`
- Create: `playwright.config.ts`
- Create: `e2e/foundation.spec.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`

- [ ] **Step 1: Add contract smoke test**

Create `tests/foundation.contract.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

test("migration foundation contract runner is wired", () => {
  assert.equal(typeof process.version, "string");
  assert.match(process.version, /^v\d+\./);
});
```

- [ ] **Step 2: Add Playwright config**

Create `playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 3: Add E2E smoke test**

Create `e2e/foundation.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("application serves the login route", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("body")).toBeVisible();
});
```

- [ ] **Step 4: Install Playwright test dependency**

Run:

```bash
npm install -D @playwright/test
```

Expected: `package.json` and `package-lock.json` include `@playwright/test`.

- [ ] **Step 5: Add scripts**

Modify `package.json` scripts to include:

```json
{
  "test:contract": "node --test --experimental-strip-types tests/*.contract.test.ts",
  "test:e2e": "playwright test"
}
```

- [ ] **Step 6: Add CI skeleton**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main
      - "codex/**"

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:contract
      - run: npm run lint --if-present
      - run: npm run script:check-env --if-present
```

- [ ] **Step 7: Verify local non-browser checks**

Run:

```bash
npm run typecheck
npm test
npm run test:contract
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tests/foundation.contract.test.ts playwright.config.ts e2e/foundation.spec.ts .github/workflows/ci.yml
git commit -m "chore: add foundation test and ci commands"
```

---

### Task 4: Add Config Loader And ENV Static Check

**Files:**
- Create: `.env.example`
- Create: `src/server/config/load.ts`
- Create: `src/server/config/provider-auth-env-allowlist.ts`
- Create: `src/server/config/AGENTS.md`
- Create: `scripts/check-env.mjs`
- Create: `tests/config-load.test.ts`
- Create: `tests/check-env-script.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write config loader test**

Create `tests/config-load.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { loadConfig, resolveLlmConfig } = await import("../src/server/config/load.ts");

test("loadConfig parses required SDS env and optional PI fallback keys", () => {
  const config = loadConfig({
    SDS_SESSION_SECRETS: '{"current":{"kid":"k1","secret":"abcdefghijklmnopqrstuvwxyz123456"},"previous":[]}',
    SDS_SESSION_TTL_DAYS: "7",
    SDS_SESSION_REFRESH_GRACE_HOURS: "24",
    SDS_ALLOWED_ORIGINS: "http://localhost:3000,https://example.com",
    SDS_DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
    SDS_QUOTA_VIEWS_PER_DASHBOARD: "50",
    SDS_QUOTA_QUERIES_PER_DASHBOARD: "100",
    SDS_QUOTA_DOCUMENT_SIZE_MB: "2",
    SDS_QUOTA_QUERY_ROWS: "10000",
    SDS_QUOTA_QUERY_BYTES: "5242880",
    SDS_QUOTA_BATCH_SIZE: "20",
    SDS_QUOTA_MODEL_INPUT_TOKENS: "32000",
    SDS_QUOTA_MODEL_OUTPUT_TOKENS: "8000",
    SDS_QUOTA_TRACE_FILE_MB: "50",
    SDS_QUOTA_SESSIONS_PER_WORKSPACE: "50",
    SDS_QUOTA_DASHBOARDS_PER_WORKSPACE: "200",
    SDS_QUOTA_STORAGE_GB: "10",
    SDS_OBSERVABILITY_SINKS: "jsonl,ai-trace",
    SDS_LLM_PROVIDER: "deepseek",
    SDS_LLM_MODEL: "deepseek-chat",
    SDS_LLM_THINKING_LEVEL: "medium",
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
  });

  assert.equal(config.SDS_DATABASE_URL, "postgresql://user:pass@localhost:5432/app");
  assert.deepEqual(config.SDS_ALLOWED_ORIGINS, ["http://localhost:3000", "https://example.com"]);
  assert.equal(config.SDS_QUOTA_BATCH_SIZE, 20);
  assert.equal(config.PI_PROVIDER, "openai");
});

test("resolveLlmConfig prefers SDS_LLM keys over PI fallback", () => {
  const resolved = resolveLlmConfig({
    SDS_LLM_PROVIDER: "deepseek",
    SDS_LLM_MODEL: "deepseek-chat",
    SDS_LLM_THINKING_LEVEL: "high",
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
  });

  assert.deepEqual(resolved, {
    provider: "deepseek",
    model: "deepseek-chat",
    thinkingLevel: "high",
  });
});

test("resolveLlmConfig falls back to PI keys", () => {
  const resolved = resolveLlmConfig({
    PI_PROVIDER: "openai",
    PI_MODEL: "gpt-4.1-mini",
    PI_THINKING_LEVEL: "low",
  });

  assert.deepEqual(resolved, {
    provider: "openai",
    model: "gpt-4.1-mini",
    thinkingLevel: "low",
  });
});
```

- [ ] **Step 2: Write check-env script test**

Create `tests/check-env-script.test.ts`:

```typescript
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("script:check-env passes for the checked-in config and env example", () => {
  const result = spawnSync(process.execPath, ["scripts/check-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ENV check passed/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/config-load.test.ts tests/check-env-script.test.ts
```

Expected: FAIL because `src/server/config/load.ts` and `scripts/check-env.mjs` do not exist.

- [ ] **Step 4: Add provider auth allowlist**

Create `src/server/config/provider-auth-env-allowlist.ts`:

```typescript
export const PROVIDER_AUTH_ENV_ALLOWLIST = [
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export type ProviderAuthEnvKey = (typeof PROVIDER_AUTH_ENV_ALLOWLIST)[number];
```

- [ ] **Step 5: Add config loader**

Create `src/server/config/load.ts`:

```typescript
import "server-only";

import { z } from "zod";

const sessionSecretsSchema = z.object({
  current: z.object({
    kid: z.string().min(1),
    secret: z.string().min(32),
  }),
  previous: z.array(z.object({
    kid: z.string().min(1),
    secret: z.string().min(32),
  })).default([]),
});

const thinkingLevelSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

function jsonObject<T>(schema: z.ZodType<T>) {
  return z.string().transform((value, context) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      context.addIssue({ code: "custom", message: "Invalid JSON" });
      return z.NEVER;
    }
  }).pipe(schema);
}

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export const configSchema = z.object({
  SDS_SESSION_SECRETS: jsonObject(sessionSecretsSchema),
  SDS_SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  SDS_SESSION_REFRESH_GRACE_HOURS: z.coerce.number().int().positive().default(24),
  SDS_ALLOWED_ORIGINS: z.string().transform(csv),
  SDS_DATABASE_URL: z.string().min(1),

  SDS_LLM_PROVIDER: z.string().min(1).optional(),
  SDS_LLM_MODEL: z.string().min(1).optional(),
  SDS_LLM_THINKING_LEVEL: thinkingLevelSchema.optional(),
  PI_PROVIDER: z.string().min(1).optional(),
  PI_MODEL: z.string().min(1).optional(),
  PI_THINKING_LEVEL: thinkingLevelSchema.optional(),

  SDS_QUOTA_VIEWS_PER_DASHBOARD: z.coerce.number().int().positive().default(50),
  SDS_QUOTA_QUERIES_PER_DASHBOARD: z.coerce.number().int().positive().default(100),
  SDS_QUOTA_DOCUMENT_SIZE_MB: z.coerce.number().int().positive().default(2),
  SDS_QUOTA_QUERY_ROWS: z.coerce.number().int().positive().default(10_000),
  SDS_QUOTA_QUERY_BYTES: z.coerce.number().int().positive().default(5_242_880),
  SDS_QUOTA_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  SDS_QUOTA_MODEL_INPUT_TOKENS: z.coerce.number().int().positive().default(32_000),
  SDS_QUOTA_MODEL_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8_000),
  SDS_QUOTA_TRACE_FILE_MB: z.coerce.number().int().positive().default(50),
  SDS_QUOTA_SESSIONS_PER_WORKSPACE: z.coerce.number().int().positive().default(50),
  SDS_QUOTA_DASHBOARDS_PER_WORKSPACE: z.coerce.number().int().positive().default(200),
  SDS_QUOTA_STORAGE_GB: z.coerce.number().int().positive().default(10),

  SDS_OBSERVABILITY_SINKS: z.string().default("jsonl,ai-trace").transform(csv),
  SDS_SENTRY_DSN: z.string().optional(),
  SDS_OTEL_ENDPOINT: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

export interface LlmConfig {
  provider: string | undefined;
  model: string | undefined;
  thinkingLevel: z.infer<typeof thinkingLevelSchema> | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(env);
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    provider: env.SDS_LLM_PROVIDER || env.PI_PROVIDER,
    model: env.SDS_LLM_MODEL || env.PI_MODEL,
    thinkingLevel: (env.SDS_LLM_THINKING_LEVEL || env.PI_THINKING_LEVEL) as LlmConfig["thinkingLevel"],
  };
}
```

- [ ] **Step 6: Add config AGENTS rules**

Create `src/server/config/AGENTS.md`:

```markdown
# Server Config

`src/server/config/` owns application environment loading.

Rules:

- Declare application `SDS_*` keys in `load.ts`.
- Keep `PI_PROVIDER`, `PI_MODEL`, and `PI_THINKING_LEVEL` as optional fallback keys while the pi-ai runtime is still in use.
- Do not place provider auth keys such as `OPENAI_API_KEY` or `DEEPSEEK_API_KEY` in the Zod schema.
- Document provider auth passthrough keys in `provider-auth-env-allowlist.ts`.
- Do not fail startup because an unused provider auth key is missing.
```

- [ ] **Step 7: Add `.env.example`**

Create `.env.example`:

```dotenv
# Auth
SDS_SESSION_SECRETS='{"current":{"kid":"k1","secret":"REPLACE_ME_32B_REPLACE_ME_32B"},"previous":[]}'
SDS_SESSION_TTL_DAYS=7
SDS_SESSION_REFRESH_GRACE_HOURS=24
SDS_ALLOWED_ORIGINS=http://localhost:3000

# Database
SDS_DATABASE_URL=postgresql://user:password@localhost:5432/simple_dashboard_gen

# LLM route selection
SDS_LLM_PROVIDER=deepseek
SDS_LLM_MODEL=deepseek-chat
SDS_LLM_THINKING_LEVEL=medium
# PI_PROVIDER=deepseek
# PI_MODEL=deepseek-chat
# PI_THINKING_LEVEL=medium

# Provider auth passthrough. Full allowlist: src/server/config/provider-auth-env-allowlist.ts
DEEPSEEK_API_KEY=REPLACE_ME
# OPENAI_API_KEY=REPLACE_ME

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

- [ ] **Step 8: Add `scripts/check-env.mjs`**

Create `scripts/check-env.mjs`:

```javascript
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const configPath = path.join(rootDir, "src/server/config/load.ts");
const allowlistPath = path.join(rootDir, "src/server/config/provider-auth-env-allowlist.ts");
const envExamplePath = path.join(rootDir, ".env.example");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function collectSchemaKeys(source) {
  return unique([...source.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]));
}

function collectAllowlistKeys(source) {
  return unique([...source.matchAll(/"([A-Z][A-Z0-9_]*_API_KEY)"/g)].map((match) => match[1]));
}

function collectEnvExampleKeys(source) {
  return unique([...source.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]));
}

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) console.error(`- ${detail}`);
  process.exitCode = 1;
}

const configSource = await readFile(configPath, "utf8");
const allowlistSource = await readFile(allowlistPath, "utf8");
const envExampleSource = await readFile(envExamplePath, "utf8");

const schemaKeys = collectSchemaKeys(configSource);
const allowlistKeys = collectAllowlistKeys(allowlistSource);
const envExampleKeys = collectEnvExampleKeys(envExampleSource);

const sourceEnvKeys = [];
for (const filePath of await walk(srcDir)) {
  const source = await readFile(filePath, "utf8");
  for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
    sourceEnvKeys.push(match[1]);
  }
}

const sdsSourceKeys = unique(sourceEnvKeys.filter((key) => key.startsWith("SDS_")));
const missingSdsSchemaKeys = sdsSourceKeys.filter((key) => !schemaKeys.includes(key));
if (missingSdsSchemaKeys.length > 0) {
  fail("SDS_* process.env keys must be declared in src/server/config/load.ts.", missingSdsSchemaKeys);
}

const piFallbackKeys = ["PI_PROVIDER", "PI_MODEL", "PI_THINKING_LEVEL"];
const missingPiSchemaKeys = piFallbackKeys.filter((key) => !schemaKeys.includes(key));
if (missingPiSchemaKeys.length > 0) {
  fail("PI fallback keys must be optional fields in src/server/config/load.ts.", missingPiSchemaKeys);
}

const allowlistKeysInSchema = allowlistKeys.filter((key) => schemaKeys.includes(key));
if (allowlistKeysInSchema.length > 0) {
  fail("Provider auth allowlist keys must not be in the Zod schema.", allowlistKeysInSchema);
}

const missingSchemaEnvExampleKeys = schemaKeys.filter((key) => !envExampleKeys.includes(key));
if (missingSchemaEnvExampleKeys.length > 0) {
  fail(".env.example must document every config schema key.", missingSchemaEnvExampleKeys);
}

const providerMatch = envExampleSource.match(/^SDS_LLM_PROVIDER=(\S+)/m);
const provider = providerMatch?.[1];
const currentProviderKey = provider ? `${provider.toUpperCase()}_API_KEY` : undefined;
if (!currentProviderKey || !envExampleKeys.includes(currentProviderKey)) {
  fail(".env.example must include the current example provider auth key.", [currentProviderKey ?? "missing SDS_LLM_PROVIDER"]);
}

if (!envExampleSource.includes("src/server/config/provider-auth-env-allowlist.ts")) {
  fail(".env.example must point readers to provider-auth-env-allowlist.ts.");
}

if (process.exitCode) process.exit(process.exitCode);
console.log("ENV check passed.");
```

- [ ] **Step 9: Add package script**

Modify `package.json` scripts to include:

```json
{
  "script:check-env": "node scripts/check-env.mjs"
}
```

- [ ] **Step 10: Run targeted tests**

Run:

```bash
node --test --experimental-strip-types tests/config-load.test.ts tests/check-env-script.test.ts
npm run script:check-env
```

Expected: all commands exit 0 and `npm run script:check-env` prints `ENV check passed.`

- [ ] **Step 11: Commit**

```bash
git add .env.example package.json src/server/config tests/config-load.test.ts tests/check-env-script.test.ts scripts/check-env.mjs
git commit -m "feat: add config loader and env validation"
```

---

### Task 5: Add Schema Version And API Error Contracts

**Files:**
- Create: `src/contracts/schema-version.ts`
- Create: `src/server/api-error.ts`
- Create: `tests/schema-version.test.ts`
- Create: `tests/api-error.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/schema-version.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const schemaVersion = await import("../src/contracts/schema-version.ts");

test("schema version contracts keep document and legacy spec versions separate", () => {
  assert.equal(schemaVersion.CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION, "1.0");
  assert.equal(schemaVersion.LEGACY_DASHBOARD_SPEC_SCHEMA_VERSION, "0.3");
});
```

Create `tests/api-error.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { ApiError } = await import("../src/server/api-error.ts");

test("ApiError carries status, code, i18n key, and payload", () => {
  const error = new ApiError(403, "FORBIDDEN", "error.auth.forbidden", { permission: "dashboard.edit" });

  assert.equal(error.status, 403);
  assert.equal(error.code, "FORBIDDEN");
  assert.equal(error.i18nKey, "error.auth.forbidden");
  assert.deepEqual(error.payload, { permission: "dashboard.edit" });
  assert.equal(error.name, "ApiError");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/schema-version.test.ts tests/api-error.test.ts
```

Expected: FAIL because the source files do not exist.

- [ ] **Step 3: Add schema version contract**

Create `src/contracts/schema-version.ts`:

```typescript
export type DashboardDocumentSchemaVersion = "1.0";
export type LegacyDashboardSpecSchemaVersion = "0.3";

export const CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION: DashboardDocumentSchemaVersion = "1.0";
export const LEGACY_DASHBOARD_SPEC_SCHEMA_VERSION: LegacyDashboardSpecSchemaVersion = "0.3";
```

- [ ] **Step 4: Add API error class**

Create `src/server/api-error.ts`:

```typescript
export type ApiErrorPayload = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly i18nKey: string;
  readonly payload: ApiErrorPayload | undefined;

  constructor(status: number, code: string, i18nKey: string, payload?: ApiErrorPayload) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.i18nKey = i18nKey;
    this.payload = payload;
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test --experimental-strip-types tests/schema-version.test.ts tests/api-error.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/contracts/schema-version.ts src/server/api-error.ts tests/schema-version.test.ts tests/api-error.test.ts
git commit -m "feat: add schema version and api error contracts"
```

---

### Task 6: Add Auth And Guard Stubs

**Files:**
- Create: `src/server/auth/require-session.ts`
- Create: `src/server/auth/jwt.ts`
- Create: `src/server/auth/permissions.ts`
- Create: `src/server/auth/workspace-policy.ts`
- Create: `src/server/auth/csrf.ts`
- Create: `src/server/auth/AGENTS.md`
- Create: `src/server/guards/quotas.ts`
- Create: `src/server/guards/rate-limit.ts`
- Create: `src/server/guards/AGENTS.md`
- Create: `tests/auth-guard-skeleton.test.ts`

- [ ] **Step 1: Write failing skeleton tests**

Create `tests/auth-guard-skeleton.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const requireSession = await import("../src/server/auth/require-session.ts");
const jwt = await import("../src/server/auth/jwt.ts");
const permissions = await import("../src/server/auth/permissions.ts");
const csrf = await import("../src/server/auth/csrf.ts");
const quotas = await import("../src/server/guards/quotas.ts");
const rateLimit = await import("../src/server/guards/rate-limit.ts");

test("auth stubs expose the Sprint 1 contract surface", async () => {
  assert.equal(typeof requireSession.requireServerSession, "function");
  assert.equal(typeof jwt.signSessionToken, "function");
  assert.equal(typeof jwt.verifySessionToken, "function");
  assert.equal(typeof csrf.assertCsrf, "function");
  assert.equal(permissions.Permission.DashboardRead, "dashboard.read");
  assert.equal(permissions.Permission.DatasourceManage, "datasource.manage");
  await assert.rejects(
    () => requireSession.requireServerSession(new Request("http://localhost/api")),
    /NOT_IMPLEMENTED/,
  );
});

test("guard stubs expose quota and rate limit contracts", async () => {
  assert.equal(quotas.QUOTAS.viewsPerDashboard, 50);
  await assert.rejects(() => quotas.assertQuota("viewsPerDashboard", 51), /NOT_IMPLEMENTED/);
  await assert.rejects(() => rateLimit.assertRateLimit("auth.login", "user:1"), /NOT_IMPLEMENTED/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/auth-guard-skeleton.test.ts
```

Expected: FAIL because auth and guard files do not exist.

- [ ] **Step 3: Add auth contracts**

Create `src/server/auth/require-session.ts`:

```typescript
import "server-only";

import type { Permission } from "./permissions";

export interface UserSession {
  userId: string;
  workspaceId: string;
  permissions: Set<Permission>;
  sessionId: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
}

export async function requireServerSession(_req: Request, _opts?: { skipCsrf?: boolean }): Promise<UserSession> {
  throw new Error("NOT_IMPLEMENTED: requireServerSession");
}
```

Create `src/server/auth/jwt.ts`:

```typescript
import "server-only";

import type { Permission } from "./permissions";

export interface SessionClaims {
  userId: string;
  workspaceId: string;
  permissions: Permission[];
  jti: string;
  iat: number;
  exp: number;
}

export async function signSessionToken(_claims: Omit<SessionClaims, "jti" | "iat" | "exp">): Promise<string> {
  throw new Error("NOT_IMPLEMENTED: signSessionToken");
}

export async function verifySessionToken(_token: string): Promise<SessionClaims> {
  throw new Error("NOT_IMPLEMENTED: verifySessionToken");
}
```

Create `src/server/auth/permissions.ts`:

```typescript
import "server-only";

import { ApiError } from "@/server/api-error";

export enum Permission {
  DashboardRead = "dashboard.read",
  DashboardEdit = "dashboard.edit",
  DatasourceRead = "datasource.read",
  DatasourceManage = "datasource.manage",
  WorkspaceManage = "workspace.manage",
}

export function requirePermission(permissions: ReadonlySet<Permission>, permission: Permission): void {
  if (!permissions.has(permission)) {
    throw new ApiError(403, "PERMISSION_DENIED", "error.auth.permission_denied", { permission });
  }
}
```

Create `src/server/auth/workspace-policy.ts`:

```typescript
import "server-only";

import { Permission } from "./permissions";
import type { UserSession } from "./require-session";

export interface WorkspacePolicy {
  userId: string;
  workspaceId: string;
  permissions: ReadonlySet<Permission>;
}

export const WorkspacePolicy = {
  derive(session: UserSession): WorkspacePolicy {
    return {
      userId: session.userId,
      workspaceId: session.workspaceId,
      permissions: session.permissions,
    };
  },
};
```

Create `src/server/auth/csrf.ts`:

```typescript
import "server-only";

export function assertCsrf(_req: Request): void {
  throw new Error("NOT_IMPLEMENTED: assertCsrf");
}
```

- [ ] **Step 4: Add guard contracts**

Create `src/server/guards/quotas.ts`:

```typescript
import "server-only";

export const QUOTAS = {
  viewsPerDashboard: 50,
  queriesPerDashboard: 100,
  documentSizeMb: 2,
  queryRows: 10_000,
  queryBytes: 5_242_880,
  batchSize: 20,
  modelInputTokens: 32_000,
  modelOutputTokens: 8_000,
  traceFileMb: 50,
  sessionsPerWorkspace: 50,
  dashboardsPerWorkspace: 200,
  storageGb: 10,
} as const;

export type QuotaKey = keyof typeof QUOTAS;

export async function assertQuota(_key: QuotaKey, _value: number): Promise<void> {
  throw new Error("NOT_IMPLEMENTED: assertQuota");
}
```

Create `src/server/guards/rate-limit.ts`:

```typescript
import "server-only";

export async function assertRateLimit(_scope: string, _key: string): Promise<void> {
  throw new Error("NOT_IMPLEMENTED: assertRateLimit");
}
```

- [ ] **Step 5: Add AGENTS files**

Create `src/server/auth/AGENTS.md`:

```markdown
# Auth Layer

Rules:

- `requireServerSession` is the only server-side identity entrypoint.
- Tokens must not be logged in payloads.
- Mutating routes must pass CSRF checks unless explicitly marked safe.
- Keep route handlers thin; auth implementation belongs in `src/server/auth/`.
```

Create `src/server/guards/AGENTS.md`:

```markdown
# Guard Layer

Rules:

- Quota and rate-limit checks live in this directory.
- Guards throw `ApiError` with stable machine codes when enforcement is implemented.
- Guard modules must not import from `src/web/`.
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test --experimental-strip-types tests/auth-guard-skeleton.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/server/auth src/server/guards tests/auth-guard-skeleton.test.ts
git commit -m "feat: add auth and guard contracts"
```

---

### Task 7: Add Observability Skeleton

**Files:**
- Create: `src/server/logs/observability.ts`
- Create: `src/server/logs/sinks/jsonl-file-sink.ts`
- Create: `src/server/logs/sinks/ai-trace-sink.ts`
- Modify: `src/server/logs/AGENTS.md`
- Create: `tests/observability-skeleton.test.ts`

- [ ] **Step 1: Write observability test**

Create `tests/observability-skeleton.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { ObservabilityBus } = await import("../src/server/logs/observability.ts");

test("ObservabilityBus emits events to registered sinks", async () => {
  const events: unknown[] = [];
  const bus = new ObservabilityBus();
  bus.register({ name: "capture", write: async (event) => events.push(event) });

  await bus.emit({
    type: "auth.session.validated",
    level: "info",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: { workspaceId: "ws_default" },
  });

  assert.deepEqual(events, [{
    type: "auth.session.validated",
    level: "info",
    timestamp: "2026-05-22T00:00:00.000Z",
    payload: { workspaceId: "ws_default" },
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types tests/observability-skeleton.test.ts
```

Expected: FAIL because `src/server/logs/observability.ts` does not exist.

- [ ] **Step 3: Add observability bus**

Create `src/server/logs/observability.ts`:

```typescript
import "server-only";

export type ObservabilityLevel = "debug" | "info" | "warn" | "error";

export interface ObservabilityEvent {
  type: string;
  level: ObservabilityLevel;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface LogSink {
  name: string;
  write(event: ObservabilityEvent): Promise<void>;
}

export class ObservabilityBus {
  private readonly sinks: LogSink[] = [];

  register(sink: LogSink): void {
    this.sinks.push(sink);
  }

  async emit(event: ObservabilityEvent): Promise<void> {
    for (const sink of this.sinks) {
      await sink.write(event);
    }
  }
}

export const observability = new ObservabilityBus();
```

- [ ] **Step 4: Add sink stubs**

Create `src/server/logs/sinks/jsonl-file-sink.ts`:

```typescript
import "server-only";

import type { LogSink, ObservabilityEvent } from "../observability";

export class JsonlFileSink implements LogSink {
  readonly name = "jsonl-file";

  async write(_event: ObservabilityEvent): Promise<void> {
    throw new Error("NOT_IMPLEMENTED: JsonlFileSink.write");
  }
}
```

Create `src/server/logs/sinks/ai-trace-sink.ts`:

```typescript
import "server-only";

import type { LogSink, ObservabilityEvent } from "../observability";

export const AI_TRACE_EVENT_ALLOWLIST = [
  "agent.turn.started",
  "agent.turn.completed",
  "agent.turn.failed",
] as const;

export class AiTraceSink implements LogSink {
  readonly name = "ai-trace";

  async write(_event: ObservabilityEvent): Promise<void> {
    throw new Error("NOT_IMPLEMENTED: AiTraceSink.write");
  }
}
```

- [ ] **Step 5: Update logs AGENTS**

Append to `src/server/logs/AGENTS.md`:

```markdown

Observability migration rules:

- New cross-cutting events go through `observability.emit`.
- Sink implementations must not make route handlers wait on network IO.
- Do not log session tokens, provider API keys, datasource secrets, or raw SQL credentials.
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test --experimental-strip-types tests/observability-skeleton.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/server/logs/observability.ts src/server/logs/sinks/jsonl-file-sink.ts src/server/logs/sinks/ai-trace-sink.ts src/server/logs/AGENTS.md tests/observability-skeleton.test.ts
git commit -m "feat: add observability contracts"
```

---

### Task 8: Add DB Migration Runner Skeleton

**Files:**
- Create: `src/server/db/migrations/runner.ts`
- Create: `src/server/db/AGENTS.md`
- Create: `tests/db-migration-runner.test.ts`

- [ ] **Step 1: Write DB migration runner tests**

Create `tests/db-migration-runner.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { applyDbMigrations } = await import("../src/server/db/migrations/runner.ts");

test("applyDbMigrations bootstraps schema_migrations and applies sql files once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sds-migrations-"));
  await writeFile(path.join(dir, "0006_example.sql"), "create table example (id text primary key);\n");

  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (/SELECT seq, checksum FROM schema_migrations/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };

  await applyDbMigrations({ pool, migrationsDir: dir });

  assert.match(queries[0].sql, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.equal(queries.some((query) => query.sql === "BEGIN"), true);
  assert.equal(queries.some((query) => query.sql.includes("create table example")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO schema_migrations")), true);
  assert.equal(queries.some((query) => query.sql === "COMMIT"), true);
});

test("applyDbMigrations rejects changed applied migration checksums", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sds-migrations-"));
  await writeFile(path.join(dir, "0006_example.sql"), "select 1;\n");

  const pool = {
    async query(sql: string) {
      if (/SELECT seq, checksum FROM schema_migrations/.test(sql)) {
        return { rows: [{ seq: "0006", checksum: "different" }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(() => applyDbMigrations({ pool, migrationsDir: dir }), /checksum mismatch/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --experimental-strip-types tests/db-migration-runner.test.ts
```

Expected: FAIL because runner does not exist.

- [ ] **Step 3: Add migration runner**

Create `src/server/db/migrations/runner.ts`:

```typescript
import "server-only";

import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface QueryablePool {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ApplyDbMigrationsOptions {
  pool: QueryablePool;
  migrationsDir: string;
}

const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    seq         text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    checksum    text NOT NULL
  );
`;

export async function applyDbMigrations(options: ApplyDbMigrationsOptions): Promise<void> {
  const { pool, migrationsDir } = options;

  await pool.query(BOOTSTRAP_SQL);

  const applied = await pool.query<{ seq: string; checksum: string }>(
    "SELECT seq, checksum FROM schema_migrations",
  );
  const appliedMap = new Map(applied.rows.map((row) => [row.seq, row.checksum]));

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const seq = file.split("_")[0];
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const previousChecksum = appliedMap.get(seq);

    if (previousChecksum) {
      if (previousChecksum !== checksum) {
        throw new Error(`Migration ${file} checksum mismatch. Stored=${previousChecksum}, current=${checksum}.`);
      }
      continue;
    }

    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(
        "INSERT INTO schema_migrations (seq, checksum) VALUES ($1, $2)",
        [seq, checksum],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}
```

- [ ] **Step 4: Add DB AGENTS rules**

Create `src/server/db/AGENTS.md`:

```markdown
# Server DB

Rules:

- Phase A startup order is config load, `ensureCloudAuthoringSchema`, then DB migration runner.
- New DDL must be added as `src/server/db/migrations/{seq}_{name}.sql`.
- Do not add new `create table`, `alter table`, or `do $$` blocks to `ensureCloudAuthoringSchema` during Phase A.
- Editing an already-applied migration is forbidden; add a new migration instead.
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test --experimental-strip-types tests/db-migration-runner.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/db tests/db-migration-runner.test.ts
git commit -m "feat: add db migration runner contract"
```

---

### Task 9: Add Dashboard Document Migration Skeleton

**Files:**
- Create: `src/server/dashboards/migrations/types.ts`
- Create: `src/server/dashboards/migrations/index.ts`
- Create: `src/server/dashboards/migrations/v0.3-to-v1.0.ts`
- Create: `src/server/dashboards/migrations/AGENTS.md`
- Create: `src/server/dashboards/migrations/__fixtures__/v0.3/sample.json`
- Create: `tests/dashboard-migration-skeleton.test.ts`

- [ ] **Step 1: Write migration skeleton test**

Create `tests/dashboard-migration-skeleton.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const migrations = await import("../src/server/dashboards/migrations/index.ts");

test("migrateToCurrent preserves current v1 dashboard documents", () => {
  const document = {
    schema_version: "1.0",
    dashboard_spec: { schema_version: "0.3", views: [] },
    query_defs: [],
    bindings: [],
  };

  assert.deepEqual(migrations.migrateToCurrent(document), document);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-migration-skeleton.test.ts
```

Expected: FAIL because migration files do not exist.

- [ ] **Step 3: Add migration types and current dispatcher**

Create `src/server/dashboards/migrations/types.ts`:

```typescript
export interface Migrator {
  readonly from: string;
  readonly to: string;
  migrate(input: unknown): unknown;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}
```

Create `src/server/dashboards/migrations/index.ts`:

```typescript
import { migrateV03ToV10 } from "./v0.3-to-v1.0";

export function migrateToCurrent(input: unknown): unknown {
  if (isRecord(input) && input.schema_version === "1.0") {
    return input;
  }
  if (isRecord(input) && isRecord(input.dashboard_spec) && input.dashboard_spec.schema_version === "0.3") {
    return migrateV03ToV10(input);
  }
  return input;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

Create `src/server/dashboards/migrations/v0.3-to-v1.0.ts`:

```typescript
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";

export function migrateV03ToV10(input: unknown): unknown {
  if (!isRecord(input)) return input;
  return {
    schema_version: CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION,
    ...input,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

- [ ] **Step 4: Add fixture and AGENTS**

Create `src/server/dashboards/migrations/__fixtures__/v0.3/sample.json`:

```json
{
  "dashboard_spec": {
    "schema_version": "0.3",
    "views": []
  },
  "query_defs": [],
  "bindings": []
}
```

Create `src/server/dashboards/migrations/AGENTS.md`:

```markdown
# Dashboard Document Migrations

Rules:

- Keep document schema version and legacy dashboard spec schema version as separate concepts.
- Migrators must be deterministic and side-effect free.
- Keep real v0.3 fixtures under `__fixtures__/v0.3/`.
- Do not remove `dashboard_spec.schema_version` during v1.0 migration.
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test --experimental-strip-types tests/dashboard-migration-skeleton.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/server/dashboards/migrations tests/dashboard-migration-skeleton.test.ts
git commit -m "feat: add dashboard migration skeleton"
```

---

### Task 10: Add LLM Provider Interface And Mock Provider

**Files:**
- Create: `src/ai/providers/types.ts`
- Create: `src/ai/providers/mock-provider.ts`
- Create: `src/ai/providers/AGENTS.md`
- Modify: `src/ai/providers/index.ts`
- Create: `tests/llm-provider-skeleton.test.ts`

- [ ] **Step 1: Write provider skeleton test**

Create `tests/llm-provider-skeleton.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { MockProvider } = await import("../src/ai/providers/mock-provider.ts");

test("MockProvider returns deterministic text", async () => {
  const provider = new MockProvider("mock response");
  const result = await provider.generateText({ messages: [{ role: "user", content: "hello" }] });

  assert.deepEqual(result, {
    provider: "mock",
    model: "mock",
    text: "mock response",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types tests/llm-provider-skeleton.test.ts
```

Expected: FAIL because provider skeleton files do not exist.

- [ ] **Step 3: Add provider types and mock**

Create `src/ai/providers/types.ts`:

```typescript
export type LlmMessageRole = "system" | "user" | "assistant" | "tool";

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
}

export interface LlmGenerateTextInput {
  messages: LlmMessage[];
}

export interface LlmGenerateTextResult {
  provider: string;
  model: string;
  text: string;
}

export interface LlmProvider {
  readonly provider: string;
  readonly model: string;
  generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult>;
}
```

Create `src/ai/providers/mock-provider.ts`:

```typescript
import type { LlmGenerateTextInput, LlmGenerateTextResult, LlmProvider } from "./types";

export class MockProvider implements LlmProvider {
  readonly provider = "mock";
  readonly model = "mock";

  constructor(private readonly responseText = "") {}

  async generateText(_input: LlmGenerateTextInput): Promise<LlmGenerateTextResult> {
    return {
      provider: this.provider,
      model: this.model,
      text: this.responseText,
    };
  }
}
```

- [ ] **Step 4: Export provider skeleton**

Modify `src/ai/providers/index.ts` to include:

```typescript
export type {
  LlmGenerateTextInput,
  LlmGenerateTextResult,
  LlmMessage,
  LlmMessageRole,
  LlmProvider,
} from "./types";
export { MockProvider } from "./mock-provider";
```

Keep existing exports from `pi-model-runtime.ts`.

- [ ] **Step 5: Add provider AGENTS**

Create `src/ai/providers/AGENTS.md`:

```markdown
# AI Providers

Rules:

- Preserve existing `PiModelRuntime` behavior.
- Do not hardcode provider enums that exclude registry providers such as DeepSeek.
- Provider auth keys are read by pi-ai AuthStorage through process env and are documented in `src/server/config/provider-auth-env-allowlist.ts`.
- Contract tests should use `MockProvider` unless they explicitly verify pi-ai registry behavior.
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test --experimental-strip-types tests/llm-provider-skeleton.test.ts tests/provider-config.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/ai/providers tests/llm-provider-skeleton.test.ts
git commit -m "feat: add llm provider contract"
```

---

### Task 11: Add Web Foundation Stubs

**Files:**
- Create: `src/web/api/server-fetch.ts`
- Create: `src/web/dashboard/render/chart-error-placeholder.tsx`
- Create: `src/web/i18n/keys.ts`
- Create: `tests/web-foundation-skeleton.test.ts`

- [ ] **Step 1: Write test**

Create `tests/web-foundation-skeleton.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const serverFetch = await import("../src/web/api/server-fetch.ts");
const i18nKeys = await import("../src/web/i18n/keys.ts");

test("web foundation stubs export expected contracts", () => {
  assert.equal(typeof serverFetch.serverFetch, "function");
  assert.equal(i18nKeys.I18N_KEYS.errorAuthoringAgentTimeout, "error.authoring.agent_timeout");
  assert.equal(i18nKeys.I18N_KEYS.errorChartRenderFailed, "error.chart.render_failed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types tests/web-foundation-skeleton.test.ts
```

Expected: FAIL because web foundation files do not exist.

- [ ] **Step 3: Add server fetch stub**

Create `src/web/api/server-fetch.ts`:

```typescript
export interface ServerFetchOptions extends RequestInit {
  csrfToken?: string;
}

export async function serverFetch(input: string | URL, init: ServerFetchOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.csrfToken) {
    headers.set("X-CSRF-Token", init.csrfToken);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
}
```

- [ ] **Step 4: Add chart error placeholder**

Create `src/web/dashboard/render/chart-error-placeholder.tsx`:

```tsx
export interface ChartErrorPlaceholderProps {
  title?: string;
  message?: string;
}

export function ChartErrorPlaceholder(props: ChartErrorPlaceholderProps) {
  return (
    <div role="status" aria-live="polite">
      <strong>{props.title ?? "Chart unavailable"}</strong>
      {props.message ? <p>{props.message}</p> : null}
    </div>
  );
}
```

- [ ] **Step 5: Add i18n keys**

Create `src/web/i18n/keys.ts`:

```typescript
export const I18N_KEYS = {
  errorAuthoringAgentTimeout: "error.authoring.agent_timeout",
  errorChartRenderFailed: "error.chart.render_failed",
  errorAuthRequired: "error.auth.required",
  errorAuthSessionExpired: "error.auth.session_expired",
  errorAuthPermissionDenied: "error.auth.permission_denied",
} as const;

export type I18nKey = (typeof I18N_KEYS)[keyof typeof I18N_KEYS];
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test --experimental-strip-types tests/web-foundation-skeleton.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/web/api/server-fetch.ts src/web/dashboard/render/chart-error-placeholder.tsx src/web/i18n/keys.ts tests/web-foundation-skeleton.test.ts
git commit -m "feat: add web foundation stubs"
```

---

### Task 12: Add ESLint Identity Rule In Warn Mode

**Files:**
- Create: `eslint.config.js`
- Create: `eslint-rules/no-identity-in-request.js`
- Create: `tests/eslint-rule.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write rule unit test**

Create `tests/eslint-rule.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

const ruleModule = await import("../eslint-rules/no-identity-in-request.js");

test("no-identity-in-request rule metadata is available", () => {
  assert.equal(ruleModule.default.meta.type, "problem");
  assert.equal(ruleModule.default.meta.messages.identityFromBody, "Do not read identity from request body in API routes; use requireServerSession(req).");
  assert.equal(ruleModule.default.meta.messages.identityFromQuery, "Do not read identity from query string in API routes; use requireServerSession(req).");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --experimental-strip-types tests/eslint-rule.test.ts
```

Expected: FAIL because the rule file does not exist.

- [ ] **Step 3: Install ESLint dependencies**

Run:

```bash
npm install -D eslint @eslint/js typescript-eslint
```

Expected: `package.json` and `package-lock.json` include the new dev dependencies.

- [ ] **Step 4: Add custom rule**

Create `eslint-rules/no-identity-in-request.js`:

```javascript
const IDENTITY_KEYS = new Set(["userId", "workspaceId", "user_id", "workspace_id"]);

function isIdentityLiteral(node) {
  return node && node.type === "Literal" && IDENTITY_KEYS.has(String(node.value));
}

function isSearchParamsGet(node) {
  return (
    node?.type === "CallExpression" &&
    node.callee?.type === "MemberExpression" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "get" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "searchParams" &&
    isIdentityLiteral(node.arguments?.[0])
  );
}

function isIdentityMember(node) {
  return (
    node?.type === "MemberExpression" &&
    node.property?.type === "Identifier" &&
    IDENTITY_KEYS.has(node.property.name)
  );
}

export default {
  meta: {
    type: "problem",
    messages: {
      identityFromBody: "Do not read identity from request body in API routes; use requireServerSession(req).",
      identityFromQuery: "Do not read identity from query string in API routes; use requireServerSession(req).",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isSearchParamsGet(node)) {
          context.report({ node, messageId: "identityFromQuery" });
        }
      },
      MemberExpression(node) {
        if (isIdentityMember(node)) {
          context.report({ node, messageId: "identityFromBody" });
        }
      },
    };
  },
};
```

- [ ] **Step 5: Add flat config**

Create `eslint.config.js`:

```javascript
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import noIdentityInRequest from "./eslint-rules/no-identity-in-request.js";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/app/api/**/*.ts"],
    plugins: {
      sds: {
        rules: {
          "no-identity-in-request": noIdentityInRequest,
        },
      },
    },
    rules: {
      "sds/no-identity-in-request": "warn",
    },
  },
  {
    files: ["eslint-rules/**/*.js"],
    languageOptions: {
      sourceType: "module",
    },
  },
];
```

- [ ] **Step 6: Add lint script**

Modify `package.json` scripts to include:

```json
{
  "lint": "eslint src/app/api src/server/auth eslint-rules"
}
```

- [ ] **Step 7: Run rule test and lint**

Run:

```bash
node --test --experimental-strip-types tests/eslint-rule.test.ts
npm run lint
```

Expected: rule test exits 0. `npm run lint` exits 0; current route identity warnings may print because Sprint 1 has not migrated routes yet.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json eslint.config.js eslint-rules/no-identity-in-request.js tests/eslint-rule.test.ts
git commit -m "chore: add api identity lint guardrail"
```

---

### Task 13: Add Failure Mode And Performance Audit Artifacts

**Files:**
- Create: `docs/audit/failure-modes-audit.md`
- Create: `docs/audit/perf-baseline.md`

- [ ] **Step 1: Create failure mode audit artifact**

Create `docs/audit/failure-modes-audit.md`:

```markdown
# Failure Modes Audit

## Scope

This file maps current implementation behavior to the failure matrix in `docs/architecture.md`.

## Current Findings

| Failure | Current implementation location | Current behavior | Target behavior | Sprint |
|---|---|---|---|---|
| Auth missing or expired | `src/server/request-context.ts` and route-level parsing | Mixed behavior; some routes infer identity from body or query | `requireServerSession` returns 401 with stable code | 1 |
| CSRF invalid origin | Not centralized | No global mutating-route check | `requireServerSession` rejects with 403 `CSRF_INVALID_ORIGIN` | 1 |
| Provider auth missing | `src/ai/providers/pi-model-runtime.ts` | Runtime resolution rejects missing provider auth | Keep runtime rejection, document provider auth passthrough | 0 |
| Agent stream timeout | `src/ai/authoring/agent/session.ts` | Existing timeout handling is implementation-specific | 60s timeout emits stable event and UI retry state | 3 |
| Chart render failure | Renderer/browser chart components | Current behavior varies by renderer path | Per-view error placeholder without failing whole dashboard | 3 |

## Follow-up

Sprint 3 expands this file into one row per architecture failure-matrix item and adds exact tests.
```

- [ ] **Step 2: Create performance baseline artifact**

Create `docs/audit/perf-baseline.md`:

```markdown
# Performance Baseline

## Baseline Commands

Run these commands before Sprint 1 starts:

```bash
npm run typecheck
npm test
npm run test:contract
```

## Initial Baseline

| Metric | Command | Baseline | Notes |
|---|---|---:|---|
| Typecheck wall time | `npm run typecheck` | measured during execution | Update with local timing before Sprint 1 |
| Unit test wall time | `npm test` | measured during execution | Current suite uses Node `node:test` |
| Contract smoke wall time | `npm run test:contract` | measured during execution | Foundation-only contract runner |
| `requireServerSession` P95 | Sprint 1 benchmark | not measured in Sprint 0 | Target P95 < 3ms after implementation |
```

- [ ] **Step 3: Verify docs**

Run:

```bash
test -f docs/audit/failure-modes-audit.md && test -f docs/audit/perf-baseline.md
```

Expected: command exits 0.

- [ ] **Step 4: Commit**

```bash
git add docs/audit/failure-modes-audit.md docs/audit/perf-baseline.md
git commit -m "docs: add migration audit baselines"
```

---

### Task 14: Run Foundation Verification

**Files:**
- Verify all files changed by Tasks 1-13.

- [ ] **Step 1: Run format-free diff check**

Run:

```bash
git diff --check HEAD~13 HEAD
```

Expected: command exits 0.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: command exits 0.

- [ ] **Step 3: Run unit tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run contract tests**

Run:

```bash
npm run test:contract
```

Expected: all contract tests pass.

- [ ] **Step 5: Run lint**

Run:

```bash
npm run lint
```

Expected: command exits 0. Warnings from existing route identity reads are acceptable until Sprint 1.

- [ ] **Step 6: Run ENV check**

Run:

```bash
npm run script:check-env
```

Expected: prints `ENV check passed.`

- [ ] **Step 7: Run baseline audits**

Run:

```bash
npm run audit:baseline
```

Expected: route, env, and event audit files are regenerated.

- [ ] **Step 8: Inspect final status**

Run:

```bash
git status --short
```

Expected: no uncommitted changes after committing regenerated audit artifacts, or only intentional regenerated audit changes staged for the final commit.

- [ ] **Step 9: Commit final audit refresh if needed**

If audit outputs changed during Step 7, run:

```bash
git add docs/audit/route-inventory.md docs/audit/env-inventory.md docs/audit/event-inventory.md
git commit -m "docs: refresh foundation audit outputs"
```

Expected: final worktree is clean.

---

## Self-Review Checklist

- Sprint -2 directories and decision records are covered by Task 1.
- Sprint -2 route, ENV, and event inventory outputs are covered by Task 2.
- Sprint -2 test/CI command baseline is covered by Task 3.
- Sprint -1 failure and performance audit artifacts are covered by Task 13.
- Sprint 0 config loader and provider auth allowlist are covered by Task 4.
- Sprint 0 schema version and API error contracts are covered by Task 5.
- Sprint 0 auth and guard stubs are covered by Task 6.
- Sprint 0 observability skeleton is covered by Task 7.
- Sprint 0 DB migration runner skeleton and Phase A rule file are covered by Task 8.
- Sprint 0 dashboard document migration skeleton is covered by Task 9.
- Sprint 0 LLM provider interface and mock provider are covered by Task 10.
- Sprint 0 frontend stubs are covered by Task 11.
- Sprint 0 lint rule and warn-mode enforcement are covered by Task 12.
- Final verification is covered by Task 14.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-migration-foundation-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Choose one approach before starting implementation.
