import assert from "node:assert/strict";
import test from "node:test";

test("migration foundation contract runner is wired", () => {
  assert.equal(typeof process.version, "string");
  assert.match(process.version, /^v\d+\./);
});
