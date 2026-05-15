import {
  handleAuthoringTaskGetRoute,
  handleAuthoringTaskPostRoute,
} from "@/server/authoring/task-service";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";
import { resolveServerRequestContext } from "@/server/request-context";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function rewriteChatSessionId(url: URL): Promise<URL | Response> {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const chatSessionId = url.searchParams.get("chatSessionId")?.trim();

  if (url.searchParams.has("sessionId")) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_TASK_SCOPE", data: null },
      { status: 400 },
    );
  }

  if (!workspaceId || !userId || !dashboardId || !chatSessionId) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_TASK_SCOPE", data: null },
      { status: 400 },
    );
  }

  const context = await resolveServerRequestContext(
    { workspaceId, userId, dashboardId },
    { requireUser: true, requireDashboard: true },
  );
  if (!context.ok) {
    return Response.json(
      {
        status_code: context.status,
        reason: context.reason,
        data: context.details ?? null,
      },
      { status: context.status },
    );
  }

  url.searchParams.set(
    "sessionId",
    buildAuthoringCompositeSessionId({
      workspaceId: context.data.workspaceId,
      userId: context.data.userId!,
      dashboardId: context.data.dashboardId!,
      sessionId: chatSessionId,
    }),
  );
  return url;
}

export async function GET(request: Request): Promise<Response> {
  const rewritten = await rewriteChatSessionId(new URL(request.url));
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
    !isNonEmptyString(payload.workspaceId) ||
    !isNonEmptyString(payload.userId) ||
    !isNonEmptyString(payload.dashboardId) ||
    !isNonEmptyString(payload.chatSessionId) ||
    "sessionId" in payload
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_AUTHORING_TASK_REQUEST", data: null },
      { status: 400 },
    );
  }

  const context = await resolveServerRequestContext(payload, {
    requireUser: true,
    requireDashboard: true,
  });
  if (!context.ok) {
    return Response.json(
      {
        status_code: context.status,
        reason: context.reason,
        data: context.details ?? null,
      },
      { status: context.status },
    );
  }

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      workspaceId: context.data.workspaceId,
      userId: context.data.userId!,
      dashboardId: context.data.dashboardId!,
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId: context.data.workspaceId,
        userId: context.data.userId!,
        dashboardId: context.data.dashboardId!,
        sessionId: payload.chatSessionId.trim(),
      }),
    }),
  });

  return handleAuthoringTaskPostRoute(forwardedRequest);
}
