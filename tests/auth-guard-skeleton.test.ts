import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const requireSession = await import("../src/server/auth/require-session.ts");
const jwt = await import("../src/server/auth/jwt.ts");
const permissions = await import("../src/server/auth/permissions.ts");
const workspacePolicy = await import("../src/server/auth/workspace-policy.ts");
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
  const sessionPermissions = new Set([permissions.Permission.DashboardRead]);
  const policy = workspacePolicy.WorkspacePolicy.derive({
    userId: "user:1",
    workspaceId: "workspace:1",
    permissions: sessionPermissions,
    sessionId: "session:1",
    requestId: "request:1",
    issuedAt: 1,
    expiresAt: 2,
  });
  assert.equal(policy.userId, "user:1");
  assert.equal(policy.workspaceId, "workspace:1");
  assert.equal(policy.permissions, sessionPermissions);
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
