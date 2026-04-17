import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  buildEmptyAuthoringChatSessionState,
  isAuthoringChatSessionPayload,
  sanitizeAuthoringWorkingDraftSnapshot,
  sanitizeAuthoringChatSessionPayload,
  type AuthoringChatSessionPayload,
} from "@/ai/authoring/contracts/session-state";
import {
  getAuthoringChatSession,
  saveAuthoringChatSession,
} from "@/server/authoring/session-repository";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    typeof payload.sessionId !== "string" ||
    !isAuthoringChatSessionPayload(payload.payload)
  ) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_AUTHORING_CHAT_SESSION",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const sanitized = sanitizeAuthoringChatSessionPayload(
      payload.payload as AuthoringChatSessionPayload,
    );
    const existing = await getAuthoringChatSession(payload.sessionId).catch(
      () => null,
    );
    const existingPromptFingerprint =
      existing && isAuthoringChatSessionPayload(existing)
        ? sanitizeAuthoringChatSessionPayload(existing).prompt.lastContextFingerprint
        : null;
    const existingWorkingDraft =
      existing && isAuthoringChatSessionPayload(existing)
        ? sanitizeAuthoringChatSessionPayload(existing).prompt.workingDraft
        : null;
    const saved = await saveAuthoringChatSession({
      sessionId: payload.sessionId,
      dashboardId:
        typeof payload.dashboardId === "string" ? payload.dashboardId : sanitized.dashboardId,
      payload: {
        ...sanitized,
        prompt: {
          lastContextFingerprint: existingPromptFingerprint,
          workingDraft: sanitizeAuthoringWorkingDraftSnapshot(existingWorkingDraft),
        },
      },
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
          error instanceof Error ? error.message : "AUTHORING_CHAT_SESSION_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
