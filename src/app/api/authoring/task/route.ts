import {
  handleAuthoringTaskGetRoute,
  handleAuthoringTaskPostRoute,
} from "@/server/authoring/task-service";
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

async function rewriteChatSessionId(
  request: Request,
  url: URL,
): Promise<URL | Response> {
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const chatSessionId = url.searchParams.get("chatSessionId")?.trim();

  if (url.searchParams.has("sessionId")) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_TASK_SCOPE", data: null },
      { status: 400 },
    );
  }

  if (!dashboardId || !chatSessionId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_TASK_SCOPE", data: null },
      { status: 400 },
    );
  }

  let session;
  try {
    session = await requireApiSession(
      request,
      Permission.DashboardRead,
      { skipCsrf: true },
    );
  } catch (error) {
    return apiErrorToResponse(error);
  }

  url.searchParams.set(
    "sessionId",
    buildAuthoringCompositeSessionId({
      workspaceId: session.workspaceId,
      userId: session.userId,
      dashboardId,
      sessionId: chatSessionId,
    }),
  );
  return url;
}

export async function GET(request: Request): Promise<Response> {
  const rewritten = await rewriteChatSessionId(request, new URL(request.url));
  if (rewritten instanceof Response) {
    return rewritten;
  }
  const forwardedRequest = new Request(rewritten.toString(), {
    method: "GET",
    headers: request.headers,
  });
  return handleAuthoringTaskGetRoute(forwardedRequest);
}

export async function POST(request: Request): Promise<Response> {
  let session;
  try {
    session = await requireApiSession(request, Permission.DashboardEdit);
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

  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.dashboardId) ||
    !isNonEmptyString(payload.chatSessionId) ||
    "sessionId" in payload
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_AUTHORING_TASK_REQUEST", data: null },
      { status: 400 },
    );
  }

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      workspaceId: session.workspaceId,
      userId: session.userId,
      dashboardId: payload.dashboardId.trim(),
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId: session.workspaceId,
        userId: session.userId,
        dashboardId: payload.dashboardId.trim(),
        sessionId: payload.chatSessionId.trim(),
      }),
    }),
  });

  return handleAuthoringTaskPostRoute(forwardedRequest);
}
