import { randomUUID } from "crypto";
import { ApiError } from "@/server/api-error";
import { assertCsrf } from "@/server/auth/csrf";
import {
  signSessionToken,
  verifySessionToken,
} from "@/server/auth/jwt";
import {
  readSessionTokenFromRequest,
} from "@/server/auth/require-session";
import { assertSessionNotRevoked } from "@/server/auth/session-revocations";
import { apiErrorToResponse } from "@/server/auth/route-helpers";
import { createSessionCookie } from "@/server/auth/session-cookie";
import { assertRateLimit } from "@/server/guards/rate-limit";

function refreshGraceSeconds(): number {
  const hours = Number(process.env.SDS_SESSION_REFRESH_GRACE_HOURS ?? "24");
  return (Number.isInteger(hours) && hours > 0 ? hours : 24) * 60 * 60;
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
          "set-cookie": createSessionCookie(request, nextToken),
        },
      },
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
