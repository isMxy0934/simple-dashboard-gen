import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("Phase B schema entrypoint delegates to the migration runner only", async () => {
  const source = await readFile(
    path.join(root, "src/server/cloud/schema.ts"),
    "utf8",
  );

  assert.match(source, /applyDbMigrations/);
  assert.doesNotMatch(source, /create\s+table\s+if\s+not\s+exists/i);
  assert.doesNotMatch(source, /alter\s+table/i);
  assert.doesNotMatch(source, /do\s+\$\$/i);
});

test("baseline migrations can build the target schema from an empty database", async () => {
  const migrationsDir = path.join(root, "src/server/db/migrations");
  const files = await readdir(migrationsDir);
  const baselineFiles = files
    .filter((file) => /^000[1-5]_.*\.sql$/.test(file))
    .sort();

  assert.deepEqual(baselineFiles, [
    "0001_workspace_identity.sql",
    "0002_datasource_connections.sql",
    "0003_dashboard_documents.sql",
    "0004_editing_collaboration.sql",
    "0005_authoring_runtime.sql",
  ]);

  const baselineSql = (
    await Promise.all(
      baselineFiles.map((file) => readFile(path.join(migrationsDir, file), "utf8")),
    )
  ).join("\n");

  for (const table of [
    "workspaces",
    "workspace_users",
    "workspace_user_settings",
    "datasource_connections",
    "workspace_dashboards",
    "workspace_dashboard_drafts",
    "workspace_dashboard_published",
    "editing_sessions",
    "editing_presence",
    "authoring_checks",
    "authoring_chat_events",
    "authoring_stream_leases",
    "authoring_tasks",
  ]) {
    assert.match(
      baselineSql,
      new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${table}`, "i"),
      `missing baseline DDL for ${table}`,
    );
  }
});

test("operational target tables are represented in additive migrations", async () => {
  const migrationsDir = path.join(root, "src/server/db/migrations");
  const sql = (
    await Promise.all(
      (await readdir(migrationsDir))
        .filter((file) => file.endsWith(".sql"))
        .sort()
        .map((file) => readFile(path.join(migrationsDir, file), "utf8")),
    )
  ).join("\n");

  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+user_preferences/i);
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+quota_usage/i);
});
