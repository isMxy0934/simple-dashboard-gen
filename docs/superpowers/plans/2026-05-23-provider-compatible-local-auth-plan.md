# Provider-Compatible Local Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock login with provider-compatible local database authentication while keeping future Auth0 integration on the same identity-to-session flow.

**Architecture:** Add provider identity mapping tables, local credential storage, and local role/permission tables. The login route verifies credentials through the `local` provider, resolves the provider identity to a workspace user, expands local permissions, and signs the existing `sds_session` JWT. Auth0 later plugs into the same normalized identity resolution layer.

**Tech Stack:** Next.js route handlers, TypeScript, PostgreSQL migrations, Node `crypto.scrypt`, Node test runner.

---

## File Structure

- Create `src/server/db/migrations/0009_provider_compatible_auth.sql`: auth identity, local credential, role, permission, and seed data migration.
- Create `src/server/auth/password.ts`: versioned scrypt password hash creation and verification helpers.
- Create `src/server/auth/local-identity-provider.ts`: local credential verification and identity normalization.
- Create `src/server/auth/app-user-resolver.ts`: maps normalized identities to workspace users and expands local permissions.
- Modify `src/app/api/auth/login/route.ts`: replace mock user mapping and hardcoded permissions with local provider + resolver.
- Modify `src/web/auth/ui/login-page.tsx`: use a seeded local user as the default form value.
- Modify `docs/architecture.md` and `docs/migration.md`: document local DB provider now, Auth0 provider later, local roles as runtime authorization source.
- Test `tests/auth-local-login.test.ts`: password, provider, resolver, and login route behavior.
- Modify `tests/auth-session.test.ts`: keep the session revocation schema-readiness regression added during login debugging.

---

### Task 1: Migration Contract

**Files:**
- Create: `src/server/db/migrations/0009_provider_compatible_auth.sql`
- Test: `tests/auth-local-login.test.ts`

- [ ] **Step 1: Write failing migration contract tests**

