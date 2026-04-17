import {
  handleAuthoringTaskGetRoute,
  handleAuthoringTaskPostRoute,
} from "@/server/authoring/task-service";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

function rewriteSessionId(url: URL): URL {
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
  }

  return url;
}

export async function GET(request: Request): Promise<Response> {
  const rewritten = rewriteSessionId(new URL(request.url));
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
    typeof payload !== "object" ||
    payload === null ||
    !("workspaceId" in payload) ||
    !("userId" in payload) ||
    !("dashboardId" in payload) ||
    !("sessionId" in payload)
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
        workspaceId: String(payload.workspaceId),
        userId: String(payload.userId),
        dashboardId: String(payload.dashboardId),
        sessionId: String(payload.sessionId),
      }),
    }),
  });

  return handleAuthoringTaskPostRoute(forwardedRequest);
}
