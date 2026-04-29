import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  buildEmptyAuthoringChatSessionState,
  isAuthoringChatSessionPayload,
  sanitizeAuthoringChatSessionPayload,
} from "@/ai/authoring/contracts/session";
import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";
import {
  getAuthoringChatSession,
  listAuthoringChatSessions,
} from "@/server/authoring/session-repository";

function isTextPart(value: unknown): value is { type: "text"; text: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "text" in value &&
    value.type === "text" &&
    typeof value.text === "string"
  );
}

function extractSessionTitle(messages: AuthoringMessage[]) {
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const text = Array.isArray(message.parts)
      ? message.parts
          .filter(isTextPart)
          .map((part) => part.text)
          .join(" ")
          .trim()
      : "";
    if (text) {
      return text.length > 48 ? `${text.slice(0, 48)}...` : text;
    }
  }

  return "New session";
}

export async function handleAuthoringSessionListRoute(
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const dashboardId = url.searchParams.get("dashboardId")?.trim();
  const sessionIdPrefix = url.searchParams.get("sessionIdPrefix")?.trim();

  if (!dashboardId || !sessionIdPrefix) {
    return Response.json(
      {
        status_code: 400,
        reason: "MISSING_SESSION_LIST_SCOPE",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const rows = await listAuthoringChatSessions({
      dashboardId,
      sessionIdPrefix,
    });
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        sessions: rows.map((row) => ({
          sessionId: row.session_id.startsWith(sessionIdPrefix)
            ? row.session_id.slice(sessionIdPrefix.length)
            : row.session_id,
          title: extractSessionTitle(row.payload.messages),
          messageCount: row.payload.messages.length,
          updatedAt: row.updated_at,
        })),
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "AUTHORING_CHAT_SESSION_LIST_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function handleAuthoringSessionGetRoute(
  request: Request,
): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json(
      {
        status_code: 400,
        reason: "MISSING_SESSION_ID",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const payload = await getAuthoringChatSession(sessionId);
    const sanitized =
      payload && isAuthoringChatSessionPayload(payload)
        ? sanitizeAuthoringChatSessionPayload(payload)
        : null;
    return Response.json({
      status_code: 200,
      reason: sanitized ? "OK" : "AUTHORING_CHAT_SESSION_RESET",
      data: {
        sessionId,
        reset_reason: sanitized ? null : "INVALID_OR_OUTDATED_CHAT_SESSION",
        payload:
          sanitized ?? {
            version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
            ...buildEmptyAuthoringChatSessionState({ sessionId }),
            updatedAt: new Date(0).toISOString(),
          },
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "AUTHORING_CHAT_SESSION_LOAD_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}

export async function handleAuthoringSessionPutRoute(
  request: Request,
): Promise<Response> {
  void request;
  return Response.json(
    {
      status_code: 405,
      reason: "AUTHORING_CHAT_SESSION_WRITE_DISABLED",
      data: null,
    },
    { status: 405 },
  );
}
