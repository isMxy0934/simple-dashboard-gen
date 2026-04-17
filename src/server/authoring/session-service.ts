import {
  MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION,
  buildEmptyMainAgentChatSessionState,
  isMainAgentChatSessionPayload,
  sanitizeMainAgentWorkingDraftSnapshot,
  sanitizeMainAgentChatSessionPayload,
  type MainAgentChatSessionPayload,
} from "@/ai/authoring/contracts/session-state";
import {
  getMainAgentChatSession,
  saveMainAgentChatSession,
} from "@/server/authoring/session-repository";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function handleAgentSessionGetRoute(
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
    const payload = await getMainAgentChatSession(sessionId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        sessionId,
        payload:
          (payload && isMainAgentChatSessionPayload(payload)
            ? sanitizeMainAgentChatSessionPayload(payload)
            : null) ??
          {
            version: MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION,
            ...buildEmptyMainAgentChatSessionState({ sessionId }),
            updatedAt: new Date(0).toISOString(),
          },
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "MAIN_AGENT_CHAT_SESSION_LOAD_FAILED",
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
    typeof payload.sessionId !== "string" ||
    !isMainAgentChatSessionPayload(payload.payload)
  ) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_MAIN_AGENT_CHAT_SESSION",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const sanitized = sanitizeMainAgentChatSessionPayload(
      payload.payload as MainAgentChatSessionPayload,
    );
    const existing = await getMainAgentChatSession(payload.sessionId).catch(
      () => null,
    );
    const existingPromptFingerprint =
      existing && isMainAgentChatSessionPayload(existing)
        ? sanitizeMainAgentChatSessionPayload(existing).prompt.lastContextFingerprint
        : null;
    const existingWorkingDraft =
      existing && isMainAgentChatSessionPayload(existing)
        ? sanitizeMainAgentChatSessionPayload(existing).prompt.workingDraft
        : null;
    const saved = await saveMainAgentChatSession({
      sessionId: payload.sessionId,
      dashboardId:
        typeof payload.dashboardId === "string" ? payload.dashboardId : sanitized.dashboardId,
      payload: {
        ...sanitized,
        prompt: {
          lastContextFingerprint: existingPromptFingerprint,
          workingDraft: sanitizeMainAgentWorkingDraftSnapshot(existingWorkingDraft),
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
          error instanceof Error ? error.message : "MAIN_AGENT_CHAT_SESSION_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
