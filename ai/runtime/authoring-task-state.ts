import type { ContractStateSummary } from "./agent-contract";
import type { AuthoringRouteDecision } from "./authoring-route";

export type AuthoringTaskStatus =
  | "idle"
  | "authoring"
  | "awaiting_approval"
  | "repairing"
  | "reviewing"
  | "intervention"
  | "published";

export type AuthoringTaskRuntimeStatus =
  | "idle"
  | "loading"
  | "ok"
  | "warning"
  | "error";

export type AuthoringTaskEventKind =
  | "agent_request"
  | "workflow_update"
  | "approval_requested"
  | "patch_applied"
  | "layout_intervention"
  | "contract_intervention"
  | "view_added"
  | "draft_saved"
  | "dashboard_published";

export interface AuthoringTaskEvent {
  id: string;
  kind: AuthoringTaskEventKind;
  title: string;
  detail: string;
  createdAt: string;
  dedupeKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AuthoringTaskInterventionState {
  kind: "layout" | "contract";
  active: boolean;
  viewId?: string | null;
  viewTitle?: string | null;
  updatedAt: string;
}

export interface PersistedAuthoringTaskPayload {
  version: 1;
  sessionKey: string;
  dashboardId: string | null;
  dashboardName: string;
  status: AuthoringTaskStatus;
  route: AuthoringRouteDecision["route"] | null;
  activeStage: ContractStateSummary["next_step"];
  summary: string;
  currentGoal: string;
  activeTools: string[];
  activeSkills: string[];
  pendingApproval: boolean;
  runtimeStatus: AuthoringTaskRuntimeStatus;
  intervention: AuthoringTaskInterventionState | null;
  events: AuthoringTaskEvent[];
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildEmptyAuthoringTaskState(input: {
  sessionKey: string;
  dashboardId?: string | null;
  dashboardName?: string;
  updatedAt?: string;
}): PersistedAuthoringTaskPayload {
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  return {
    version: 1,
    sessionKey: input.sessionKey,
    dashboardId: input.dashboardId ?? null,
    dashboardName: input.dashboardName ?? "Untitled Dashboard",
    status: "idle",
    route: null,
    activeStage: "layout",
    summary: "Authoring task is ready.",
    currentGoal: "",
    activeTools: [],
    activeSkills: [],
    pendingApproval: false,
    runtimeStatus: "idle",
    intervention: null,
    events: [],
    updatedAt,
  };
}

export function isPersistedAuthoringTaskPayload(
  value: unknown,
): value is PersistedAuthoringTaskPayload {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.sessionKey === "string" &&
    (value.dashboardId === null || typeof value.dashboardId === "string") &&
    typeof value.dashboardName === "string" &&
    typeof value.status === "string" &&
    (typeof value.route === "string" || value.route === null) &&
    typeof value.activeStage === "string" &&
    typeof value.summary === "string" &&
    typeof value.currentGoal === "string" &&
    Array.isArray(value.activeTools) &&
    Array.isArray(value.activeSkills) &&
    typeof value.pendingApproval === "boolean" &&
    typeof value.runtimeStatus === "string" &&
    Array.isArray(value.events) &&
    typeof value.updatedAt === "string"
  );
}

export function sanitizePersistedAuthoringTaskPayload(
  payload: PersistedAuthoringTaskPayload,
): PersistedAuthoringTaskPayload {
  return {
    version: 1,
    sessionKey: payload.sessionKey,
    dashboardId: payload.dashboardId ?? null,
    dashboardName: payload.dashboardName,
    status: payload.status,
    route: payload.route ?? null,
    activeStage: payload.activeStage,
    summary: payload.summary,
    currentGoal: payload.currentGoal,
    activeTools: [...payload.activeTools],
    activeSkills: [...payload.activeSkills],
    pendingApproval: payload.pendingApproval,
    runtimeStatus: payload.runtimeStatus,
    intervention: payload.intervention
      ? {
          kind: payload.intervention.kind,
          active: payload.intervention.active,
          viewId: payload.intervention.viewId ?? null,
          viewTitle: payload.intervention.viewTitle ?? null,
          updatedAt: payload.intervention.updatedAt,
        }
      : null,
    events: payload.events.slice(-40).map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title,
      detail: event.detail,
      createdAt: event.createdAt,
      dedupeKey: event.dedupeKey,
      metadata: event.metadata ? { ...event.metadata } : undefined,
    })),
    updatedAt: payload.updatedAt,
  };
}
