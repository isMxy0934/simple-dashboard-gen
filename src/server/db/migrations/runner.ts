import "server-only";

import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface QueryablePool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface ApplyDbMigrationsOptions {
  pool: QueryablePool;
  migrationsDir: string;
}

const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    seq         text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now(),
    checksum    text NOT NULL
  );
`;

export async function applyDbMigrations(options: ApplyDbMigrationsOptions): Promise<void> {
  const { pool, migrationsDir } = options;

  await pool.query(BOOTSTRAP_SQL);

  const applied = await pool.query(
    "SELECT seq, checksum FROM schema_migrations",
  ) as { rows: Array<{ seq: string; checksum: string }> };
  const appliedMap = new Map(applied.rows.map((row) => [row.seq, row.checksum]));

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const seq = file.split("_")[0];
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    const previousChecksum = appliedMap.get(seq);

    if (previousChecksum) {
      if (previousChecksum !== checksum) {
        throw new Error(`Migration ${file} checksum mismatch. Stored=${previousChecksum}, current=${checksum}.`);
      }
      continue;
    }

    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(
        "INSERT INTO schema_migrations (seq, checksum) VALUES ($1, $2)",
        [seq, checksum],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}
