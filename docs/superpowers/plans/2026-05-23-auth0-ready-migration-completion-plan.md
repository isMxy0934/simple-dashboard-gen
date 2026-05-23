# Auth0-ready Migration Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the finalized migration honest and Auth0-ready by fixing protected API auth order, enforcing the identity lint gate, adding real contract tests, and documenting single-workspace/mock-auth status.

**Architecture:** Keep `requireServerSession` / `requireApiSession` as the only server identity boundary. Protected mutating API routes authenticate before parsing JSON. The product is documented as single workspace with a mock cookie/JWT auth scaffold that will be replaced by Auth0 later.

**Tech Stack:** Next.js App Router route handlers, TypeScript, Node `node:test`, ESLint flat config, Markdown docs.

---

## File Map

- Modify `eslint.config.js`: promote `sds/no-identity-in-request` from `warn` to `error`.
- Modify `tests-contract/foundation.contract.test.ts`: replace runner-only smoke coverage with migration invariants.
- Modify protected mutating route files under `src/app/api/**/route.ts`: move `requireApiSession` before `request.json()`.
- Modify `docs/architecture.md`: align auth and workspace target state with Auth0-ready single-workspace design.
- Modify `docs/migration.md`: align finalization and acceptance language with current verified state.

## Task 1: Contract Gate

**Files:**
- Modify: `tests-contract/foundation.contract.test.ts`
- Read: `eslint.config.js`
- Read: `src/contracts/validation.ts`
- Read: selected route files under `src/app/api/**/route.ts`

- [ ] **Step 1: Write failing contract tests**

Replace `tests-contract/foundation.contract.test.ts` with tests that assert:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { validateDashboardDocument } from "../src/contracts/validation.ts";

const root = process.cwd();

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

function assertAuthBeforeJson(source: string, routeLabel: string): void {
  const authIndex = source.indexOf("requireApiSession(");
  const jsonIndex = source.indexOf("request.json()");
  assert.notEqual(authIndex, -1, `${routeLabel} must call requireApiSession`);
  assert.notEqual(jsonIndex, -1, `${routeLabel} must parse request JSON`);
  assert.ok(authIndex < jsonIndex, `${routeLabel} must authenticate before parsing JSON`);
}

test("migration contract requires top-level dashboard document schema version", () => {
  const result = validateDashboardDocument(
    {
      dashboard_spec: { schema_version: "0.3", views: [] },
      query_defs: [],
      bindings: [],
    },
    "draft",
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "dashboard_document.schema_version"),
  );
});

test("migration contract keeps legacy spec schema version during document v1", () => {
  const result = validateDashboardDocument(
    {
      schema_version: "1.0",
      dashboard_spec: { schema_version: "1.0", views: [] },
      query_defs: [],
      bindings: [],
    },
    "draft",
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.path === "dashboard_spec.schema_version"),
  );
});

test("identity lint rule is a final error gate", async () => {
  const source = await read("eslint.config.js");
  assert.match(source, /"sds\/no-identity-in-request":\s*"error"/);
});

test("protected mutating routes authenticate before parsing JSON", async () => {
  for (const route of [
    "src/app/api/dashboard/save/route.ts",
    "src/app/api/dashboard/publish/route.ts",
    "src/app/api/datasources/route.ts",
    "src/app/api/datasources/test/route.ts",
    "src/app/api/authoring/session/open/route.ts",
    "src/app/api/authoring/session/save/route.ts",
    "src/app/api/authoring/checks/route.ts",
    "src/app/api/authoring/chat/route.ts",
    "src/app/api/authoring/chat/[id]/steer/route.ts",
    "src/app/api/authoring/task/route.ts",
    "src/app/api/authoring/ui-session/route.ts",
    "src/app/api/authoring/settings/route.ts",
  ]) {
    assertAuthBeforeJson(await read(route), route);
  }
});

test("execute batch route authenticates before delegating request parsing", async () => {
  const source = await read("src/app/api/query/execute-batch/route.ts");
  assert.match(source, /requireApiSession\(request,\s*Permission\.DashboardRead\)/);
  assert.doesNotMatch(source, /workspace_id\s*:\s*[^,}]*request/i);
  assert.doesNotMatch(source, /workspaceId\s*=\s*[^;]*body/i);
});
```

- [ ] **Step 2: Run contract tests to verify RED**

Run: `npm run test:contract -- --coverage`

Expected: FAIL because the lint rule is still `warn` and several route files parse JSON before `requireApiSession`.

## Task 2: Protected API Order

**Files:**
- Modify: `src/app/api/dashboard/save/route.ts`
- Modify: `src/app/api/dashboard/publish/route.ts`
- Modify: `src/app/api/datasources/route.ts`
- Modify: `src/app/api/datasources/test/route.ts`
- Modify: `src/app/api/authoring/session/open/route.ts`
- Modify: `src/app/api/authoring/session/save/route.ts`
- Modify: `src/app/api/authoring/checks/route.ts`
- Modify: `src/app/api/authoring/chat/route.ts`
- Modify: `src/app/api/authoring/chat/[id]/steer/route.ts`
- Modify: `src/app/api/authoring/task/route.ts`
- Modify: `src/app/api/authoring/ui-session/route.ts`
- Modify: `src/app/api/authoring/settings/route.ts`

- [ ] **Step 1: Move auth before JSON parsing**

For each protected mutating handler, follow this local pattern:

```ts
export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requireApiSession(request, Permission.DashboardEdit);
    const payload = await request.json();
    // validate and call service with session-scoped identity
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
```

Keep existing 400 JSON parse responses where practical by catching the parse error after auth. If a route already catches all errors through `apiErrorToResponse`, add a local `try/catch` around `request.json()` after `requireApiSession`.

- [ ] **Step 2: Run contract tests to verify GREEN for route order**

Run: `npm run test:contract -- --coverage`

Expected: only lint error gate may still fail until Task 3, or all contract tests pass if Task 3 is already complete.

## Task 3: Lint Final Gate

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: Promote the custom rule to error**

Change:

```js
"sds/no-identity-in-request": "warn",
```

to:

```js
"sds/no-identity-in-request": "error",
```

- [ ] **Step 2: Verify lint and contract tests**

Run:

```bash
npm run lint
npm run test:contract -- --coverage
```

Expected: both commands pass.

## Task 4: Documentation Alignment

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/migration.md`

- [ ] **Step 1: Update auth wording**

Change current-state language from completed real credential authentication to mock scaffold / Auth0-ready. Keep the cookie/JWT boundary as current code-level behavior. Mark Auth0 as planned follow-up.

- [ ] **Step 2: Update workspace wording**

Change multi-tenant/cross-workspace claims to single-workspace wording. State that `ws_default` is the single active workspace namespace and `workspaceId` is retained as an internal namespace and future expansion point.

- [ ] **Step 3: Update acceptance wording**

Change final acceptance from blanket checked claims to:

- code-level checks that are currently automated,
- operational checks that must be run before release,
- Auth0 checks deferred to the Auth0 integration.

## Task 5: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run typecheck
npm run typecheck:tests
npm run lint
npm test
npm run test:contract -- --coverage
npm run script:check-env
npm run script:check-i18n
npm run build
```

Expected: all pass.

- [ ] **Step 2: Run E2E**

Run:

```bash
CI=1 npm run test:e2e -- --reporter=line
```

Expected: all Playwright tests pass. If the sandbox cannot bind port 3000, rerun with escalated permissions.
