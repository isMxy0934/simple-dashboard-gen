import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringApprovalEvent,
  AuthoringChatRequestBody,
  AuthoringIntent,
} from "@/ai/authoring/contracts/tool-io";
import { createTurnId } from "@/server/logs/session-ids";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";
import { resolveProviderModelConfig } from "@/ai/providers";
import {
  diagnoseAgentChatRequestBody,
  isAgentChatRequestBody,
} from "@/server/authoring/chat-request-schema";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

interface ResolvedAgentChatRequest {
  workspaceId: string | null;
  userId: string | null;
  editingSessionId: string;
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
    const issues = diagnoseAgentChatRequestBody(payload);
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_AUTHORING_CHAT_REQUEST",
          data: { issues },
        },
        { status: 400 },
      ),
    };
  }

  let providerConfig: ReturnType<typeof resolveProviderModelConfig>;
  try {
    providerConfig = resolveProviderModelConfig();
  } catch (error) {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 503,
          reason: error instanceof Error ? error.message : "MODEL_PROVIDER_INVALID.",
          data: null,
        },
        { status: 503 },
      ),
    };
  }

  if (!providerConfig.getApiKey(providerConfig.providerKind)) {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 503,
          reason:
            providerConfig.providerKind === "deepseek"
              ? "DEEPSEEK_API_KEY or OPENAI_API_KEY is missing."
              : "OPENAI_API_KEY is missing.",
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

  const workspaceId = payload.workspaceId ?? null;
  const userId = payload.userId ?? null;
  const dashboardId = payload.dashboardId ?? null;
  const sessionId =
    workspaceId && userId && dashboardId
      ? buildAuthoringCompositeSessionId({
          workspaceId,
          userId,
          dashboardId,
          sessionId: payload.sessionId,
        })
      : payload.sessionId;

  await writeSessionTraceEvent({
    sessionId,
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
      workspaceId,
      userId,
      editingSessionId: payload.sessionId,
      sessionId,
      dashboardId,
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
