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
