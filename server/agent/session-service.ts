import {
  AUTHORING_AGENT_SESSION_PAYLOAD_VERSION,
  buildEmptyAgentSessionState,
  isPersistedAuthoringAgentSessionPayload,
  sanitizePersistedAuthoringAgentSessionPayload,
  type PersistedAuthoringAgentSessionPayload,
} from "../../ai/runtime/agent-session-state";
import { getAuthoringAgentSession, saveAuthoringAgentSession } from "./session-repository";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function handleAgentSessionGetRoute(
  request: Request,
): Promise<Response> {
  const sessionKey = new URL(request.url).searchParams.get("sessionKey");
  if (!sessionKey) {
    return Response.json(
      {
        status_code: 400,
        reason: "MISSING_SESSION_KEY",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const payload = await getAuthoringAgentSession(sessionKey);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        sessionKey,
        payload:
          (payload && isPersistedAuthoringAgentSessionPayload(payload)
            ? sanitizePersistedAuthoringAgentSessionPayload(payload)
            : null) ??
          {
            version: AUTHORING_AGENT_SESSION_PAYLOAD_VERSION,
            ...buildEmptyAgentSessionState(),
            updatedAt: new Date(0).toISOString(),
          },
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "AUTHORING_AGENT_SESSION_LOAD_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function handleAgentSessionPutRoute(
  request: Request,
): Promise<Response> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_PAYLOAD",
        data: null,
      },
      { status: 400 },
    );
  }

  if (
    !isRecord(payload) ||
    typeof payload.sessionKey !== "string" ||
    !isPersistedAuthoringAgentSessionPayload(payload.payload)
  ) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_AUTHORING_AGENT_SESSION",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const saved = await saveAuthoringAgentSession({
      sessionKey: payload.sessionKey,
      payload: sanitizePersistedAuthoringAgentSessionPayload(
        payload.payload as PersistedAuthoringAgentSessionPayload,
      ),
    });

    return Response.json({
      status_code: 200,
      reason: "OK",
      data: saved,
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "AUTHORING_AGENT_SESSION_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
