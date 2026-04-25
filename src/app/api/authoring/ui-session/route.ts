import {
  handleAuthoringSessionGetRoute,
  handleAuthoringSessionListRoute,
  handleAuthoringSessionPutRoute,
} from "@/server/authoring/session-service";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

function rewriteGetUrl(url: URL) {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const sessionId = url.searchParams.get("sessionId")?.trim();

  if (workspaceId && userId && dashboardId && sessionId) {
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

  if (workspaceId && userId && dashboardId && !sessionId) {
    url.searchParams.set(
      "sessionIdPrefix",
      `${workspaceId}:${userId}:${dashboardId}:`,
    );
    return {
      kind: "list" as const,
      url,
    };
  }

  return {
    kind: "get" as const,
    url,
  };
}

export async function GET(request: Request): Promise<Response> {
  const rewritten = rewriteGetUrl(new URL(request.url));
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
    typeof payload !== "object" ||
    payload === null ||
    !("workspaceId" in payload) ||
    !("userId" in payload) ||
    !("dashboardId" in payload) ||
    !("sessionId" in payload)
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
        workspaceId: String(payload.workspaceId),
        userId: String(payload.userId),
        dashboardId: String(payload.dashboardId),
        sessionId: String(payload.sessionId),
      }),
    }),
  });

  return handleAuthoringSessionPutRoute(forwardedRequest);
}
