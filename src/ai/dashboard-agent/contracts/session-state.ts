import type { DashboardAgentMessage } from "@/ai/dashboard-agent/contracts/agent-contract";

export const DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION = 2 as const;

export interface DashboardAgentSessionState {
  sessionId: string;
  dashboardId: string | null;
  messages: DashboardAgentMessage[];
  ui: {
    showAgentProcess: boolean;
    agentNotice: string;
  };
  prompt: {
    lastContextFingerprint: string | null;
  };
}

export interface DashboardAgentSessionPayload
  extends DashboardAgentSessionState {
  version: typeof DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION;
  updatedAt: string;
}

export function buildEmptyDashboardAgentSessionState(input: {
  sessionId: string;
  dashboardId?: string | null;
}): DashboardAgentSessionState {
  return {
    sessionId: input.sessionId,
    dashboardId: input.dashboardId ?? null,
    messages: [],
    ui: {
      showAgentProcess: false,
      agentNotice: "",
    },
    prompt: {
      lastContextFingerprint: null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDashboardAgentSessionPayload(
  value: unknown,
): value is DashboardAgentSessionPayload {
  return (
    isRecord(value) &&
    value.version === DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION &&
    typeof value.sessionId === "string" &&
    (value.dashboardId === null || typeof value.dashboardId === "string") &&
    Array.isArray(value.messages) &&
    isRecord(value.ui) &&
    typeof value.ui.showAgentProcess === "boolean" &&
    typeof value.ui.agentNotice === "string" &&
    (!("prompt" in value) ||
      (isRecord(value.prompt) &&
        (value.prompt.lastContextFingerprint === null ||
          typeof value.prompt.lastContextFingerprint === "string"))) &&
    typeof value.updatedAt === "string"
  );
}

export function sanitizeDashboardAgentSessionPayload(
  payload: DashboardAgentSessionPayload,
): DashboardAgentSessionPayload {
  return {
    version: DASHBOARD_AGENT_SESSION_PAYLOAD_VERSION,
    sessionId: payload.sessionId,
    dashboardId: payload.dashboardId ?? null,
    updatedAt: payload.updatedAt,
    messages: payload.messages as DashboardAgentMessage[],
    ui: {
      showAgentProcess: payload.ui.showAgentProcess,
      agentNotice: payload.ui.agentNotice,
    },
    prompt: {
      lastContextFingerprint: payload.prompt?.lastContextFingerprint ?? null,
    },
  };
}
