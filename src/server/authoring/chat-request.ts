import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringApprovalEvent,
  AuthoringChatRequestBody,
  AuthoringIntent,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import { safeValidateMessages } from "@/ai/authoring/agent";
import { extractLatestUserText } from "@/ai/authoring/messages/extract-latest-user-text";
import { createValidationOnlyAuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
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
  messages: AuthoringMessage[];
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

  const validation = await safeValidateMessages({
    dashboard: payload.dashboard,
    dashboardId: payload.dashboardId,
    messages: payload.messages ?? [],
    dependencies: createValidationOnlyAuthoringDependencies(),
  });

  if (!validation.success) {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_AUTHORING_UI_MESSAGES",
          data: validation.error.message,
        },
        { status: 400 },
      ),
    };
  }

  const messages = validation.data as AuthoringMessage[];
  const messageText =
    typeof payload.messageText === "string" && payload.messageText.trim()
      ? payload.messageText.trim()
      : extractLatestUserText(messages) || null;
  const turnId = createTurnId();
  const latestUserText = messageText ?? extractLatestUserText(messages);

  await writeSessionTraceEvent({
    sessionId: payload.sessionId,
    dashboardId: payload.dashboardId ?? null,
    turnId,
    scope: "authoring-chat",
    event: "request_received",
    payload: {
      message_count: messages.length,
      dashboard_name: payload.dashboard.dashboard_spec.dashboard.name,
      view_count: payload.dashboard.dashboard_spec.views.length,
      latest_user_text: latestUserText,
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
      messages,
      messageText,
      intent: payload.intent ?? null,
      baseVersion: payload.baseVersion ?? null,
      approvalEvent: payload.approvalEvent ?? null,
    },
  };
}
