export const runtime = "nodejs";

import { steerAuthoringAgentTurn } from "@/server/authoring/steer-service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * POST /api/authoring/chat/:sessionId/steer
 *
 * Injects a steering message into the currently-running Agent turn.
 * The Agent must already be streaming (pool entry must exist and
 * `agent.state.isStreaming` must be true).
 *
 * Body: { message: string, workspaceId?, userId?, dashboardId?, sessionId? }
 *
 * Returns 202 on success, 404 when no live session exists, 409 when the
 * Agent is not currently streaming.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: sessionId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { status_code: 400, reason: "INVALID_PAYLOAD", data: null },
      { status: 400 },
    );
  }

  if (!isRecord(body) || typeof body.message !== "string" || !body.message.trim()) {
    return Response.json(
      { status_code: 400, reason: "MISSING_MESSAGE", data: null },
      { status: 400 },
    );
  }

  const result = steerAuthoringAgentTurn({
    routeSessionId: sessionId,
    message: body.message,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
    userId: typeof body.userId === "string" ? body.userId : null,
    dashboardId: typeof body.dashboardId === "string" ? body.dashboardId : null,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
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
