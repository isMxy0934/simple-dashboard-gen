import { handleAuthoringChatRoute } from "@/server/authoring/chat-service";
import type { DashboardDocument } from "@/contracts";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";
import { assertRateLimit } from "@/server/guards/rate-limit";

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

  let session;
  try {
    session = await requireApiSession(request, Permission.DashboardEdit);
    await assertRateLimit("agent.stream", session.userId, {
      sessionId: session.sessionId,
      requestId: session.requestId,
    });
  } catch (error) {
    return apiErrorToResponse(error);
  }

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": session.requestId,
    },
    body: JSON.stringify({
      workspaceId: session.workspaceId,
      userId: session.userId,
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
