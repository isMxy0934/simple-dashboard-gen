import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";
import type { QueryablePool } from "../src/server/cloud/workspace-repository.ts";

register("./ts-paths-loader.mjs", import.meta.url);

const workspaceRepository = await import("../src/server/cloud/workspace-repository.ts");
const workspaceService = await import("../src/server/workspace/service.ts");

test("workspace context includes current user, role catalog, and user roles", async () => {
  const pool = {
    async query(sql: string) {
      if (sql.includes("from workspaces")) {
        return { rows: [{ id: "ws_default", name: "Mercaso" }] };
      }
      if (sql.includes("from workspace_roles")) {
        return {
          rows: [
            {
              role_id: "viewer",
              name: "Viewer",
              permissions: ["dashboard.read", "datasource.read"],
            },
            {
              role_id: "editor",
              name: "Editor",
              permissions: [
                "dashboard.edit",
                "dashboard.publish",
                "dashboard.read",
                "datasource.read",
              ],
            },
            {
              role_id: "admin",
              name: "Admin",
              permissions: [
                "dashboard.edit",
                "dashboard.publish",
                "dashboard.read",
                "datasource.manage",
                "datasource.read",
                "workspace.admin",
              ],
            },
          ],
        };
      }
      if (sql.includes("from workspace_users")) {
        return {
          rows: [
            {
              workspace_id: "ws_default",
              user_id: "usr_alice",
              name: "Alice",
              email: "alice@example.com",
              role_id: "admin",
              role_name: "Admin",
            },
            {
              workspace_id: "ws_default",
              user_id: "usr_bob",
              name: "Bob",
              email: "bob@example.com",
              role_id: "editor",
              role_name: "Editor",
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as QueryablePool;

  const context = await workspaceRepository.getWorkspaceContext("ws_default", {
    currentUserId: "usr_alice",
    currentUserPermissions: ["dashboard.read", "workspace.admin"],
    pool,
  });

  assert.deepEqual(context, {
    workspace_id: "ws_default",
    workspace_name: "Mercaso",
    current_user_id: "usr_alice",
    current_user_permissions: ["dashboard.read", "workspace.admin"],
    roles: [
      {
        role_id: "viewer",
        name: "Viewer",
        permissions: ["dashboard.read", "datasource.read"],
      },
      {
        role_id: "editor",
        name: "Editor",
        permissions: [
          "dashboard.edit",
          "dashboard.publish",
          "dashboard.read",
          "datasource.read",
        ],
      },
      {
        role_id: "admin",
        name: "Admin",
        permissions: [
          "dashboard.edit",
          "dashboard.publish",
          "dashboard.read",
          "datasource.manage",
          "datasource.read",
          "workspace.admin",
        ],
      },
    ],
    users: [
      {
        workspace_id: "ws_default",
        user_id: "usr_alice",
        name: "Alice",
        email: "alice@example.com",
        role_id: "admin",
        role_name: "Admin",
      },
      {
        workspace_id: "ws_default",
        user_id: "usr_bob",
        name: "Bob",
        email: "bob@example.com",
        role_id: "editor",
        role_name: "Editor",
      },
    ],
  });
});

test("workspace role update replaces a user's single role and requires relogin", async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      queries.push(sql);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("from workspace_users") && sql.includes("for update")) {
        return {
          rows: [
            {
              workspace_id: "ws_default",
              user_id: "usr_bob",
              name: "Bob",
              email: "bob@example.com",
            },
          ],
        };
      }
      if (sql.includes("from workspace_roles") && sql.includes("role_id = $2")) {
        return {
          rows: [{ role_id: params?.[1], name: "Viewer" }],
        };
      }
      if (sql.includes("from workspace_user_roles")) {
        return { rows: [{ role_id: "editor" }] };
      }
      if (sql.includes("delete from workspace_user_roles")) {
        return { rows: [] };
      }
      if (sql.includes("insert into workspace_user_roles")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as QueryablePool;

  const result = await workspaceRepository.updateWorkspaceUserRole(
    {
      workspaceId: "ws_default",
      userId: "usr_bob",
      roleId: "viewer",
    },
    { pool },
  );

  assert.equal(result.requires_relogin, true);
  assert.equal(result.user.role_id, "viewer");
  assert.ok(queries.some((sql) => sql.includes("delete from workspace_user_roles")));
  assert.ok(queries.some((sql) => sql.includes("insert into workspace_user_roles")));
});

test("workspace role update prevents demoting the last admin", async () => {
  const pool = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("from workspace_users") && sql.includes("for update")) {
        return {
          rows: [
            {
              workspace_id: "ws_default",
              user_id: "usr_alice",
              name: "Alice",
              email: "alice@example.com",
            },
          ],
        };
      }
      if (sql.includes("from workspace_roles") && sql.includes("role_id = $2")) {
        return { rows: [{ role_id: "viewer", name: "Viewer" }] };
      }
      if (sql.includes("select role_id") && sql.includes("from workspace_user_roles")) {
        return { rows: [{ role_id: "admin" }] };
      }
      if (sql.includes("count(distinct user_id)")) {
        return { rows: [{ admin_count: "1" }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as QueryablePool;

  await assert.rejects(
    () =>
      workspaceRepository.updateWorkspaceUserRole(
        {
          workspaceId: "ws_default",
          userId: "usr_alice",
          roleId: "viewer",
        },
        { pool },
      ),
    /LAST_ADMIN_ROLE_REQUIRED/,
  );
});

test("workspace role update reports missing target users", async () => {
  const pool = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      if (sql.includes("from workspace_users") && sql.includes("for update")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as QueryablePool;

  await assert.rejects(
    () =>
      workspaceRepository.updateWorkspaceUserRole(
        {
          workspaceId: "ws_default",
          userId: "usr_missing",
          roleId: "viewer",
        },
        { pool },
      ),
    /WORKSPACE_USER_NOT_FOUND/,
  );
});

test("workspace role service rejects invalid role ids", async () => {
  const result = await workspaceService.updateWorkspaceUserRoleService({
    workspaceId: "ws_default",
    userId: "usr_bob",
    roleId: "owner",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
    assert.equal(result.code, "INVALID_WORKSPACE_ROLE_REQUEST");
  }
});

test("workspace user role route requires workspace admin permission", async () => {
  const source = await readFile(
    new URL(
      "../src/app/api/workspace/users/[userId]/role/route.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /requireApiSession\(request,\s*Permission\.WorkspaceAdmin\)/);
});

test("users panel exposes role controls and removes current-user switching", async () => {
  const source = await readFile(
    new URL("../src/web/management/ui/users-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /useAsCurrent/);
  assert.doesNotMatch(source, /onSelectUser/);
  assert.match(source, /onRoleChange/);
  assert.match(source, /currentUserId/);
  assert.match(source, /viewer/);
  assert.match(source, /editor/);
  assert.match(source, /admin/);
});
