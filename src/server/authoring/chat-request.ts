import type { DashboardDocument } from "@/contracts";
import type {
  AuthoringApprovalEvent,
  AuthoringChatRequestBody,
  AuthoringIntent,
} from "@/ai/authoring/contracts/tool-io";
import { createTurnId } from "@/server/logs/session-ids";
import { emitAuthoringTraceEvent } from "@/server/logs/authoring-trace";
import {
  resolvePiModelRuntime,
  type PiModelRuntime,
} from "@/ai/providers";
import {
  diagnoseAgentChatRequestBody,
  isAgentChatRequestBody,
} from "@/server/authoring/chat-request-schema";
import { buildAuthoringCompositeSessionId } from "@/server/authoring/session-key";

interface ResolvedAgentChatRequest {
  workspaceId: string;
  userId: string;
  permissions: string[];
  chatSessionId: string;
  editingSessionId: string;
  sessionId: string;
  dashboardId: string;
  requestId: string;
  focusedViewId: string | null;
  turnId: string;
  dashboard: DashboardDocument;
  messageText: string | null;
  intent: AuthoringIntent | null;
  baseVersion: number | null;
  approvalEvent: AuthoringApprovalEvent | null;
  modelRuntime: PiModelRuntime;
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

  let modelRuntime: PiModelRuntime;
  try {
    modelRuntime = await resolvePiModelRuntime();
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

  const messageText =
    typeof payload.messageText === "string" && payload.messageText.trim()
      ? payload.messageText.trim()
      : null;
  const turnId = createTurnId();
  const requestId = request.headers.get("x-request-id")?.trim() || `req_${turnId}`;

  const workspaceId = payload.workspaceId.trim();
  const userId = payload.userId.trim();
  const permissions = payload.permissions ?? [];
  const dashboardId = payload.dashboardId.trim();
  const chatSessionId = payload.chatSessionId.trim();
  const editingSessionId = payload.editingSessionId.trim();
  const sessionId = buildAuthoringCompositeSessionId({
    workspaceId,
    userId,
    dashboardId,
    sessionId: chatSessionId,
  });

  await emitAuthoringTraceEvent({
    sessionId,
    dashboardId,
    turnId,
    requestId,
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
      permissions,
      chatSessionId,
      editingSessionId,
      sessionId,
      dashboardId,
      requestId,
      focusedViewId: payload.focusedViewId ?? null,
      turnId,
      dashboard: payload.dashboard,
      messageText,
      intent: payload.intent ?? null,
      baseVersion: payload.baseVersion ?? null,
      approvalEvent: payload.approvalEvent ?? null,
      modelRuntime,
    },
  };
}
