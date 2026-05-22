import {
  handleAuthoringSessionGetRoute,
  handleAuthoringSessionListRoute,
  handleAuthoringSessionPutRoute,
} from "@/server/authoring/session-service";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function rewriteGetUrl(request: Request, url: URL) {
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const chatSessionId = url.searchParams.get("chatSessionId")?.trim();

  if (url.searchParams.has("sessionId")) {
    return null;
  }

  if (!dashboardId) {
    return null;
  }

  const session = await requireApiSession(
    request,
    Permission.DashboardRead,
    { skipCsrf: true },
  );

  if (chatSessionId) {
    url.searchParams.set(
      "sessionId",
      buildAuthoringCompositeSessionId({
        workspaceId: session.workspaceId,
        userId: session.userId,
        dashboardId,
        sessionId: chatSessionId,
      }),
    );
    return {
      kind: "get" as const,
      url,
    };
  }

  url.searchParams.set(
    "sessionIdPrefix",
    `${session.workspaceId}:${session.userId}:${dashboardId}:`,
  );
  return {
    kind: "list" as const,
    url,
  };
}

export async function GET(request: Request): Promise<Response> {
  let rewritten;
  try {
    rewritten = await rewriteGetUrl(request, new URL(request.url));
  } catch (error) {
    return apiErrorToResponse(error);
  }
  if (!rewritten) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_UI_SESSION_SCOPE", data: null },
      { status: 400 },
    );
  }
  const forwardedRequest = new Request(rewritten.url.toString(), {
    method: "GET",
    headers: request.headers,
  });
  if (rewritten.kind === "list") {
    return handleAuthoringSessionListRoute(forwardedRequest);
  }
  return handleAuthoringSessionGetRoute(forwardedRequest);
}

export async function PUT(request: Request): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.dashboardId) ||
    !isNonEmptyString(payload.chatSessionId) ||
    "sessionId" in payload
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_AUTHORING_UI_SESSION_REQUEST", data: null },
      { status: 400 },
    );
  }

  let session;
  try {
    session = await requireApiSession(request, Permission.DashboardEdit);
  } catch (error) {
    return apiErrorToResponse(error);
  }

  const forwardedRequest = new Request(request.url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      workspaceId: session.workspaceId,
      userId: session.userId,
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId: session.workspaceId,
        userId: session.userId,
        dashboardId: payload.dashboardId.trim(),
        sessionId: payload.chatSessionId.trim(),
      }),
    }),
  });

  return handleAuthoringSessionPutRoute(forwardedRequest);
}
