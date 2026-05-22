import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const schemaVersion = await import("../src/contracts/schema-version.ts");

test("schema version contracts keep document and legacy spec versions separate", () => {
  assert.equal(schemaVersion.CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION, "1.0");
  assert.equal(schemaVersion.LEGACY_DASHBOARD_SPEC_SCHEMA_VERSION, "0.3");
});
