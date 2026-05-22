import { randomUUID } from "crypto";
import { ApiError } from "@/server/api-error";
import { assertCsrf } from "@/server/auth/csrf";
import {
  signSessionToken,
  verifySessionToken,
} from "@/server/auth/jwt";
import {
  readSessionTokenFromRequest,
  SESSION_COOKIE_NAME,
} from "@/server/auth/require-session";
import { assertSessionNotRevoked } from "@/server/auth/session-revocations";
import { apiErrorToResponse } from "@/server/auth/route-helpers";
import { assertRateLimit } from "@/server/guards/rate-limit";

function secureCookieAttribute(request: Request): string {
  return new URL(request.url).protocol === "https:" ||
    process.env.NODE_ENV === "production"
    ? "; Secure"
    : "";
}

function sessionTtlDays(): number {
  const days = Number(process.env.SDS_SESSION_TTL_DAYS ?? "7");
  return Number.isInteger(days) && days > 0 ? days : 7;
}

function refreshGraceSeconds(): number {
  const hours = Number(process.env.SDS_SESSION_REFRESH_GRACE_HOURS ?? "24");
  return (Number.isInteger(hours) && hours > 0 ? hours : 24) * 60 * 60;
}

function sessionCookie(request: Request, token: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${sessionTtlDays() * 24 * 60 * 60}`,
    secureCookieAttribute(request),
  ]
    .filter(Boolean)
    .join("; ");
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertCsrf(request);
    const token = readSessionTokenFromRequest(request);
    if (!token) {
      throw new ApiError(401, "AUTH_REQUIRED", "error.auth.required");
    }

    const claims = await verifySessionToken(token, {
      allowExpiredWithinGraceSeconds: refreshGraceSeconds(),
    });
    await assertSessionNotRevoked(claims.jti);
    await assertRateLimit("auth.refresh", claims.jti, {
      sessionId: claims.jti,
      requestId: request.headers.get("x-request-id") ?? null,
    });

    const nextToken = await signSessionToken({
      userId: claims.userId,
      workspaceId: claims.workspaceId,
      permissions: claims.permissions,
    });

    return Response.json(
      {
        status_code: 200,
        reason: "OK",
        data: {
          request_id: randomUUID(),
        },
      },
      {
        status: 200,
        headers: {
          "set-cookie": sessionCookie(request, nextToken),
        },
      },
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
