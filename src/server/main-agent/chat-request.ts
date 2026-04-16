import type { DashboardDocument } from "@/contracts";
import type {
  MainAgentChatRequestBody,
  MainAgentMessage,
} from "@/ai/main-agent/contracts/agent-contract";
import { safeValidateMainAgentMessages } from "@/ai/dashboard-worker/engine/loop";
import { createTurnId } from "@/server/logs/session-ids";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

interface ResolvedAgentChatRequest {
  sessionId: string;
  dashboardId: string | null;
  focusedViewId: string | null;
  turnId: string;
  dashboard: DashboardDocument;
  messages: MainAgentMessage[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardDocumentLike(value: unknown): value is DashboardDocument {
  return (
    isRecord(value) &&
    isRecord(value.dashboard_spec) &&
    Array.isArray(value.query_defs) &&
    Array.isArray(value.bindings)
  );
}

function isAgentChatRequestBody(
  value: unknown,
): value is MainAgentChatRequestBody {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    (value.dashboardId === undefined ||
      value.dashboardId === null ||
      typeof value.dashboardId === "string") &&
    (value.focusedViewId === undefined ||
      value.focusedViewId === null ||
      typeof value.focusedViewId === "string") &&
    Array.isArray(value.messages) &&
    isDashboardDocumentLike(value.dashboard)
  );
}

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
          reason: "INVALID_MAIN_AGENT_CHAT_REQUEST",
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

  const validation = await safeValidateMainAgentMessages({
    dashboard: payload.dashboard,
    dashboardId: payload.dashboardId,
    messages: payload.messages,
    dependencies: {},
  });

  if (!validation.success) {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_MAIN_AGENT_UI_MESSAGES",
          data: validation.error.message,
        },
        { status: 400 },
      ),
    };
  }

  const messages = validation.data as MainAgentMessage[];
  const turnId = createTurnId();

  await writeSessionTraceEvent({
    sessionId: payload.sessionId,
    dashboardId: payload.dashboardId ?? null,
    turnId,
    scope: "agent-chat",
    event: "request_received",
    payload: {
      message_count: messages.length,
      dashboard_name: payload.dashboard.dashboard_spec.dashboard.name,
      view_count: payload.dashboard.dashboard_spec.views.length,
    },
  });

  return {
    ok: true,
    input: {
      sessionId: payload.sessionId,
      dashboardId: payload.dashboardId ?? null,
      focusedViewId: payload.focusedViewId ?? null,
      turnId,
      dashboard: payload.dashboard,
      messages,
    },
  };
}
