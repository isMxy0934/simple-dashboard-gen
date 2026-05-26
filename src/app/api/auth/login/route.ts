import { randomUUID } from "crypto";
import { assertCsrf } from "@/server/auth/csrf";
import { resolveAppUserForIdentity } from "@/server/auth/app-user-resolver";
import { signSessionToken } from "@/server/auth/jwt";
import { verifyLocalCredentials } from "@/server/auth/local-identity-provider";
import { apiErrorToResponse } from "@/server/auth/route-helpers";
import { createSessionCookie } from "@/server/auth/session-cookie";
import { assertRateLimit } from "@/server/guards/rate-limit";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidCredentialsResponse(): Response {
  return Response.json(
    {
      status_code: 401,
      reason: "INVALID_CREDENTIALS",
      message_i18n_key: "error.auth.invalid_credentials",
      data: null,
    },
    { status: 401 },
  );
}

function requestIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function POST(request: Request): Promise<Response> {
  try {
    await assertRateLimit("auth.login", requestIp(request));
    assertCsrf(request);
  } catch (error) {
    return apiErrorToResponse(error);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  try {
    const identity = isRecord(payload) ? payload.identity : undefined;
    const password = isRecord(payload) ? payload.password : undefined;
    const normalizedIdentity = await verifyLocalCredentials({ identity, password });
    if (!normalizedIdentity) {
      return invalidCredentialsResponse();
    }

    const appUser = await resolveAppUserForIdentity(normalizedIdentity);
    if (!appUser || appUser.permissions.length === 0) {
      return invalidCredentialsResponse();
    }

    const token = await signSessionToken({
      userId: appUser.userId,
      workspaceId: appUser.workspaceId,
      permissions: appUser.permissions,
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
          "set-cookie": createSessionCookie(request, token),
        },
      },
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
