import type { DashboardDocument, DatasourceContext } from "@/contracts";
import type {
  DashboardAgentChatRequestBody,
  DashboardAgentMessage,
} from "@/agent/dashboard-agent/contracts/agent-contract";
import { safeValidateDashboardAgentMessages } from "@/agent/dashboard-agent/runtime/dashboard-agent-loop";
import { createTurnId } from "@/server/logs/session-ids";
import { writeSessionTraceEvent } from "@/server/logs/session-log-writer";

interface ResolvedAgentChatRequest {
  sessionId: string;
  dashboardId: string | null;
  turnId: string;
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages: DashboardAgentMessage[];
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

function isDatasourceContextLike(value: unknown): value is DatasourceContext {
  return (
    isRecord(value) &&
    typeof value.datasource_id === "string" &&
    Array.isArray(value.tables)
  );
}

function isAgentChatRequestBody(
  value: unknown,
): value is DashboardAgentChatRequestBody {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    (value.dashboardId === undefined ||
      value.dashboardId === null ||
      typeof value.dashboardId === "string") &&
    Array.isArray(value.messages) &&
    isDashboardDocumentLike(value.dashboard) &&
    (value.datasourceContext === undefined ||
      value.datasourceContext === null ||
      isDatasourceContextLike(value.datasourceContext))
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
          reason: "INVALID_DASHBOARD_AGENT_CHAT_REQUEST",
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

  const validation = await safeValidateDashboardAgentMessages({
    dashboard: payload.dashboard,
    dashboardId: payload.dashboardId,
    datasourceContext: payload.datasourceContext,
    messages: payload.messages,
    dependencies: {},
  });

  if (!validation.success) {
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_DASHBOARD_AGENT_UI_MESSAGES",
          data: validation.error.message,
        },
        { status: 400 },
      ),
    };
  }

  const messages = validation.data as DashboardAgentMessage[];
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
      datasource_id: payload.datasourceContext?.datasource_id ?? null,
    },
  });

  return {
    ok: true,
    input: {
      sessionId: payload.sessionId,
      dashboardId: payload.dashboardId ?? null,
      turnId,
      dashboard: payload.dashboard,
      datasourceContext: payload.datasourceContext,
      messages,
    },
  };
}
