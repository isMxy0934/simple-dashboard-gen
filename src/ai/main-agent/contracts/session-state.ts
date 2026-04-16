import type { MainAgentMessage } from "@/ai/main-agent/contracts/agent-contract";
import type { Binding, DashboardDocument, QueryDef } from "@/contracts";

export const MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION = 2 as const;

export interface MainAgentWorkingDraftSnapshot {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
  dirtyViewIds: string[];
  dirtyQueryIds: string[];
  dirtyBindingIds: string[];
  layoutTouched: boolean;
  stagedAt: string;
}

export interface MainAgentChatSessionState {
  sessionId: string;
  dashboardId: string | null;
  messages: MainAgentMessage[];
  ui: {
    showAgentProcess: boolean;
    agentNotice: string;
  };
  prompt: {
    lastContextFingerprint: string | null;
    workingDraft: MainAgentWorkingDraftSnapshot | null;
  };
}

export interface MainAgentChatSessionPayload
  extends MainAgentChatSessionState {
  version: typeof MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION;
  updatedAt: string;
}

export function buildEmptyMainAgentChatSessionState(input: {
  sessionId: string;
  dashboardId?: string | null;
}): MainAgentChatSessionState {
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
      workingDraft: null,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMainAgentWorkingDraftSnapshot(
  value: unknown,
): value is MainAgentWorkingDraftSnapshot {
  return (
    isRecord(value) &&
    (value.dashboardSpec === undefined || isRecord(value.dashboardSpec)) &&
    (value.queryDefs === undefined || Array.isArray(value.queryDefs)) &&
    (value.bindings === undefined || Array.isArray(value.bindings)) &&
    (value.bindingMode === undefined ||
      value.bindingMode === "mock" ||
      value.bindingMode === "live") &&
    isStringArray(value.dirtyViewIds) &&
    isStringArray(value.dirtyQueryIds) &&
    isStringArray(value.dirtyBindingIds) &&
    typeof value.layoutTouched === "boolean" &&
    typeof value.stagedAt === "string"
  );
}

export function sanitizeMainAgentWorkingDraftSnapshot(
  snapshot: MainAgentWorkingDraftSnapshot | null | undefined,
): MainAgentWorkingDraftSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    ...(snapshot.dashboardSpec
      ? { dashboardSpec: cloneJson(snapshot.dashboardSpec) }
      : {}),
    ...(snapshot.queryDefs ? { queryDefs: cloneJson(snapshot.queryDefs) } : {}),
    ...(snapshot.bindings ? { bindings: cloneJson(snapshot.bindings) } : {}),
    ...(snapshot.bindingMode ? { bindingMode: snapshot.bindingMode } : {}),
    dirtyViewIds: [...snapshot.dirtyViewIds],
    dirtyQueryIds: [...snapshot.dirtyQueryIds],
    dirtyBindingIds: [...snapshot.dirtyBindingIds],
    layoutTouched: snapshot.layoutTouched,
    stagedAt: snapshot.stagedAt,
  };
}

export function isMainAgentChatSessionPayload(
  value: unknown,
): value is MainAgentChatSessionPayload {
  return (
    isRecord(value) &&
    value.version === MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION &&
    typeof value.sessionId === "string" &&
    (value.dashboardId === null || typeof value.dashboardId === "string") &&
    Array.isArray(value.messages) &&
    isRecord(value.ui) &&
    typeof value.ui.showAgentProcess === "boolean" &&
    typeof value.ui.agentNotice === "string" &&
    (!("prompt" in value) ||
      (isRecord(value.prompt) &&
        (value.prompt.lastContextFingerprint === null ||
          typeof value.prompt.lastContextFingerprint === "string") &&
        (value.prompt.workingDraft === undefined ||
          value.prompt.workingDraft === null ||
          isMainAgentWorkingDraftSnapshot(value.prompt.workingDraft)))) &&
    typeof value.updatedAt === "string"
  );
}

export function sanitizeMainAgentChatSessionPayload(
  payload: MainAgentChatSessionPayload,
): MainAgentChatSessionPayload {
  return {
    version: MAIN_AGENT_CHAT_SESSION_PAYLOAD_VERSION,
    sessionId: payload.sessionId,
    dashboardId: payload.dashboardId ?? null,
    updatedAt: payload.updatedAt,
    messages: payload.messages as MainAgentMessage[],
    ui: {
      showAgentProcess: payload.ui.showAgentProcess,
      agentNotice: payload.ui.agentNotice,
    },
    prompt: {
      lastContextFingerprint: payload.prompt?.lastContextFingerprint ?? null,
      workingDraft: sanitizeMainAgentWorkingDraftSnapshot(
        payload.prompt?.workingDraft,
      ),
    },
  };
}
