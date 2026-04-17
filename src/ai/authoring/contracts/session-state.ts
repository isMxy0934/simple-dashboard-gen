import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";
import type { Binding, DashboardDocument, QueryDef } from "@/contracts";

export const AUTHORING_CHAT_SESSION_PAYLOAD_VERSION = 1 as const;

export interface AuthoringWorkingDraftSnapshot {
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

export interface AuthoringRunCheckStateSnapshot {
  fingerprint: string;
  signatures: string[];
  consecutiveRepeatCount: number;
}

export interface AuthoringChatSessionState {
  sessionId: string;
  dashboardId: string | null;
  messages: AuthoringMessage[];
  ui: {
    showAgentProcess: boolean;
    agentNotice: string;
  };
  prompt: {
    lastContextFingerprint: string | null;
    workingDraft: AuthoringWorkingDraftSnapshot | null;
    lastRunCheckState: AuthoringRunCheckStateSnapshot | null;
  };
}

export interface AuthoringChatSessionPayload
  extends AuthoringChatSessionState {
  version: typeof AUTHORING_CHAT_SESSION_PAYLOAD_VERSION;
  updatedAt: string;
}

export function buildEmptyAuthoringChatSessionState(input: {
  sessionId: string;
  dashboardId?: string | null;
}): AuthoringChatSessionState {
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
      lastRunCheckState: null,
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

function isAuthoringWorkingDraftSnapshot(
  value: unknown,
): value is AuthoringWorkingDraftSnapshot {
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

function isAuthoringRunCheckStateSnapshot(
  value: unknown,
): value is AuthoringRunCheckStateSnapshot {
  return (
    isRecord(value) &&
    typeof value.fingerprint === "string" &&
    isStringArray(value.signatures) &&
    typeof value.consecutiveRepeatCount === "number"
  );
}

export function sanitizeAuthoringWorkingDraftSnapshot(
  snapshot: AuthoringWorkingDraftSnapshot | null | undefined,
): AuthoringWorkingDraftSnapshot | null {
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

export function sanitizeAuthoringRunCheckStateSnapshot(
  snapshot: AuthoringRunCheckStateSnapshot | null | undefined,
): AuthoringRunCheckStateSnapshot | null {
  if (!snapshot) {
    return null;
  }

  return {
    fingerprint: snapshot.fingerprint,
    signatures: [...snapshot.signatures],
    consecutiveRepeatCount: snapshot.consecutiveRepeatCount,
  };
}

export function isAuthoringChatSessionPayload(
  value: unknown,
): value is AuthoringChatSessionPayload {
  return (
    isRecord(value) &&
    value.version === AUTHORING_CHAT_SESSION_PAYLOAD_VERSION &&
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
          isAuthoringWorkingDraftSnapshot(value.prompt.workingDraft)) &&
        (value.prompt.lastRunCheckState === undefined ||
          value.prompt.lastRunCheckState === null ||
          isAuthoringRunCheckStateSnapshot(value.prompt.lastRunCheckState)))) &&
    typeof value.updatedAt === "string"
  );
}

export function sanitizeAuthoringChatSessionPayload(
  payload: AuthoringChatSessionPayload,
): AuthoringChatSessionPayload {
  return {
    version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
    sessionId: payload.sessionId,
    dashboardId: payload.dashboardId ?? null,
    updatedAt: payload.updatedAt,
    messages: payload.messages as AuthoringMessage[],
    ui: {
      showAgentProcess: payload.ui.showAgentProcess,
      agentNotice: payload.ui.agentNotice,
    },
    prompt: {
      lastContextFingerprint: payload.prompt?.lastContextFingerprint ?? null,
      workingDraft: sanitizeAuthoringWorkingDraftSnapshot(
        payload.prompt?.workingDraft,
      ),
      lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
        payload.prompt?.lastRunCheckState,
      ),
    },
  };
}
