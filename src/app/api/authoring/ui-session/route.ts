import {
  handleAuthoringSessionGetRoute,
  handleAuthoringSessionListRoute,
  handleAuthoringSessionPutRoute,
} from "@/server/authoring/session-service";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function rewriteGetUrl(url: URL) {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const sessionId = url.searchParams.get("sessionId")?.trim();

  if (!workspaceId || !userId || !dashboardId) {
    return null;
  }

  if (sessionId) {
    url.searchParams.set(
      "sessionId",
      buildAuthoringCompositeSessionId({
        workspaceId,
        userId,
        dashboardId,
        sessionId,
      }),
    );
    return {
      kind: "get" as const,
      url,
    };
  }

  url.searchParams.set(
    "sessionIdPrefix",
    `${workspaceId}:${userId}:${dashboardId}:`,
  );
  return {
    kind: "list" as const,
    url,
  };
}

export async function GET(request: Request): Promise<Response> {
  const rewritten = rewriteGetUrl(new URL(request.url));
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
    !isNonEmptyString(payload.workspaceId) ||
    !isNonEmptyString(payload.userId) ||
    !isNonEmptyString(payload.dashboardId) ||
    !isNonEmptyString(payload.sessionId)
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_AUTHORING_UI_SESSION_REQUEST", data: null },
      { status: 400 },
    );
  }

  const forwardedRequest = new Request(request.url, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId: payload.workspaceId.trim(),
        userId: payload.userId.trim(),
        dashboardId: payload.dashboardId.trim(),
        sessionId: payload.sessionId.trim(),
      }),
    }),
  });

  return handleAuthoringSessionPutRoute(forwardedRequest);
}
