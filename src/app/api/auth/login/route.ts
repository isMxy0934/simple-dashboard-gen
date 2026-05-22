import { randomUUID } from "crypto";
import { assertCsrf } from "@/server/auth/csrf";
import { signSessionToken } from "@/server/auth/jwt";
import { Permission } from "@/server/auth/permissions";
import { apiErrorToResponse } from "@/server/auth/route-helpers";
import { assertRateLimit } from "@/server/guards/rate-limit";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_USER_ID,
} from "@/shared/workspace-defaults";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveUserId(identity: unknown): string {
  if (typeof identity !== "string") {
    return DEFAULT_WORKSPACE_USER_ID;
  }
  const normalized = identity.trim().toLowerCase();
  if (normalized.includes("bob")) {
    return "usr_bob";
  }
  if (normalized.includes("chen")) {
    return "usr_chen";
  }
  return DEFAULT_WORKSPACE_USER_ID;
}

function cookieMaxAgeSeconds(): number {
  const days = Number(process.env.SDS_SESSION_TTL_DAYS ?? "7");
  return (Number.isInteger(days) && days > 0 ? days : 7) * 24 * 60 * 60;
}

function secureCookieAttribute(request: Request): string {
  return new URL(request.url).protocol === "https:" ||
    process.env.NODE_ENV === "production"
    ? "; Secure"
    : "";
}

function sessionCookie(request: Request, token: string): string {
  return [
    `sds_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${cookieMaxAgeSeconds()}`,
    secureCookieAttribute(request),
  ]
    .filter(Boolean)
    .join("; ");
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
    const token = await signSessionToken({
      userId: resolveUserId(isRecord(payload) ? payload.identity : undefined),
      workspaceId: DEFAULT_WORKSPACE_ID,
      permissions: [
        Permission.DashboardRead,
        Permission.DashboardEdit,
        Permission.DashboardPublish,
        Permission.DatasourceRead,
        Permission.DatasourceManage,
        Permission.WorkspaceAdmin,
      ],
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
          "set-cookie": sessionCookie(request, token),
        },
      },
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }
}
