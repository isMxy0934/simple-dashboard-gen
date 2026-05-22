import "server-only";

import { ApiError } from "@/server/api-error";
import { Permission, requirePermission } from "./permissions";
import { requireServerSession, type UserSession } from "./require-session";

export function apiErrorToResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json(
      {
        status_code: error.status,
        reason: error.code,
        message_i18n_key: error.i18nKey,
        data: error.payload ?? null,
      },
      { status: error.status },
    );
  }

  return Response.json(
    {
      status_code: 500,
      reason: "INTERNAL_SERVER_ERROR",
      data: null,
    },
    { status: 500 },
  );
}

export async function requireApiSession(
  request: Request,
  permission: Permission,
  options: { skipCsrf?: boolean } = {},
): Promise<UserSession> {
  const session = await requireServerSession(request, options);
  requirePermission(session.permissions, permission);
  return session;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
