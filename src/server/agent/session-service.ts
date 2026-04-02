import {
  DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION,
  buildEmptyDashboardAgentSessionState,
  isDashboardAgentSessionPayload,
  sanitizeDashboardAgentSessionPayload,
  type DashboardAgentSessionPayload,
} from "@/ai/dashboard-agent/contracts/session-state";
import {
  getDashboardAgentSession,
  saveDashboardAgentSession,
} from "@/server/agent/session-repository";

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
    const payload = await getDashboardAgentSession(sessionId);
    return Response.json({
      status_code: 200,
      reason: "OK",
      data: {
        sessionId,
        payload:
          (payload && isDashboardAgentSessionPayload(payload)
            ? sanitizeDashboardAgentSessionPayload(payload)
            : null) ??
          {
            version: DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION,
            ...buildEmptyDashboardAgentSessionState({ sessionId }),
            updatedAt: new Date(0).toISOString(),
          },
      },
    });
  } catch (error) {
    return Response.json(
      {
        status_code: 503,
        reason:
          error instanceof Error ? error.message : "DASHBOARD_AGENT_SESSION_LOAD_FAILED",
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
    !isDashboardAgentSessionPayload(payload.payload)
  ) {
    return Response.json(
      {
        status_code: 400,
        reason: "INVALID_DASHBOARD_AGENT_SESSION",
        data: null,
      },
      { status: 400 },
    );
  }

  try {
    const sanitized = sanitizeDashboardAgentSessionPayload(
      payload.payload as DashboardAgentSessionPayload,
    );
    const saved = await saveDashboardAgentSession({
      sessionId: payload.sessionId,
      dashboardId:
        typeof payload.dashboardId === "string" ? payload.dashboardId : sanitized.dashboardId,
      payload: sanitized,
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
          error instanceof Error ? error.message : "DASHBOARD_AGENT_SESSION_SAVE_FAILED",
        data: null,
      },
      { status: 503 },
    );
  }
}
