export const runtime = "nodejs";

import { steerAuthoringAgentTurn } from "@/server/authoring/steer-service";
import { Permission } from "@/server/auth/permissions";
import {
  apiErrorToResponse,
  requireApiSession,
} from "@/server/auth/route-helpers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * POST /api/authoring/chat/:chatSessionId/steer
 *
 * Injects a steering message into the currently-running Agent turn.
 * The Agent must already be streaming (pool entry must exist and
 * `agent.state.isStreaming` must be true).
 *
 * Body: { message: string, dashboardId, chatSessionId }
 *
 * Returns 202 on success, 404 when no live session exists, 409 when the
 * Agent is not currently streaming.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: chatSessionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  if (
    !isRecord(body) ||
    typeof body.message !== "string" ||
    !body.message.trim() ||
    typeof body.dashboardId !== "string" ||
    !body.dashboardId.trim() ||
    typeof body.chatSessionId !== "string" ||
    !body.chatSessionId.trim()
  ) {
    return Response.json(
      { status_code: 400, reason: "INVALID_STEER_REQUEST", data: null },
      { status: 400 },
    );
  }

  let session;
  try {
    session = await requireApiSession(request, Permission.DashboardEdit);
  } catch (error) {
    return apiErrorToResponse(error);
  }

  const result = steerAuthoringAgentTurn({
    routeChatSessionId: chatSessionId,
    message: body.message as string,
    workspaceId: session.workspaceId,
    userId: session.userId,
    dashboardId: body.dashboardId.trim(),
    chatSessionId: body.chatSessionId as string,
  });

  if (!result.ok) {
    return Response.json(
      { status_code: result.status, reason: result.reason, data: null },
      { status: result.status },
    );
  }

  return Response.json(
    { status_code: 202, reason: "OK", data: { session_id: result.sessionId } },
    { status: 202 },
  );
}
