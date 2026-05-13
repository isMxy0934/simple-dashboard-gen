import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { normalizeSchemaAllowlist } = await import(
  "../src/shared/datasource-schema-allowlist.ts"
);

test("schema allowlist normalizes comma-separated user input", () => {
  assert.deepEqual(
    normalizeSchemaAllowlist("system_test, analytics , system_test, "),
    ["system_test", "analytics"],
  );
});

test("schema allowlist ignores non-string and empty values", () => {
  assert.deepEqual(
    normalizeSchemaAllowlist(["system_test", "", 123, " public "]),
    ["system_test", "public"],
  );
  assert.equal(normalizeSchemaAllowlist(" , "), undefined);
  assert.equal(normalizeSchemaAllowlist(null), undefined);
});
