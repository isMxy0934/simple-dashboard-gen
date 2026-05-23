import "server-only";

import { ApiError } from "@/server/api-error";
import { ensureCloudAuthoringSchema } from "@/server/cloud/schema";
import { getPgPool } from "@/server/datasource/postgres";

export interface QueryablePool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

interface RevocationCacheEntry {
  revoked: boolean;
  checkedAt: number;
}

declare global {
  var __sdsSessionRevocationCache:
    | Map<string, RevocationCacheEntry>
    | undefined;
}

const REVOCATION_CACHE_TTL_MS = 60_000;

function cache(): Map<string, RevocationCacheEntry> {
  if (!globalThis.__sdsSessionRevocationCache) {
    globalThis.__sdsSessionRevocationCache = new Map();
  }
  return globalThis.__sdsSessionRevocationCache;
}

function hasConfiguredDatabase(): boolean {
  return Boolean(process.env.SDS_DATABASE_URL || process.env.DATABASE_URL);
}

function shouldSkipDatabase(options?: { pool?: QueryablePool }): boolean {
  return (
    !options?.pool &&
    !hasConfiguredDatabase() &&
    process.env.NODE_ENV !== "production"
  );
}

function resolvePool(options?: { pool?: QueryablePool }): QueryablePool {
  return options?.pool ?? getPgPool();
}

async function ensureSessionRevocationStoreReady(options?: {
  pool?: QueryablePool;
}): Promise<void> {
  if (!options?.pool) {
    await ensureCloudAuthoringSchema();
  }
}

export async function revokeSessionJti(
  input: { jti: string; expiresAt: number },
  options: { pool?: QueryablePool } = {},
): Promise<void> {
  const jti = input.jti.trim();
  if (!jti) {
    return;
  }
  if (shouldSkipDatabase(options)) {
    cache().set(jti, { revoked: true, checkedAt: Date.now() });
    return;
  }

  await ensureSessionRevocationStoreReady(options);
  await resolvePool(options).query(
    `
      insert into session_revocations (jti, expires_at)
      values ($1, $2)
      on conflict (jti) do update
      set expires_at = greatest(session_revocations.expires_at, excluded.expires_at)
    `,
    [jti, new Date(input.expiresAt * 1000)],
  );
  cache().set(jti, { revoked: true, checkedAt: Date.now() });
}

export async function assertSessionNotRevoked(
  jti: string,
  options: { pool?: QueryablePool } = {},
): Promise<void> {
  const normalized = jti.trim();
  if (!normalized) {
    throw new ApiError(401, "INVALID_SESSION", "error.auth.invalid_session");
  }

  const cached = cache().get(normalized);
  if (cached && Date.now() - cached.checkedAt <= REVOCATION_CACHE_TTL_MS) {
    if (cached.revoked) {
      throw new ApiError(401, "SESSION_REVOKED", "error.auth.session_revoked");
    }
    return;
  }

  if (shouldSkipDatabase(options)) {
    return;
  }

  await ensureSessionRevocationStoreReady(options);
  const result = await resolvePool(options).query(
    `
      select jti
      from session_revocations
      where jti = $1
        and expires_at > now()
      limit 1
    `,
    [normalized],
  );
  const revoked = result.rows.length > 0;
  cache().set(normalized, { revoked, checkedAt: Date.now() });

  if (revoked) {
    throw new ApiError(401, "SESSION_REVOKED", "error.auth.session_revoked");
  }
}

export function resetSessionRevocationCacheForTests(): void {
  cache().clear();
}
