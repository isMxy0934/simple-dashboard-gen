import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  type AuthoringChatSessionPayload,
  type AuthoringChatSessionState,
  type AuthoringRunCheckStateSnapshot,
  type AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import { sanitizeAgentMessages } from "@/ai/authoring/runtime/llm-boundary";

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
    (value.ownership === undefined || isRecord(value.ownership)) &&
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

function sanitizeRejectedProposalIds(value: unknown): string[] {
  if (!isStringArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

export function buildEmptyAuthoringChatSessionState(input: {
  sessionId: string;
  dashboardId?: string | null;
}): AuthoringChatSessionState {
  return {
    sessionId: input.sessionId,
    dashboardId: input.dashboardId ?? null,
    messages: [],
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
      rejectedProposalIds: [],
    },
  };
}

export function sanitizeAuthoringWorkingDraftSnapshot(
  snapshot: AuthoringWorkingDraftSnapshot | null | undefined,
): AuthoringWorkingDraftSnapshot | null {
  if (!snapshot || !isAuthoringWorkingDraftSnapshot(snapshot)) {
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
    ...(snapshot.ownership ? { ownership: cloneJson(snapshot.ownership) } : {}),
    stagedAt: snapshot.stagedAt,
  };
}

export function sanitizeAuthoringRunCheckStateSnapshot(
  snapshot: AuthoringRunCheckStateSnapshot | null | undefined,
): AuthoringRunCheckStateSnapshot | null {
  if (!snapshot || !isAuthoringRunCheckStateSnapshot(snapshot)) {
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
    "prompt" in value &&
    isRecord(value.prompt) &&
    (value.prompt.lastContextFingerprint === null ||
      typeof value.prompt.lastContextFingerprint === "string") &&
    (value.prompt.workingDraft === undefined ||
      value.prompt.workingDraft === null ||
      isAuthoringWorkingDraftSnapshot(value.prompt.workingDraft)) &&
    (value.prompt.lastRunCheckState === undefined ||
      value.prompt.lastRunCheckState === null ||
      isAuthoringRunCheckStateSnapshot(value.prompt.lastRunCheckState)) &&
    (value.prompt.rejectedProposalIds === undefined ||
      isStringArray(value.prompt.rejectedProposalIds)) &&
    typeof value.updatedAt === "string"
  );
}

export function sanitizeAuthoringChatSessionPayload(
  payload: AuthoringChatSessionPayload,
): AuthoringChatSessionPayload {
  if (!isAuthoringChatSessionPayload(payload)) {
    const record: Record<string, unknown> = isRecord(payload) ? payload : {};
    return {
      version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
      ...buildEmptyAuthoringChatSessionState({
        sessionId:
          typeof record.sessionId === "string" ? record.sessionId : "unknown",
        dashboardId:
          typeof record.dashboardId === "string" || record.dashboardId === null
            ? record.dashboardId
            : null,
      }),
      updatedAt:
        typeof record.updatedAt === "string"
          ? record.updatedAt
          : new Date().toISOString(),
    };
  }

  const record = payload as AuthoringChatSessionPayload & {
    version?: unknown;
  };
  const prompt = record.prompt;
  return {
    version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
    sessionId: record.sessionId,
    dashboardId: record.dashboardId ?? null,
    updatedAt: record.updatedAt ?? new Date().toISOString(),
    messages: sanitizeAgentMessages(record.messages ?? []),
    prompt: {
      lastContextFingerprint:
        record.version === AUTHORING_CHAT_SESSION_PAYLOAD_VERSION
          ? prompt?.lastContextFingerprint ?? null
          : null,
      workingDraft: sanitizeAuthoringWorkingDraftSnapshot(prompt?.workingDraft),
      lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
        prompt?.lastRunCheckState,
      ),
      rejectedProposalIds: sanitizeRejectedProposalIds(prompt?.rejectedProposalIds),
    },
  };
}
