import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringApprovalEvent,
  AuthoringChatRequestBody,
  AuthoringIntent,
} from "@/ai/authoring/contracts/tool-io";
import { createTurnId } from "@/server/logs/session-ids";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";
import { isAgentChatRequestBody } from "@/server/authoring/chat-request-schema";

interface ResolvedAgentChatRequest {
  workspaceId: string | null;
  sessionId: string;
  dashboardId: string | null;
  focusedViewId: string | null;
  turnId: string;
  dashboard: DashboardDocument;
  messageText: string | null;
  intent: AuthoringIntent | null;
  baseVersion: number | null;
  approvalEvent: AuthoringApprovalEvent | null;
}

export type AgentChatRequestResult =
  | {
      ok: true;
      input: ResolvedAgentChatRequest;
    }
  | {
      ok: false;
      response: Response;
    };

export async function resolveAgentChatRequest(
  request: Request,
): Promise<AgentChatRequestResult> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_PAYLOAD",
          data: null,
        },
        { status: 400 },
      ),
    };
  }

  if (!isAgentChatRequestBody(payload)) {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_AUTHORING_CHAT_REQUEST",
          data: null,
        },
        { status: 400 },
      ),
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 503,
          reason: "OPENAI_API_KEY is missing.",
          data: null,
        },
        { status: 503 },
      ),
    };
  }

  const messageText =
    typeof payload.messageText === "string" && payload.messageText.trim()
      ? payload.messageText.trim()
      : null;
  const turnId = createTurnId();

  await writeSessionTraceEvent({
    sessionId: payload.sessionId,
    dashboardId: payload.dashboardId ?? null,
    turnId,
    scope: "authoring-chat",
    event: "request_received",
    payload: {
      dashboard_name: payload.dashboard.dashboard_spec.dashboard.name,
      view_count: payload.dashboard.dashboard_spec.views.length,
      latest_user_text: messageText,
    },
  });

  return {
    ok: true,
    input: {
      workspaceId: payload.workspaceId ?? null,
      sessionId: payload.sessionId,
      dashboardId: payload.dashboardId ?? null,
      focusedViewId: payload.focusedViewId ?? null,
      turnId,
      dashboard: payload.dashboard,
      messageText,
      intent: payload.intent ?? null,
      baseVersion: payload.baseVersion ?? null,
      approvalEvent: payload.approvalEvent ?? null,
    },
  };
}
