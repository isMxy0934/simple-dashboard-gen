import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-strip-types", "tests/web-foundation-skeleton.test.ts"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
