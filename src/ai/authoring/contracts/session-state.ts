import type {
  AuthoringDataMode,
  AuthoringMessage,
} from "@/ai/authoring/contracts/tool-io";
import { sanitizeAuthoringMessages } from "@/ai/authoring/messages/ui-message-sanitize";
import type { Binding, DashboardDocument, QueryDef } from "@/contracts";
import type { AuthoringSkillReferenceCheck } from "@/ai/authoring/skill-checks";
import { sanitizeAuthoringSkillReferenceCheck } from "@/ai/authoring/skill-checks";
import {
  isAuthoringToolGateErrorCode,
  type AuthoringToolGateErrorCode,
} from "@/ai/authoring/tool-gate-error";
import type { AuthoringGoalV2, WorkflowStateV2 } from "@/ai/authoring/v2/types";

export const AUTHORING_CHAT_SESSION_PAYLOAD_VERSION = 2 as const;

export interface AuthoringWorkingDraftArtifactOwner {
  goalId: string;
  artifactKind: "query" | "view" | "binding" | "layout";
  artifactId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthoringWorkingDraftOwnership {
  byArtifactId: Record<string, AuthoringWorkingDraftArtifactOwner>;
  byGoalId: Record<string, string[]>;
  currentByGoal: Record<
    string,
    {
      queryId?: string;
      viewId?: string;
      bindingIds?: string[];
      layoutId?: string;
    }
  >;
}

export interface AuthoringWorkingDraftSnapshot {
  dashboardSpec?: DashboardDocument["dashboard_spec"];
  queryDefs?: QueryDef[];
  bindings?: Binding[];
  bindingMode?: "mock" | "live";
  dirtyViewIds: string[];
  dirtyQueryIds: string[];
  dirtyBindingIds: string[];
  layoutTouched: boolean;
  ownership?: AuthoringWorkingDraftOwnership;
  stagedAt: string;
}

export interface AuthoringRunCheckStateSnapshot {
  fingerprint: string;
  signatures: string[];
  consecutiveRepeatCount: number;
}

export type AuthoringRouteAdviceRoute =
  | "chat"
  | "explore"
  | "author-dashboard"
  | "author-focused"
  | "approval";

export type AuthoringRouteAdviceDataContextStatus =
  | "missing"
  | "candidate-recommended"
  | "confirmed";

export interface AuthoringRouteAdvice {
  route: AuthoringRouteAdviceRoute;
  reason: string;
  confidence: number;
  dataContextStatus: AuthoringRouteAdviceDataContextStatus;
  shouldAskBlocker: boolean;
  recommendedSkillIds: string[];
}

export interface AuthoringToolFailureSnapshot {
  toolName:
    | "upsertQuery"
    | "upsertView"
    | "upsertBinding"
    | "upsertLayout"
    | "runCheck"
    | "composePatch"
    | "applyPatch";
  errorSummary: string;
  code?: AuthoringToolGateErrorCode;
  userSafeSummary?: string;
  recoveryHint?: string;
  retryable?: boolean;
  attemptCount: number;
  lastOccurredAt: string;
}

export interface AuthoringTaskStateSnapshot {
  dataMode?: AuthoringDataMode;
  goalSummary?: string;
  selectedDataContext?: {
    datasourceId?: string;
    tableName?: string;
    reason?: string;
  };
  lastRouteDecision?: AuthoringRouteAdvice;
  loadedSkillReferences: string[];
  loadedSkillReferenceChecks?: AuthoringSkillReferenceCheck[];
  lastFailedTool?: AuthoringToolFailureSnapshot;
  lastBlockerQuestion?: string;
  updatedAt: string;
}

export interface AuthoringChatSessionState {
  sessionId: string;
  dashboardId: string | null;
  messages: AuthoringMessage[];
  prompt: {
    lastContextFingerprint: string | null;
    workingDraft: AuthoringWorkingDraftSnapshot | null;
    lastRunCheckState: AuthoringRunCheckStateSnapshot | null;
    taskState: AuthoringTaskStateSnapshot | null;
    workflowV2?: WorkflowStateV2 | null;
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
    prompt: {
      lastContextFingerprint: null,
      workingDraft: null,
      lastRunCheckState: null,
      taskState: null,
      workflowV2: null,
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

function isAuthoringRouteAdvice(value: unknown): value is AuthoringRouteAdvice {
  return (
    isRecord(value) &&
    [
      "chat",
      "explore",
      "author-dashboard",
      "author-focused",
      "approval",
    ].includes(String(value.route)) &&
    typeof value.reason === "string" &&
    typeof value.confidence === "number" &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    ["missing", "candidate-recommended", "confirmed"].includes(
      String(value.dataContextStatus),
    ) &&
    typeof value.shouldAskBlocker === "boolean" &&
    isStringArray(value.recommendedSkillIds)
  );
}

function isAuthoringToolFailureSnapshot(
  value: unknown,
): value is AuthoringToolFailureSnapshot {
  return (
    isRecord(value) &&
    [
      "upsertQuery",
      "upsertView",
      "upsertBinding",
      "upsertLayout",
      "runCheck",
      "composePatch",
      "applyPatch",
    ].includes(String(value.toolName)) &&
    typeof value.errorSummary === "string" &&
    (value.code === undefined || isAuthoringToolGateErrorCode(value.code)) &&
    (value.userSafeSummary === undefined ||
      typeof value.userSafeSummary === "string") &&
    (value.recoveryHint === undefined ||
      typeof value.recoveryHint === "string") &&
    (value.retryable === undefined || typeof value.retryable === "boolean") &&
    typeof value.attemptCount === "number" &&
    typeof value.lastOccurredAt === "string"
  );
}

function isSelectedDataContext(
  value: unknown,
): value is NonNullable<AuthoringTaskStateSnapshot["selectedDataContext"]> {
  return (
    isRecord(value) &&
    (value.datasourceId === undefined || typeof value.datasourceId === "string") &&
    (value.tableName === undefined || typeof value.tableName === "string") &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function isAuthoringGoalV2(value: unknown): value is AuthoringGoalV2 {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ["create_view", "revise_view", "create_dashboard", "repair_draft"].includes(
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
    (value.activeGoal === null || isAuthoringGoalV2(value.activeGoal)) &&
    (value.pendingProposalId === undefined ||
      typeof value.pendingProposalId === "string") &&
    (value.pendingProposalBaseVersion === undefined ||
      typeof value.pendingProposalBaseVersion === "number")
  );
}

function isAuthoringTaskStateSnapshot(
  value: unknown,
): value is AuthoringTaskStateSnapshot {
  return (
    isRecord(value) &&
    (value.dataMode === undefined ||
      value.dataMode === "live" ||
      value.dataMode === "mock" ||
      value.dataMode === "undecided") &&
    (value.goalSummary === undefined || typeof value.goalSummary === "string") &&
    (value.selectedDataContext === undefined ||
      isSelectedDataContext(value.selectedDataContext)) &&
    (value.lastRouteDecision === undefined ||
      isAuthoringRouteAdvice(value.lastRouteDecision)) &&
    isStringArray(value.loadedSkillReferences) &&
    (value.loadedSkillReferenceChecks === undefined ||
      (Array.isArray(value.loadedSkillReferenceChecks) &&
        value.loadedSkillReferenceChecks.every(
          (check) => sanitizeAuthoringSkillReferenceCheck(check) !== null,
        ))) &&
    (value.lastFailedTool === undefined ||
      isAuthoringToolFailureSnapshot(value.lastFailedTool)) &&
    (value.lastBlockerQuestion === undefined ||
      typeof value.lastBlockerQuestion === "string") &&
    typeof value.updatedAt === "string"
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
    ...(snapshot.ownership
      ? { ownership: cloneJson(snapshot.ownership) }
      : {}),
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

export function sanitizeAuthoringRouteAdvice(
  advice: AuthoringRouteAdvice | null | undefined,
): AuthoringRouteAdvice | undefined {
  if (!advice || !isAuthoringRouteAdvice(advice)) {
    return undefined;
  }
  return {
    route: advice.route,
    reason: advice.reason.slice(0, 500),
    confidence: Math.max(0, Math.min(1, advice.confidence)),
    dataContextStatus: advice.dataContextStatus,
    shouldAskBlocker: advice.shouldAskBlocker,
    recommendedSkillIds: [...new Set(advice.recommendedSkillIds)].slice(0, 8),
  };
}

export function sanitizeAuthoringTaskStateSnapshot(
  snapshot: AuthoringTaskStateSnapshot | null | undefined,
): AuthoringTaskStateSnapshot | null {
  if (!snapshot || !isAuthoringTaskStateSnapshot(snapshot)) {
    return null;
  }
  return {
    ...(snapshot.dataMode ? { dataMode: snapshot.dataMode } : {}),
    ...(snapshot.goalSummary
      ? { goalSummary: snapshot.goalSummary.slice(0, 500) }
      : {}),
    ...(snapshot.selectedDataContext
      ? { selectedDataContext: { ...snapshot.selectedDataContext } }
      : {}),
    ...(snapshot.lastRouteDecision
      ? { lastRouteDecision: sanitizeAuthoringRouteAdvice(snapshot.lastRouteDecision) }
      : {}),
    loadedSkillReferences: [...new Set(snapshot.loadedSkillReferences)].slice(0, 20),
    ...(snapshot.loadedSkillReferenceChecks?.length
      ? {
          loadedSkillReferenceChecks: snapshot.loadedSkillReferenceChecks
            .map(sanitizeAuthoringSkillReferenceCheck)
            .filter((check): check is AuthoringSkillReferenceCheck => check !== null)
            .slice(0, 20),
        }
      : {}),
    ...(snapshot.lastFailedTool
      ? {
          lastFailedTool: {
            toolName: snapshot.lastFailedTool.toolName,
            errorSummary: snapshot.lastFailedTool.errorSummary.slice(0, 500),
            ...(snapshot.lastFailedTool.code
              ? { code: snapshot.lastFailedTool.code }
              : {}),
            ...(snapshot.lastFailedTool.userSafeSummary
              ? {
                  userSafeSummary:
                    snapshot.lastFailedTool.userSafeSummary.slice(0, 500),
                }
              : {}),
            ...(snapshot.lastFailedTool.recoveryHint
              ? {
                  recoveryHint:
                    snapshot.lastFailedTool.recoveryHint.slice(0, 500),
                }
              : {}),
            ...(typeof snapshot.lastFailedTool.retryable === "boolean"
              ? { retryable: snapshot.lastFailedTool.retryable }
              : {}),
            attemptCount: snapshot.lastFailedTool.attemptCount,
            lastOccurredAt: snapshot.lastFailedTool.lastOccurredAt,
          },
        }
      : {}),
    ...(snapshot.lastBlockerQuestion
      ? { lastBlockerQuestion: snapshot.lastBlockerQuestion.slice(0, 500) }
      : {}),
    updatedAt: snapshot.updatedAt,
  };
}

export function sanitizeWorkflowStateV2Snapshot(
  snapshot: WorkflowStateV2 | null | undefined,
): WorkflowStateV2 | null {
  if (!snapshot || !isWorkflowStateV2(snapshot)) {
    return null;
  }

  return {
    activeGoal: snapshot.activeGoal ? cloneJson(snapshot.activeGoal) : null,
    ...(snapshot.pendingProposalId
      ? { pendingProposalId: snapshot.pendingProposalId.slice(0, 200) }
      : {}),
    ...(typeof snapshot.pendingProposalBaseVersion === "number"
      ? { pendingProposalBaseVersion: snapshot.pendingProposalBaseVersion }
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
        (value.prompt.taskState === undefined ||
          value.prompt.taskState === null ||
          isAuthoringTaskStateSnapshot(value.prompt.taskState)) &&
        (value.prompt.workflowV2 === undefined ||
          value.prompt.workflowV2 === null ||
          isWorkflowStateV2(value.prompt.workflowV2)))) &&
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
    messages: sanitizeAuthoringMessages(payload.messages),
    prompt: {
      lastContextFingerprint: payload.prompt?.lastContextFingerprint ?? null,
      workingDraft: sanitizeAuthoringWorkingDraftSnapshot(
        payload.prompt?.workingDraft,
      ),
      lastRunCheckState: sanitizeAuthoringRunCheckStateSnapshot(
        payload.prompt?.lastRunCheckState,
      ),
      taskState: sanitizeAuthoringTaskStateSnapshot(payload.prompt?.taskState),
      workflowV2: sanitizeWorkflowStateV2Snapshot(payload.prompt?.workflowV2),
    },
  };
}
