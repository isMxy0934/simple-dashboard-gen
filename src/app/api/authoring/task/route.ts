import {
  handleAuthoringTaskGetRoute,
  handleAuthoringTaskPostRoute,
} from "@/server/authoring/task-service";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function rewriteSessionId(url: URL): URL | null {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const chatSessionId = url.searchParams.get("chatSessionId")?.trim();

  if (url.searchParams.has("sessionId")) {
    return null;
  }

  if (!workspaceId || !userId || !dashboardId || !chatSessionId) {
    return null;
  }

  url.searchParams.set(
    "sessionId",
    buildAuthoringCompositeSessionId({
      workspaceId,
      userId,
      dashboardId,
      sessionId: chatSessionId,
    }),
  );
  return url;
}

export async function GET(request: Request): Promise<Response> {
  const rewritten = rewriteSessionId(new URL(request.url));
  if (!rewritten) {
    return Response.json(
      { status_code: 400, reason: "MISSING_AUTHORING_TASK_SCOPE", data: null },
      { status: 400 },
    );
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

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId: payload.workspaceId.trim(),
        userId: payload.userId.trim(),
        dashboardId: payload.dashboardId.trim(),
        sessionId: payload.chatSessionId.trim(),
      }),
    }),
  });

  return handleAuthoringTaskPostRoute(forwardedRequest);
}
