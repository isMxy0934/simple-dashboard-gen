import "server-only";

import { randomUUID } from "crypto";
import type { Permission } from "./permissions";
import { ApiError } from "@/server/api-error";
import { assertCsrf } from "./csrf";
import { verifySessionToken } from "./jwt";
import { assertSessionNotRevoked } from "./session-revocations";

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

export function readSessionTokenFromRequest(req: Request): string | null {
  return parseCookieHeader(req.headers.get("cookie")).get(SESSION_COOKIE_NAME) ?? null;
}

export async function requireServerSession(
  req: Request,
  opts: { skipCsrf?: boolean } = {},
): Promise<UserSession> {
  const token = readSessionTokenFromRequest(req);
  if (!token) {
    throw new ApiError(401, "AUTH_REQUIRED", "error.auth.required");
  }

  const claims = await verifySessionToken(token);
  await assertSessionNotRevoked(claims.jti);
  if (!opts.skipCsrf) {
    assertCsrf(req);
  }

  return {
    userId: claims.userId,
    workspaceId: claims.workspaceId,
    permissions: new Set<Permission>(claims.permissions),
    sessionId: claims.jti,
    requestId: requestIdFromHeaders(req),
    issuedAt: claims.iat,
    expiresAt: claims.exp,
  };
}
