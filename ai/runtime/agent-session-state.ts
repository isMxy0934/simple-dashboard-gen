import type { AuthoringAgentMessage } from "./agent-contract";

export const AUTHORING_AGENT_SESSION_PAYLOAD_VERSION = 2 as const;

export interface AuthoringAgentSessionState {
  messages: AuthoringAgentMessage[];
  ui: {
    showAgentProcess: boolean;
    agentNotice: string;
  };
}

export interface PersistedAuthoringAgentSessionPayload
  extends AuthoringAgentSessionState {
  version: typeof AUTHORING_AGENT_SESSION_PAYLOAD_VERSION;
  updatedAt: string;
}

export function buildEmptyAgentSessionState(): AuthoringAgentSessionState {
  return {
    messages: [],
    ui: {
      showAgentProcess: false,
      agentNotice: "",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPersistedAuthoringAgentSessionPayload(
  value: unknown,
): value is PersistedAuthoringAgentSessionPayload {
  return (
    isRecord(value) &&
    value.version === AUTHORING_AGENT_SESSION_PAYLOAD_VERSION &&
    Array.isArray(value.messages) &&
    isRecord(value.ui) &&
    typeof value.ui.showAgentProcess === "boolean" &&
    typeof value.ui.agentNotice === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function sanitizePersistedAuthoringAgentSessionPayload(
  payload: PersistedAuthoringAgentSessionPayload,
): PersistedAuthoringAgentSessionPayload {
  return {
    version: AUTHORING_AGENT_SESSION_PAYLOAD_VERSION,
    updatedAt: payload.updatedAt,
    messages: payload.messages as AuthoringAgentMessage[],
    ui: {
      showAgentProcess: payload.ui.showAgentProcess,
      agentNotice: payload.ui.agentNotice,
    },
  };
}
