export const runtime = "nodejs";

import { getAuthoringAgentPoolEntry } from "@/server/authoring/agent-pool";

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
 * Body: { message: string }
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

  const poolEntry = getAuthoringAgentPoolEntry(sessionId.trim());
  if (!poolEntry) {
    return Response.json(
      { status_code: 404, reason: "NO_ACTIVE_SESSION", data: null },
      { status: 404 },
    );
  }

  const { agent } = poolEntry.session.piAgent
    ? { agent: poolEntry.session.piAgent }
    : { agent: null };

  if (!agent) {
    return Response.json(
      { status_code: 404, reason: "AGENT_NOT_INITIALIZED", data: null },
      { status: 404 },
    );
  }

  if (!agent.state.isStreaming) {
    return Response.json(
      { status_code: 409, reason: "AGENT_NOT_STREAMING", data: null },
      { status: 409 },
    );
  }

  agent.steer({
    role: "user",
    content: body.message.trim(),
    timestamp: Date.now(),
  });

  return Response.json({ ok: true }, { status: 202 });
}
