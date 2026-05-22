import "server-only";

import path from "node:path";
import { applyDbMigrations } from "@/server/db/migrations/runner";
import { getPgPool } from "@/server/datasource/postgres";

declare global {
  var __cloudAuthoringMigrationsReady: Promise<void> | undefined;
}

export function resolveCloudAuthoringMigrationsDir(): string {
  return path.join(process.cwd(), "src/server/db/migrations");
}

export async function ensureCloudAuthoringSchema(): Promise<void> {
  if (!globalThis.__cloudAuthoringMigrationsReady) {
    globalThis.__cloudAuthoringMigrationsReady = applyDbMigrations({
      pool: getPgPool(),
      migrationsDir: resolveCloudAuthoringMigrationsDir(),
    });
  }

  await globalThis.__cloudAuthoringMigrationsReady;
}
