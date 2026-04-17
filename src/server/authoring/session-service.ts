import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  buildEmptyAuthoringChatSessionState,
  isAuthoringChatSessionPayload,
  sanitizeAuthoringChatSessionPayload,
} from "@/ai/authoring/contracts/session-state";
import { getAuthoringChatSession } from "@/server/authoring/session-repository";

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
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        sessionId,
        payload:
          (payload && isAuthoringChatSessionPayload(payload)
            ? sanitizeAuthoringChatSessionPayload(payload)
            : null) ??
          {
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
