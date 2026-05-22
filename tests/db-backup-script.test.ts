import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("db backup script supports a dry-run with redacted connection details", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/db-backup.mjs",
      "--dry-run",
      "--output-dir",
      "/tmp/sds-backups",
      "--database-url",
      "postgresql://user:secret@example.invalid:5432/app",
      "--label",
      "pre-sprint-6",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /pg_dump -Fc/);
  assert.match(result.stdout, /pg_restore --list/);
  assert.match(result.stdout, /pre-sprint-6-\d{8}-\d{6}\.dump/);
  assert.match(result.stdout, /postgresql:\/\/user:\*\*\*@example\.invalid:5432\/app/);
  assert.doesNotMatch(result.stdout, /secret/);
});
