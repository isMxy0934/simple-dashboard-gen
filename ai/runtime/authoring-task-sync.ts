import { randomUUID } from "crypto";
import type { DashboardDocument } from "../../contracts";
import type { AuthoringAgentMessage } from "./agent-contract";
import type { DashboardAuthoringWorkflow } from "../workflow/dashboard-authoring-workflow";
import {
  findLatestApplyPatchApproval,
  findLatestApplyPatchOutput,
} from "./message-inspection";
import type {
  AuthoringTaskEvent,
  AuthoringTaskRuntimeStatus,
  AuthoringTaskStatus,
  PersistedAuthoringTaskPayload,
} from "./authoring-task-state";

export function parseDashboardIdFromSessionKey(sessionKey: string) {
  if (!sessionKey.startsWith("dashboard:")) {
    return null;
  }

  const dashboardId = sessionKey.slice("dashboard:".length).trim();
  if (!dashboardId || dashboardId === "local-draft" || dashboardId.startsWith("local:")) {
    return null;
  }

  return dashboardId;
}

export function resolveTaskDashboard(input: {
  dashboard: DashboardDocument;
  messages: AuthoringAgentMessage[];
}) {
  return findLatestApplyPatchOutput(input.messages)?.dashboard ?? input.dashboard;
}

export function buildAuthoringTaskSnapshot(input: {
  sessionKey: string;
  dashboard: DashboardDocument;
  workflow: DashboardAuthoringWorkflow;
  messages: AuthoringAgentMessage[];
  updatedAt?: string;
}): Omit<PersistedAuthoringTaskPayload, "version" | "events" | "intervention"> {
  return {
    sessionKey: input.sessionKey,
    dashboardId: parseDashboardIdFromSessionKey(input.sessionKey),
    dashboardName: input.dashboard.dashboard_spec.dashboard.name,
    status: resolveTaskStatus(input.workflow),
    route: input.workflow.routeDecision.route,
    activeStage: input.workflow.summary.active_stage,
    summary: input.workflow.summary.summary,
    currentGoal: input.workflow.routeDecision.user_goal,
    activeTools: [...input.workflow.summary.active_tools],
    activeSkills: [...input.workflow.summary.skill_ids],
    pendingApproval: input.workflow.summary.approval_required,
    runtimeStatus: resolveRuntimeStatus(input.messages),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function buildAgentRequestTaskEvent(input: {
  workflow: DashboardAuthoringWorkflow;
  createdAt?: string;
}): AuthoringTaskEvent {
  const createdAt = input.createdAt ?? new Date().toISOString();

  return {
    id: `task-event-${randomUUID()}`,
    kind: "agent_request",
    title: "Agent request received",
    detail: input.workflow.routeDecision.user_goal,
    createdAt,
    dedupeKey: `request:${input.workflow.latestUserRequest}`,
    metadata: {
      route: input.workflow.routeDecision.route,
      next_stage: input.workflow.summary.active_stage,
    },
  };
}

export function buildTaskOutcomeEvent(input: {
  messages: AuthoringAgentMessage[];
  createdAt?: string;
}): AuthoringTaskEvent | null {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const approval = findLatestApplyPatchApproval(input.messages);

  if (approval) {
    return {
      id: `task-event-${randomUUID()}`,
      kind: "approval_requested",
      title: "Proposal awaiting approval",
      detail: "The agent staged a patch and is waiting for human approval before apply.",
      createdAt,
      dedupeKey: `approval:${approval.approvalId}`,
      metadata: {
        approval_id: approval.approvalId,
        suggestion_id: approval.suggestionId ?? "",
      },
    };
  }

  const applied = findLatestApplyPatchOutput(input.messages);
  if (applied) {
    return {
      id: `task-event-${randomUUID()}`,
      kind: "patch_applied",
      title: applied.title,
      detail: applied.summary,
      createdAt,
      dedupeKey: `patch:${applied.suggestion_id}`,
      metadata: {
        suggestion_id: applied.suggestion_id,
        kind: applied.kind,
      },
    };
  }

  return null;
}

function resolveTaskStatus(workflow: DashboardAuthoringWorkflow): AuthoringTaskStatus {
  if (workflow.summary.approval_required) {
    return "awaiting_approval";
  }

  switch (workflow.summary.active_stage) {
    case "repair":
      return "repairing";
    case "review":
      return "reviewing";
    case "layout":
    case "data":
      return workflow.routeDecision.route === "chat" ? "idle" : "authoring";
    default:
      return "idle";
  }
}

function resolveRuntimeStatus(
  messages: AuthoringAgentMessage[],
): AuthoringTaskRuntimeStatus {
  const applied = findLatestApplyPatchOutput(messages);
  if (!applied?.summary) {
    return "idle";
  }

  return applied.kind === "data" ? "ok" : "idle";
}
