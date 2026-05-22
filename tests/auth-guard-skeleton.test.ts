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
const execution = await import("../src/server/execution/execute-batch.ts");

test("auth modules expose the Sprint 1 contract surface", async () => {
  assert.equal(typeof requireSession.requireServerSession, "function");
  assert.equal(typeof jwt.signSessionToken, "function");
  assert.equal(typeof jwt.verifySessionToken, "function");
  assert.equal(typeof csrf.assertCsrf, "function");
  assert.equal(permissions.Permission.DashboardRead, "dashboard.read");
  assert.equal(permissions.Permission.DashboardPublish, "dashboard.publish");
  assert.equal(permissions.Permission.DatasourceManage, "datasource.manage");
  assert.equal(permissions.Permission.WorkspaceAdmin, "workspace.admin");
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
});

test("guard modules enforce quota and rate limit contracts", async () => {
  assert.equal(quotas.QUOTAS.viewsPerDashboard, 50);
  await assert.doesNotReject(() => quotas.assertQuota("viewsPerDashboard", 50));
  await assert.rejects(
    () => quotas.assertQuota("viewsPerDashboard", 51),
    (error) => {
      assert.equal((error as { code?: string }).code, "QUOTA_VIEWS_PER_DASHBOARD");
      assert.equal(
        (error as { i18nKey?: string }).i18nKey,
        "error.quota.views_per_dashboard",
      );
      return true;
    },
  );

  const key = `user:${Date.now()}:${Math.random()}`;
  for (let index = 0; index < 5; index += 1) {
    await assert.doesNotReject(() => rateLimit.assertRateLimit("auth.login", key));
  }
  await assert.rejects(
    () => rateLimit.assertRateLimit("auth.login", key),
    (error) => {
      assert.equal((error as { code?: string }).code, "RATE_LIMIT_LOGIN");
      assert.equal((error as { status?: number }).status, 429);
      return true;
    },
  );
});

test("dashboard document quota guard rejects over-limit documents", async () => {
  const document = {
    schema_version: "1.0",
    dashboard_spec: {
      schema_version: "0.3",
      dashboard: { name: "Quota document" },
      filters: [],
      views: Array.from({ length: 51 }, (_, index) => ({
        id: `view_${index}`,
        title: `View ${index}`,
        renderer: {
          kind: "echarts",
          recipe_id: "echarts-kpi-card",
          option_template: {},
          slots: [],
        },
      })),
      layout: {
        desktop: { cols: 12, row_height: 80, items: [] },
        mobile: { cols: 4, row_height: 80, items: [] },
      },
    },
    query_defs: [],
    bindings: [],
  };

  await assert.rejects(
    () =>
      quotas.assertDashboardDocumentQuota(document as never, {
        dashboardId: "dash_quota",
      }),
    (error) => {
      assert.equal((error as { code?: string }).code, "QUOTA_VIEWS_PER_DASHBOARD");
      assert.equal(
        (error as { i18nKey?: string }).i18nKey,
        "error.quota.views_per_dashboard",
      );
      return true;
    },
  );
});

test("executeBatch rejects oversized batches before loading a dashboard", async () => {
  const outcome = await execution.executeBatch(
    {
      dashboard_id: "dash_quota",
      version: 1,
      visible_view_ids: Array.from({ length: 21 }, (_, index) => `view_${index}`),
    },
    { workspaceId: "ws_default" },
  );

  assert.equal(outcome.httpStatus, 413);
  assert.equal(outcome.body.reason, "QUOTA_BATCH_SIZE");
  assert.equal(outcome.body.message_i18n_key, "error.quota.batch_size");
});
