import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { resolveServerRequestContext } = await import(
  "../src/server/request-context.ts"
);

type Query = { sql: string; params?: unknown[] };

function installFakePool(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
  const globals = globalThis as typeof globalThis & {
    __cloudAuthoringSchemaReady?: Promise<void>;
    __cloudAuthoringMigrationsReady?: Promise<void>;
    __dashboardPgPool?: unknown;
  };
  const previousSchemaReady = globals.__cloudAuthoringSchemaReady;
  const previousMigrationsReady = globals.__cloudAuthoringMigrationsReady;
  const previousPool = globals.__dashboardPgPool;
  globals.__cloudAuthoringSchemaReady = Promise.resolve();
  globals.__cloudAuthoringMigrationsReady = Promise.resolve();
  globals.__dashboardPgPool = { query } as never;
  return () => {
    globals.__cloudAuthoringSchemaReady = previousSchemaReady;
    globals.__cloudAuthoringMigrationsReady = previousMigrationsReady;
    globals.__dashboardPgPool = previousPool;
  };
}

function fakeRows(rows: unknown[]) {
  return { rows };
}

test("resolveServerRequestContext trims and validates dashboard ownership and user membership", async () => {
  const queries: Query[] = [];
  const restore = installFakePool(async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("from workspace_dashboards")) {
      return fakeRows([{ workspace_id: "ws_default" }]);
    }
    if (sql.includes("from workspaces")) {
      return fakeRows([{ id: "ws_default" }]);
    }
    if (sql.includes("from workspace_users")) {
      return fakeRows([{ user_id: "usr_alice" }]);
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  try {
    const result = await resolveServerRequestContext(
      {
        workspaceId: " ws_default ",
        userId: " usr_alice ",
        dashboardId: " db_123 ",
      },
      { requireUser: true, requireDashboard: true },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.data : null, {
      workspaceId: "ws_default",
      userId: "usr_alice",
      dashboardId: "db_123",
    });
    assert.deepEqual(queries.map((query) => query.params), [
      ["db_123"],
      ["ws_default"],
      ["ws_default", "usr_alice"],
    ]);
  } finally {
    restore();
  }
});

test("resolveServerRequestContext rejects dashboard workspace mismatches", async () => {
  const restore = installFakePool(async (sql) => {
    if (sql.includes("from workspace_dashboards")) {
      return fakeRows([{ workspace_id: "ws_actual" }]);
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  try {
    const result = await resolveServerRequestContext(
      {
        workspaceId: "ws_claimed",
        userId: "usr_alice",
        dashboardId: "db_123",
      },
      { requireUser: true, requireDashboard: true },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.status, 404);
    assert.equal(result.ok ? null : result.reason, "DASHBOARD_NOT_FOUND");
  } finally {
    restore();
  }
});

test("resolveServerRequestContext rejects users outside the resolved workspace", async () => {
  const restore = installFakePool(async (sql) => {
    if (sql.includes("from workspace_dashboards")) {
      return fakeRows([{ workspace_id: "ws_default" }]);
    }
    if (sql.includes("from workspaces")) {
      return fakeRows([{ id: "ws_default" }]);
    }
    if (sql.includes("from workspace_users")) {
      return fakeRows([]);
    }
    throw new Error(`unexpected query: ${sql}`);
  });

  try {
    const result = await resolveServerRequestContext(
      {
        workspaceId: "ws_default",
        userId: "usr_eve",
        dashboardId: "db_123",
      },
      { requireUser: true, requireDashboard: true },
    );

    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.status, 403);
    assert.equal(result.ok ? null : result.reason, "WORKSPACE_USER_NOT_FOUND");
  } finally {
    restore();
  }
});

test("resolveServerRequestContext validates workspace-only requests", async () => {
  const restore = installFakePool(async (sql, params) => {
    assert.match(sql, /from workspaces/);
    assert.deepEqual(params, ["ws_default"]);
    return fakeRows([{ id: "ws_default" }]);
  });

  try {
    const result = await resolveServerRequestContext({ workspaceId: " ws_default " });

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.data : null, {
      workspaceId: "ws_default",
    });
  } finally {
    restore();
  }
});
