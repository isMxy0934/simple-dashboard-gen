import { handleAuthoringChatRoute } from "@/server/authoring/chat-service";
import type { DashboardDocument } from "@/contracts";
import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

export { maxDuration } from "@/server/authoring/chat-service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardDocumentLike(value: unknown): value is DashboardDocument {
  return (
    isRecord(value) &&
    isRecord(value.dashboard_spec) &&
    Array.isArray(value.query_defs) &&
    Array.isArray(value.bindings)
  );
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
    typeof payload.workspaceId !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.dashboardId !== "string" ||
    !Array.isArray(payload.messages) ||
    !isDashboardDocumentLike(payload.dashboard)
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_AUTHORING_CHAT_REQUEST", data: null },
      { status: 400 },
    );
  }

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      focusedViewId:
        typeof payload.focusedViewId === "string" ? payload.focusedViewId : null,
      sessionId: buildAuthoringCompositeSessionId({
        workspaceId: payload.workspaceId,
        userId: payload.userId,
        dashboardId: payload.dashboardId,
        sessionId: payload.sessionId,
      }),
      workspaceId: payload.workspaceId,
      dashboardId: payload.dashboardId,
      messages: payload.messages as AuthoringMessage[],
      dashboard: payload.dashboard,
    }),
  });

  return handleAuthoringChatRoute(forwardedRequest);
}
