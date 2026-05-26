import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./ts-paths-loader.mjs", import.meta.url);

const password = await import("../src/server/auth/password.ts");
const localProvider = await import("../src/server/auth/local-identity-provider.ts");
const appUserResolver = await import("../src/server/auth/app-user-resolver.ts");
const { Permission } = await import("../src/server/auth/permissions.ts");

test("provider-compatible auth migration creates identity, credential, and role tables", async () => {
  const source = await readFile(
    new URL(
      "../src/server/db/migrations/0009_provider_compatible_auth.sql",
      import.meta.url,
    ),
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

test("provider-compatible auth migrations keep viewer scoped to dashboard reads only", async () => {
  const initialSource = await readFile(
    new URL(
      "../src/server/db/migrations/0009_provider_compatible_auth.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const tighteningSource = await readFile(
    new URL(
      "../src/server/db/migrations/0010_viewer_role_read_scope.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(initialSource, /\('ws_default', 'viewer', 'dashboard\.read'\)/);
  assert.doesNotMatch(initialSource, /\('ws_default', 'viewer', 'datasource\.read'\)/);
  assert.match(tighteningSource, /delete\s+from\s+workspace_role_permissions/i);
  assert.match(tighteningSource, /role_id\s*=\s*'viewer'/i);
  assert.match(tighteningSource, /permission\s*=\s*'datasource\.read'/i);
});

test("provider-compatible auth migration seeds dashboard password hashes", async () => {
  const source = await readFile(
    new URL(
      "../src/server/db/migrations/0009_provider_compatible_auth.sql",
      import.meta.url,
    ),
    "utf8",
  );

  const seededHashes = Array.from(
    source.matchAll(/'(scrypt\$v1\$\d+\$\d+\$\d+\$\d+\$[^']+)'/g),
    (match) => match[1],
  );

  assert.equal(seededHashes.length, 3);
  for (const seededHash of seededHashes) {
    assert.equal(await password.verifyLocalPassword("dashboard", seededHash), true);
    assert.equal(await password.verifyLocalPassword("wrong", seededHash), false);
  }
});

test("scrypt password helpers verify matching passwords and reject mismatches", async () => {
  const hash = await password.hashLocalPassword("dashboard", "test-salt");

  assert.equal(await password.verifyLocalPassword("dashboard", hash), true);
  assert.equal(await password.verifyLocalPassword("wrong", hash), false);
});

test("scrypt password verifier rejects malformed hashes", async () => {
  assert.equal(await password.verifyLocalPassword("dashboard", "not-a-hash"), false);
});

test("local provider verifies credentials and returns normalized identity", async () => {
  const hash = await password.hashLocalPassword("dashboard", "provider-salt");
  const pool = {
    async query() {
      return {
        rows: [
          {
            provider: "local",
            subject: "alice@example.com",
            email: "alice@example.com",
            display_name: "Alice",
            password_hash: hash,
            disabled_at: null,
          },
        ],
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
      return {
        rows: [
          {
            provider: "local",
            subject: "alice@example.com",
            email: "alice@example.com",
            display_name: "Alice",
            password_hash: hash,
            disabled_at: null,
          },
        ],
      };
    },
  };
  const disabledPool = {
    async query() {
      return {
        rows: [
          {
            provider: "local",
            subject: "alice@example.com",
            email: "alice@example.com",
            display_name: "Alice",
            password_hash: hash,
            disabled_at: new Date().toISOString(),
          },
        ],
      };
    },
  };

  assert.equal(
    await localProvider.verifyLocalCredentials(
      { identity: "alice@example.com", password: "wrong" },
      { pool: wrongPasswordPool },
    ),
    null,
  );
  assert.equal(
    await localProvider.verifyLocalCredentials(
      { identity: "alice@example.com", password: "dashboard" },
      { pool: disabledPool },
    ),
    null,
  );
});

test("app user resolver expands permissions from local roles", async () => {
  const pool = {
    async query(sql: string) {
      if (sql.includes("from auth_identities")) {
        return {
          rows: [
            {
              workspace_id: "ws_default",
              user_id: "usr_alice",
              email: "alice@example.com",
              display_name: "Alice",
            },
          ],
        };
      }
      return {
        rows: [
          { permission: Permission.DashboardRead },
          { permission: Permission.DatasourceRead },
        ],
      };
    },
  };

  const resolved = await appUserResolver.resolveAppUserForIdentity(
    {
      provider: "local",
      subject: "alice@example.com",
      email: "alice@example.com",
      displayName: "Alice",
    },
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

test("login route no longer contains mock identity mapping or hardcoded permissions", async () => {
  const source = await readFile(
    new URL("../src/app/api/auth/login/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /resolveUserId/);
  assert.doesNotMatch(source, /usr_bob/);
  assert.doesNotMatch(
    source,
    /Permission\.WorkspaceAdmin[\s\S]*Permission\.DatasourceManage/,
  );
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
