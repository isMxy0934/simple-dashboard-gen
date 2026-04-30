import {
  AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
  type AuthoringChatSessionPayload,
  type AuthoringChatSessionState,
  type AuthoringRunCheckStateSnapshot,
  type AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import { sanitizeAuthoringMessages } from "@/ai/authoring/messages/ui-message-sanitize";
import type { AuthoringGoalV2, WorkflowStateV2 } from "@/ai/authoring/v2/types";

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

function isAuthoringGoalV2(value: unknown): value is AuthoringGoalV2 {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ["create_view", "revise_view", "create_dashboard"].includes(
      String(value.kind),
    ) &&
    [
      "active",
      "awaiting_user",
      "awaiting_approval",
      "blocked",
      "completed",
      "failed",
    ].includes(String(value.status)) &&
    typeof value.summary === "string" &&
    ["live", "mock", "undecided"].includes(String(value.dataMode)) &&
    isRecord(value.targetRefs) &&
    Array.isArray(value.blockers) &&
    value.blockers.every(
      (blocker) =>
        isRecord(blocker) &&
        typeof blocker.kind === "string" &&
        typeof blocker.message === "string",
    ) &&
    typeof value.createdFromTurnId === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isWorkflowStateV2(value: unknown): value is WorkflowStateV2 {
  return (
    isRecord(value) &&
    Array.isArray(value.goals) &&
    value.goals.every(isAuthoringGoalV2) &&
    (value.activeGoalId === null || typeof value.activeGoalId === "string") &&
    (value.pendingProposalId === undefined ||
      typeof value.pendingProposalId === "string") &&
    (value.pendingProposalBaseVersion === undefined ||
      typeof value.pendingProposalBaseVersion === "number") &&
    (value.pendingProposalDraftFingerprint === undefined ||
      typeof value.pendingProposalDraftFingerprint === "string")
  );
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
      workflowV2: null,
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

export function sanitizeWorkflowStateV2Snapshot(
  snapshot: WorkflowStateV2 | null | undefined,
): WorkflowStateV2 | null {
  if (!snapshot || !isWorkflowStateV2(snapshot)) {
    return null;
  }

  return {
    goals: cloneJson(snapshot.goals),
    activeGoalId: snapshot.activeGoalId,
    ...(snapshot.pendingProposalId
      ? { pendingProposalId: snapshot.pendingProposalId.slice(0, 200) }
      : {}),
    ...(typeof snapshot.pendingProposalBaseVersion === "number"
      ? { pendingProposalBaseVersion: snapshot.pendingProposalBaseVersion }
      : {}),
    ...(typeof snapshot.pendingProposalDraftFingerprint === "string"
      ? { pendingProposalDraftFingerprint: snapshot.pendingProposalDraftFingerprint.slice(0, 200) }
      : {}),
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
    (!("prompt" in value) ||
      (isRecord(value.prompt) &&
        (value.prompt.lastContextFingerprint === null ||
          typeof value.prompt.lastContextFingerprint === "string") &&
        (value.prompt.workingDraft === undefined ||
          value.prompt.workingDraft === null ||
          isAuthoringWorkingDraftSnapshot(value.prompt.workingDraft)) &&
        (value.prompt.lastRunCheckState === undefined ||
          value.prompt.lastRunCheckState === null ||
          isAuthoringRunCheckStateSnapshot(value.prompt.lastRunCheckState)) &&
        (value.prompt.workflowV2 === undefined ||
          value.prompt.workflowV2 === null ||
          isWorkflowStateV2(value.prompt.workflowV2)))) &&
    typeof value.updatedAt === "string"
  );
}

export function sanitizeAuthoringChatSessionPayload(
  payload: AuthoringChatSessionPayload,
): AuthoringChatSessionPayload {
  const record = payload as AuthoringChatSessionPayload & {
    version?: unknown;
  };
  const prompt = record.prompt;
  return {
    version: AUTHORING_CHAT_SESSION_PAYLOAD_VERSION,
    sessionId: record.sessionId,
    dashboardId: record.dashboardId ?? null,
    updatedAt: record.updatedAt ?? new Date().toISOString(),
    messages: sanitizeAuthoringMessages(record.messages ?? []),
    prompt: {
      lastContextFingerprint:
        record.version === AUTHORING_CHAT_SESSION_PAYLOAD_VERSION
          ? prompt?.lastContextFingerprint ?? null
          : null,
      workingDraft: sanitizeAuthoringWorkingDraftSnapshot(prompt?.workingDraft),
      lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
        prompt?.lastRunCheckState,
      ),
      workflowV2: sanitizeWorkflowStateV2Snapshot(prompt?.workflowV2),
    },
  };
}
