import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const testDir = path.join(root, "tests-contract");
const testFiles = readdirSync(testDir)
  .filter((entry) => entry.endsWith(".contract.test.ts"))
  .sort()
  .map((entry) => path.join("tests-contract", entry));

const nodeArgs = ["--test", "--experimental-strip-types"];
if (process.argv.includes("--coverage")) {
  nodeArgs.push("--experimental-test-coverage");
}
nodeArgs.push(...testFiles);

const result = spawnSync(process.execPath, nodeArgs, {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit",
});

process.exit(result.status ?? 1);
