import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("script:check-env passes for the checked-in config and env example", () => {
  const result = spawnSync(process.execPath, ["scripts/check-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /ENV check passed/);
});
