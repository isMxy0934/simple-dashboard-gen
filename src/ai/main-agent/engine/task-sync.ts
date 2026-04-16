import { randomUUID } from "crypto";
import type { DashboardDocument } from "@/contracts";
import type { MainAgentMessage } from "@/ai/main-agent/contracts/agent-contract";
import type { WorkerWorkflow } from "@/ai/dashboard-worker/workflow";
import {
  findLatestApplyPatchApproval,
  findLatestApplyPatchOutput,
} from "@/ai/main-agent/messages/message-inspection";
import type {
  MainAgentTaskEvent,
  MainAgentTaskPayload,
  MainAgentTaskRuntimeStatus,
  MainAgentTaskStatus,
} from "@/ai/main-agent/contracts/task-state";

export function resolveTaskDashboard(input: {
  dashboard: DashboardDocument;
  messages: MainAgentMessage[];
}) {
  return findLatestApplyPatchOutput(input.messages)?.dashboard ?? input.dashboard;
}

export function buildMainAgentTaskSnapshot(input: {
  sessionId: string;
  dashboardId?: string | null;
  dashboard: DashboardDocument;
  workflow: WorkerWorkflow;
  messages: MainAgentMessage[];
  updatedAt?: string;
}): Omit<MainAgentTaskPayload, "version" | "events" | "intervention"> {
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

export function buildMainAgentRequestTaskEvent(input: {
  workflow: WorkerWorkflow;
  createdAt?: string;
}): MainAgentTaskEvent {
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
  messages: MainAgentMessage[];
  createdAt?: string;
}): MainAgentTaskEvent | null {
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

function resolveTaskStatus(workflow: WorkerWorkflow): MainAgentTaskStatus {
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
  messages: MainAgentMessage[],
): MainAgentTaskRuntimeStatus {
  const applied = findLatestApplyPatchOutput(messages);
  if (!applied?.summary) {
    return "idle";
  }

  return applied.kind === "data" ? "ok" : "idle";
}
