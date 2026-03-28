import type { DashboardDocument, DatasourceContext } from "../../contracts";
import type {
  AgentChatRequestBody,
  AuthoringAgentMessage,
} from "../../ai/runtime/agent-contract";
import { safeValidateDashboardAgentMessages } from "../../ai/agent/dashboard-authoring-agent";
import { writeDebugLog } from "../logging/debug-log";

interface ResolvedAgentChatRequest {
  sessionKey: string;
  dashboard: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
  messages: AuthoringAgentMessage[];
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

function isAgentChatRequestBody(value: unknown): value is AgentChatRequestBody {
  return (
    isRecord(value) &&
    (value.id === undefined || typeof value.id === "string") &&
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
    await writeDebugLog("agent-chat", "invalid-json", null);
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
    await writeDebugLog("agent-chat", "invalid-payload", payload);
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_AGENT_CHAT_REQUEST",
          data: null,
        },
        { status: 400 },
      ),
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    await writeDebugLog("agent-chat", "missing-openai-key", null);
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 503,
          reason:
            "OPENAI_API_KEY is missing. Set it to enable the Phase 4 dashboard agent.",
          data: null,
        },
        { status: 503 },
      ),
    };
  }

  const validation = await safeValidateDashboardAgentMessages({
    dashboard: payload.dashboard,
    datasourceContext: payload.datasourceContext,
    messages: payload.messages,
    dependencies: {},
  });

  if (!validation.success) {
    await writeDebugLog("agent-chat", "invalid-ui-messages", {
      error: validation.error.message,
    });
    return {
      ok: false,
      response: Response.json(
        {
          status_code: 400,
          reason: "INVALID_AGENT_UI_MESSAGES",
          data: validation.error.message,
        },
        { status: 400 },
      ),
    };
  }

  const messages = validation.data as AuthoringAgentMessage[];
  const sessionKey = payload.id ?? "authoring-agent:local";
  await writeDebugLog("agent-chat", "request-received", {
    session_key: sessionKey,
    message_count: messages.length,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    })),
    dashboard_name: payload.dashboard.dashboard_spec.dashboard.name,
    view_count: payload.dashboard.dashboard_spec.views.length,
    datasource_id: payload.datasourceContext?.datasource_id ?? null,
  });

  return {
    ok: true,
    input: {
      sessionKey,
      dashboard: payload.dashboard,
      datasourceContext: payload.datasourceContext,
      messages,
    },
  };
}
