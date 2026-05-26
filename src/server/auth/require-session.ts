import "server-only";

import { randomUUID } from "crypto";
import type { Permission } from "./permissions";
import { ApiError } from "@/server/api-error";
import { getPgPool } from "@/server/datasource/postgres";
import { assertCsrf } from "./csrf";
import { verifySessionToken } from "./jwt";
import {
  assertSessionNotRevoked,
  type QueryablePool,
} from "./session-revocations";

export interface UserSession {
  userId: string;
  workspaceId: string;
  permissions: Set<Permission>;
  sessionId: string;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = "sds_session";

function parseCookieHeader(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) {
    return cookies;
  }

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();
    if (!name) {
      continue;
    }
    cookies.set(name, decodeURIComponent(rawValue.join("=").trim()));
  }
  return cookies;
}

function requestIdFromHeaders(req: Request): string {
  const header = req.headers.get("x-request-id")?.trim();
  return header || randomUUID();
}

function hasConfiguredDatabase(): boolean {
  return Boolean(process.env.SDS_DATABASE_URL || process.env.DATABASE_URL);
}

function shouldUseClaimPermissions(options: { pool?: QueryablePool }): boolean {
  return (
    !options.pool &&
    !hasConfiguredDatabase() &&
    process.env.NODE_ENV !== "production"
  );
}

async function resolveCurrentSessionPermissions(
  claims: { userId: string; workspaceId: string; permissions: Permission[] },
  options: { pool?: QueryablePool },
): Promise<Permission[]> {
  if (shouldUseClaimPermissions(options)) {
    return claims.permissions;
  }

  const pool = options.pool ?? getPgPool();
  const result = await pool.query(
    `
      select distinct rp.permission
      from workspace_user_roles ur
      join workspace_role_permissions rp
        on rp.workspace_id = ur.workspace_id
       and rp.role_id = ur.role_id
      where ur.workspace_id = $1
        and ur.user_id = $2
      order by rp.permission
    `,
    [claims.workspaceId, claims.userId],
  );
  const tokenPermissions = new Set(claims.permissions);
  return result.rows
    .map((row) => row.permission)
    .filter((permission): permission is Permission =>
      typeof permission === "string" && tokenPermissions.has(permission as Permission),
    );
}

export function readSessionTokenFromRequest(req: Request): string | null {
  return parseCookieHeader(req.headers.get("cookie")).get(SESSION_COOKIE_NAME) ?? null;
}

export async function requireServerSession(
  req: Request,
  opts: { skipCsrf?: boolean; pool?: QueryablePool } = {},
): Promise<UserSession> {
  const token = readSessionTokenFromRequest(req);
  if (!token) {
    throw new ApiError(401, "AUTH_REQUIRED", "error.auth.required");
  }

  const claims = await verifySessionToken(token);
  await assertSessionNotRevoked(claims.jti, opts);
  if (!opts.skipCsrf) {
    assertCsrf(req);
  }
  const permissions = await resolveCurrentSessionPermissions(claims, opts);

  return {
    userId: claims.userId,
    workspaceId: claims.workspaceId,
    permissions: new Set<Permission>(permissions),
    sessionId: claims.jti,
    requestId: requestIdFromHeaders(req),
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  };
}
