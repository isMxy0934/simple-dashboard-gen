import { readSessionTokenFromRequest } from "@/server/auth/require-session";
import { assertCsrf } from "@/server/auth/csrf";
import { verifySessionToken } from "@/server/auth/jwt";
import { revokeSessionJti } from "@/server/auth/session-revocations";
import { apiErrorToResponse } from "@/server/auth/route-helpers";
import { ApiError } from "@/server/api-error";

function secureCookieAttribute(request: Request): string {
  return new URL(request.url).protocol === "https:" ||
    process.env.NODE_ENV === "production"
    ? "; Secure"
    : "";
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertCsrf(request);
    const token = readSessionTokenFromRequest(request);
    if (!token) {
      throw new ApiError(401, "AUTH_REQUIRED", "error.auth.required");
    }
    const claims = await verifySessionToken(token);
    await revokeSessionJti({ jti: claims.jti, expiresAt: claims.exp });
  } catch (error) {
    return apiErrorToResponse(error);
  }

  return Response.json(
    { status_code: 200, reason: "OK", data: null },
    {
      status: 200,
      headers: {
        "set-cookie": [
          "sds_session=",
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          "Max-Age=0",
          secureCookieAttribute(request),
        ]
          .filter(Boolean)
          .join("; "),
      },
    },
  );
}