Add `tests/auth-local-login.test.ts` with tests that read the migration file and assert it creates:

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("provider-compatible auth migration creates identity, credential, and role tables", async () => {
  const source = await readFile(
    new URL("../src/server/db/migrations/0009_provider_compatible_auth.sql", import.meta.url),
    "utf8",
  );

  assert.match(source, /create table if not exists auth_identities/i);
  assert.match(source, /create table if not exists local_user_credentials/i);
  assert.match(source, /create table if not exists workspace_roles/i);
  assert.match(source, /create table if not exists workspace_role_permissions/i);
  assert.match(source, /create table if not exists workspace_user_roles/i);
  assert.match(source, /insert into auth_identities/i);
  assert.match(source, /insert into local_user_credentials/i);
  assert.match(source, /insert into workspace_user_roles/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: FAIL because `0009_provider_compatible_auth.sql` does not exist.

- [ ] **Step 3: Add the migration**

Create `0009_provider_compatible_auth.sql` with provider identity tables, role tables, and seeded local users. Seed local passwords for `alice@example.com`, `bob@example.com`, and `chen@example.com` using versioned scrypt hashes for password `dashboard`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: PASS.

---

### Task 2: Password Hashing

**Files:**
- Create: `src/server/auth/password.ts`
- Test: `tests/auth-local-login.test.ts`

- [ ] **Step 1: Write failing password tests**

Add tests:

```ts
const password = await import("../src/server/auth/password.ts");

test("scrypt password helpers verify matching passwords and reject mismatches", async () => {
  const hash = await password.hashLocalPassword("dashboard", "test-salt");

  assert.equal(await password.verifyLocalPassword("dashboard", hash), true);
  assert.equal(await password.verifyLocalPassword("wrong", hash), false);
});

test("scrypt password verifier rejects malformed hashes", async () => {
  assert.equal(await password.verifyLocalPassword("dashboard", "not-a-hash"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: FAIL because `password.ts` does not exist.

- [ ] **Step 3: Implement password helpers**

Implement `hashLocalPassword(password, salt?)` and `verifyLocalPassword(password, storedHash)` using `crypto.scrypt` with versioned format `scrypt$v1$16384$8$1$64$salt$hash`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: PASS.

---

### Task 3: Local Provider And User Resolver

**Files:**
- Create: `src/server/auth/local-identity-provider.ts`
- Create: `src/server/auth/app-user-resolver.ts`
- Test: `tests/auth-local-login.test.ts`

- [ ] **Step 1: Write failing provider/resolver tests**

Add tests with fake pools:

```ts
const localProvider = await import("../src/server/auth/local-identity-provider.ts");
const appUserResolver = await import("../src/server/auth/app-user-resolver.ts");
const { Permission } = await import("../src/server/auth/permissions.ts");

test("local provider verifies credentials and returns normalized identity", async () => {
  const hash = await password.hashLocalPassword("dashboard", "provider-salt");
  const pool = {
    async query() {
      return {
        rows: [{
          provider: "local",
          subject: "alice@example.com",
          email: "alice@example.com",
          display_name: "Alice",
          password_hash: hash,
          disabled_at: null,
        }],
      };
    },
  };

  const identity = await localProvider.verifyLocalCredentials(
    { identity: "Alice@Example.com", password: "dashboard" },
    { pool },
  );

  assert.deepEqual(identity, {
    provider: "local",
    subject: "alice@example.com",
    email: "alice@example.com",
    displayName: "Alice",
  });
});

test("local provider returns null for wrong or disabled credentials", async () => {
  const hash = await password.hashLocalPassword("dashboard", "disabled-salt");
  const wrongPasswordPool = {
    async query() {
      return { rows: [{ provider: "local", subject: "alice@example.com", email: "alice@example.com", display_name: "Alice", password_hash: hash, disabled_at: null }] };
    },
  };
  const disabledPool = {
    async query() {
      return { rows: [{ provider: "local", subject: "alice@example.com", email: "alice@example.com", display_name: "Alice", password_hash: hash, disabled_at: new Date().toISOString() }] };
    },
  };

  assert.equal(await localProvider.verifyLocalCredentials({ identity: "alice@example.com", password: "wrong" }, { pool: wrongPasswordPool }), null);
  assert.equal(await localProvider.verifyLocalCredentials({ identity: "alice@example.com", password: "dashboard" }, { pool: disabledPool }), null);
});

test("app user resolver expands permissions from local roles", async () => {
  const calls: string[] = [];
  const pool = {
    async query(sql: string) {
      calls.push(sql);
      if (sql.includes("from auth_identities")) {
        return { rows: [{ workspace_id: "ws_default", user_id: "usr_alice", email: "alice@example.com", display_name: "Alice" }] };
      }
      return { rows: [{ permission: Permission.DashboardRead }, { permission: Permission.DatasourceRead }] };
    },
  };

  const resolved = await appUserResolver.resolveAppUserForIdentity(
    { provider: "local", subject: "alice@example.com", email: "alice@example.com", displayName: "Alice" },
    { pool },
  );

  assert.deepEqual(resolved, {
    workspaceId: "ws_default",
    userId: "usr_alice",
    email: "alice@example.com",
    displayName: "Alice",
    permissions: [Permission.DashboardRead, Permission.DatasourceRead],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: FAIL because provider and resolver files do not exist.

- [ ] **Step 3: Implement provider and resolver**

Use `ensureCloudAuthoringSchema()` before default DB queries, skip it when a test pool is injected, and filter permissions against `Permission`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: PASS.

---

### Task 4: Login Route Integration

**Files:**
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/web/auth/ui/login-page.tsx`
- Test: `tests/auth-local-login.test.ts`

- [ ] **Step 1: Write failing route contract tests**

Add tests:

```ts
test("login route no longer contains mock identity mapping or hardcoded permissions", async () => {
  const source = await readFile(
    new URL("../src/app/api/auth/login/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /resolveUserId/);
  assert.doesNotMatch(source, /usr_bob/);
  assert.doesNotMatch(source, /Permission\.WorkspaceAdmin[\s\S]*Permission\.DatasourceManage/);
  assert.match(source, /verifyLocalCredentials/);
  assert.match(source, /resolveAppUserForIdentity/);
});

test("login page defaults to a seeded local user", async () => {
  const source = await readFile(
    new URL("../src/web/auth/ui/login-page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /defaultValue="alice@example\.com"/);
  assert.match(source, /defaultValue="dashboard"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: FAIL because login route still has mock identity mapping.

- [ ] **Step 3: Replace mock login with provider-compatible login**

`POST /api/auth/login` should:

1. rate-limit and CSRF-check as today.
2. parse body.
3. require nonempty `identity` and `password`.
4. call `verifyLocalCredentials`.
5. call `resolveAppUserForIdentity`.
6. sign `sds_session` with resolver permissions.
7. return `401 INVALID_CREDENTIALS` for invalid or unresolved local identities.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/auth-local-login.test.ts`

Expected: PASS.

---

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/migration.md`
- Test: existing verification commands

- [ ] **Step 1: Update docs**

Document that current login is `local` DB credentials, Auth0 is future provider, permissions are local app roles, and Auth0 roles are optional future sync input.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- tests/auth-local-login.test.ts
npm test -- tests/auth-session.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run typecheck
npm run typecheck:tests
npm run lint
npm test
npm run test:contract -- --coverage
npm run check:final
npm run build
```

Expected: all pass, except E2E remains subject to the known sandbox port binding limitation if run in this environment.
