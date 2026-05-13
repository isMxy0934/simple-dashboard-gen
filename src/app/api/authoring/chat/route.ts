import { handleAuthoringChatRoute } from "@/server/authoring/chat-service";
import type { DashboardDocument } from "@/contracts";

export const maxDuration = 180;
export const runtime = "nodejs";

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
    !isNonEmptyString(payload.chatSessionId) ||
    !isNonEmptyString(payload.editingSessionId) ||
    !isNonEmptyString(payload.dashboardId) ||
    "sessionId" in payload ||
    "messages" in payload ||
    (payload.messageText !== undefined && typeof payload.messageText !== "string") ||
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
      workspaceId: payload.workspaceId.trim(),
      userId: payload.userId.trim(),
      chatSessionId: payload.chatSessionId.trim(),
      editingSessionId: payload.editingSessionId.trim(),
      dashboardId: payload.dashboardId.trim(),
      focusedViewId:
        typeof payload.focusedViewId === "string" ? payload.focusedViewId : null,
      messageText: typeof payload.messageText === "string" ? payload.messageText : null,
      dashboard: payload.dashboard,
      baseVersion:
        typeof payload.baseVersion === "number" ? payload.baseVersion : undefined,
      approvalEvent:
        typeof payload.approvalEvent === "object" && payload.approvalEvent !== null
          ? payload.approvalEvent
          : null,
      intent: typeof payload.intent === "string" ? payload.intent : null,
    }),
    signal: request.signal,
  });

  return handleAuthoringChatRoute(forwardedRequest);
}
