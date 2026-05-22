import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { ApiError } = await import("../src/server/api-error.ts");

test("ApiError carries status, code, i18n key, and payload", () => {
  const error = new ApiError(403, "FORBIDDEN", "error.auth.forbidden", { permission: "dashboard.edit" });

  assert.equal(error.status, 403);
  assert.equal(error.code, "FORBIDDEN");
  assert.equal(error.i18nKey, "error.auth.forbidden");
  assert.deepEqual(error.payload, { permission: "dashboard.edit" });
  assert.equal(error.name, "ApiError");
});
