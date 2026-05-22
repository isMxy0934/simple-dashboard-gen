import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function fullPath(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  return readFileSync(fullPath(relativePath), "utf8");
}

function assertFileMissing(relativePath) {
  if (existsSync(fullPath(relativePath))) {
    errors.push(`${relativePath} must not exist`);
  }
}

function assertFileExists(relativePath) {
  if (!existsSync(fullPath(relativePath))) {
    errors.push(`${relativePath} must exist`);
  }
}

function assertNoMatch(relativePath, pattern, label) {
  if (!existsSync(fullPath(relativePath))) {
    errors.push(`${relativePath} must exist before checking ${label}`);
    return;
  }

  if (pattern.test(read(relativePath))) {
    errors.push(`${relativePath} contains ${label}`);
  }
}

function assertMatch(relativePath, pattern, label) {
  if (!existsSync(fullPath(relativePath))) {
    errors.push(`${relativePath} must exist before checking ${label}`);
    return;
  }

  if (!pattern.test(read(relativePath))) {
    errors.push(`${relativePath} is missing ${label}`);
  }
}

assertFileMissing("src/server/request-context.ts");
assertFileMissing("src/web/auth/auth-session.ts");
assertFileExists("docs/archive/migration-2026-q2.md");
assertFileExists("docs/operations.md");
assertFileExists("docs/audit/dashboard-usage.md");
assertNoMatch("docs/architecture.md", /🟡|🔴/, "non-final status markers");
assertNoMatch("docs/audit/route-inventory.md", /\[ \]/, "unchecked route inventory rows");
assertMatch(
  "docs/audit/route-inventory.md",
  /\| `\/api\/query\/execute-batch` \| POST \| session\.workspaceId \| dashboard\.read \| \[x\] \|/,
  "final execute-batch route inventory row",
);

for (const file of [
  "src/server/dashboards/service.ts",
  "src/server/authoring/editing-session-service.ts",
  "src/server/authoring/chat-request.ts",
]) {
  assertNoMatch(file, /resolveServerRequestContext|@\/server\/request-context/, "legacy request context");
}

const packageJson = JSON.parse(read("package.json"));
const expectedScripts = {
  "script:check-i18n": "node scripts/check-i18n.mjs",
  "audit:dashboard-usage": "node scripts/audit-dashboard-usage.mjs",
  "check:final": "node scripts/check-final-acceptance.mjs",
};

for (const [scriptName, expected] of Object.entries(expectedScripts)) {
  if (packageJson.scripts?.[scriptName] !== expected) {
    errors.push(`package.json ${scriptName} must be ${JSON.stringify(expected)}`);
  }
}

if (packageJson.scripts?.["test:contract"] !== "node scripts/run-contract-tests.mjs") {
  errors.push("package.json test:contract must use scripts/run-contract-tests.mjs");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Final acceptance static check passed.");
