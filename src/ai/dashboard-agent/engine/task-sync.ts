import { randomUUID } from "crypto";
import type { DashboardDocument } from "@/contracts";
import type { DashboardAgentMessage } from "@/ai/dashboard-agent/contracts/agent-contract";
import type { DashboardAgentWorkflow } from "@/ai/dashboard-agent/workflow";
import {
  findLatestApplyPatchApproval,
  findLatestApplyPatchOutput,
} from "@/ai/dashboard-agent/messages/message-inspection";
import type {
  DashboardAgentTaskEvent,
  DashboardAgentTaskPayload,
  DashboardAgentTaskRuntimeStatus,
  DashboardAgentTaskStatus,
} from "@/ai/dashboard-agent/contracts/task-state";

export function resolveTaskDashboard(input: {
  dashboard: DashboardDocument;
  messages: DashboardAgentMessage[];
}) {
  return findLatestApplyPatchOutput(input.messages)?.dashboard ?? input.dashboard;
}

export function buildDashboardAgentTaskSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  workflow: DashboardAgentWorkflow;
  messages: DashboardAgentMessage[];
  updatedAt?: string;
}): Omit<DashboardAgentTaskPayload, "version" | "events" | "intervention"> {
  return {
    sessionId: input.sessionId,
    dashboardId: input.dashboardId ?? null,
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

export function buildDashboardAgentRequestTaskEvent(input: {
  workflow: DashboardAgentWorkflow;
  createdAt?: string;
}): DashboardAgentTaskEvent {
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
  messages: DashboardAgentMessage[];
  createdAt?: string;
}): DashboardAgentTaskEvent | null {
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

function resolveTaskStatus(workflow: DashboardAgentWorkflow): DashboardAgentTaskStatus {
  if (workflow.summary.approval_required) {
    return "awaiting_approval";
  }

  switch (workflow.summary.active_stage) {
    case "approval":
      return "reviewing";
    case "write":
      return "authoring";
    case "read":
    default:
      return workflow.routeDecision.route === "chat" ? "idle" : "authoring";
  }
}

function resolveRuntimeStatus(
  messages: DashboardAgentMessage[],
): DashboardAgentTaskRuntimeStatus {
  const applied = findLatestApplyPatchOutput(messages);
  if (!applied?.summary) {
    return "idle";
  }

  return applied.kind === "data" ? "ok" : "idle";
}
