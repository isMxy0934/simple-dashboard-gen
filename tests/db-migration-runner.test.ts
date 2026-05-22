import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { register } from "node:module";

register("./ts-paths-loader.mjs", import.meta.url);

const { applyDbMigrations } = await import("../src/server/db/migrations/runner.ts");

test("applyDbMigrations bootstraps schema_migrations and applies sql files once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sds-migrations-"));
  await writeFile(path.join(dir, "0006_example.sql"), "create table example (id text primary key);\n");

  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (/SELECT seq, checksum FROM schema_migrations/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };

  await applyDbMigrations({ pool, migrationsDir: dir });

  assert.match(queries[0].sql, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.equal(queries.some((query) => query.sql === "BEGIN"), true);
  assert.equal(queries.some((query) => query.sql.includes("create table example")), true);
  assert.equal(queries.some((query) => query.sql.includes("INSERT INTO schema_migrations")), true);
  assert.equal(queries.some((query) => query.sql === "COMMIT"), true);
});

test("applyDbMigrations rejects changed applied migration checksums", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sds-migrations-"));
  await writeFile(path.join(dir, "0006_example.sql"), "select 1;\n");

  const pool = {
    async query(sql: string) {
      if (/SELECT seq, checksum FROM schema_migrations/.test(sql)) {
        return { rows: [{ seq: "0006", checksum: "different" }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(() => applyDbMigrations({ pool, migrationsDir: dir }), /checksum mismatch/);
});
