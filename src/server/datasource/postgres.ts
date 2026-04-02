import "server-only";

import { Pool } from "pg";

declare global {
  var __dashboardPgPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is missing.");
  }

  return new Pool({
    connectionString,
  });
}

export function getPgPool() {
  if (!globalThis.__dashboardPgPool) {
    globalThis.__dashboardPgPool = createPool();
  }

  return globalThis.__dashboardPgPool;
}
