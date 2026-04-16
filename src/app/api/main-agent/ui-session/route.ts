import {
  handleAgentSessionGetRoute,
  handleAgentSessionPutRoute,
} from "@/server/main-agent/session-service";
import { buildMainAgentCompositeSessionId } from "@/server/main-agent/session-key";

function rewriteGetUrl(url: URL) {
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const userId = url.searchParams.get("userId")?.trim();
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const sessionId = url.searchParams.get("sessionId")?.trim();

  if (workspaceId && userId && dashboardId && sessionId) {
    url.searchParams.set(
      "sessionId",
      buildMainAgentCompositeSessionId({
        workspaceId,
        userId,
        dashboardId,
        sessionId,
      }),
    );
  }

  return url;
}

export async function GET(request: Request): Promise<Response> {
  const rewritten = rewriteGetUrl(new URL(request.url));
  const forwardedRequest = new Request(rewritten.toString(), {
    method: "GET",
    headers: request.headers,
  });
  return handleAgentSessionGetRoute(forwardedRequest);
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
      { status_code: 400, reason: "INVALID_MAIN_AGENT_UI_SESSION_REQUEST", data: null },
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
      sessionId: buildMainAgentCompositeSessionId({
        workspaceId: String(payload.workspaceId),
        userId: String(payload.userId),
        dashboardId: String(payload.dashboardId),
        sessionId: String(payload.sessionId),
      }),
    }),
  });

  return handleAgentSessionPutRoute(forwardedRequest);
}
