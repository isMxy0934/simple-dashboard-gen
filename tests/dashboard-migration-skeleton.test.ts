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

test("migrateToCurrent forces migrated dashboard documents to current schema version", () => {
  const document = {
    schema_version: "0.x",
    dashboard_spec: { schema_version: "0.3", views: [] },
    query_defs: [],
    bindings: [],
  };

  const migrated = migrations.migrateToCurrent(document);

  assert.ok(migrated && typeof migrated === "object");
  assert.equal((migrated as typeof document).schema_version, "1.0");
  assert.equal((migrated as typeof document).dashboard_spec.schema_version, "0.3");
});
