import type {
  AuthoringApprovalEvent,
  DeclareAuthoringGoalToolInput,
  DraftStatusToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import {
  getActiveGoal,
} from "@/ai/authoring/workflow";
import type {
  ApprovalState,
  ArtifactStatus,
  TurnIntent,
  WorkflowAction,
  AuthoringWorkflowState,
  WorkflowToolExecution,
} from "@/ai/authoring/workflow/types";

export function isSemanticToolResultError(input: {
  toolName: string;
  result: unknown;
}): boolean {
  if (
    typeof input.result === "object" &&
    input.result !== null &&
    "error" in input.result &&
    (input.result as { error?: unknown }).error !== undefined
  ) {
    return true;
  }

  if (
    input.toolName === "runCheck" &&
    typeof input.result === "object" &&
    input.result !== null &&
    "output" in input.result
  ) {
    const output = (input.result as { output?: unknown }).output;
    return (
      typeof output === "object" &&
      output !== null &&
      "status" in output &&
      (output as { status?: unknown }).status === "error"
    );
  }

  return false;
}

export function buildRuntimeCheckStatus(input: {
  draftStatus: DraftStatusToolOutput;
  goal: ReturnType<typeof getActiveGoal>;
}): ArtifactStatus["runtimeCheck"] | undefined {
  if (input.draftStatus.check_fresh) {
    return { required: true, status: "passed", errors: [] };
  }
  if (input.draftStatus.blockers.includes("stale_check")) {
    return {
      required: true,
      status: input.draftStatus.last_check_hash ? "stale" : "not_run",
      errors: [],
    };
  }
  return undefined;
}

export function buildApprovalState(
  workflowState: AuthoringWorkflowState,
  approvalEvent?: AuthoringApprovalEvent | null,
): ApprovalState {
  return {
    ...(workflowState.pendingProposalId
      ? { pendingProposalId: workflowState.pendingProposalId }
      : {}),
    ...(typeof workflowState.pendingProposalBaseVersion === "number"
      ? { pendingProposalBaseVersion: workflowState.pendingProposalBaseVersion }
      : {}),
    userApproved: approvalEvent?.decision === "approve",
    source: approvalEvent ? "ui_event" : "none",
  };
}

export function explicitEventIntent(
  approvalEvent?: AuthoringApprovalEvent | null,
): TurnIntent | null {
  return approvalEvent
    ? {
        kind: "approve_patch_event",
        proposalId: approvalEvent.proposalId,
        decision: approvalEvent.decision,
        baseVersion: approvalEvent.baseVersion,
      }
    : null;
}

export function declarationToTurnIntent(
  declaration: DeclareAuthoringGoalToolInput,
): TurnIntent {
  if (declaration.kind === "set_data_mode") {
    return { kind: "set_data_mode", dataMode: declaration.dataMode };
  }
  if (declaration.kind === "create_dashboard") {
    return { kind: "create_dashboard", goal: declaration.goal };
  }
  return { kind: declaration.kind, goal: declaration.goal };
}

export function resumeIntentForGoal(goal: ReturnType<typeof getActiveGoal>): TurnIntent | null {
  if (!goal) {
    return null;
  }
  if (goal.kind === "create_dashboard") {
    return {
      kind: "create_dashboard",
      goal: {
        summary: goal.summary,
        dataMode: goal.dataMode,
        datasourceId: goal.targetRefs.datasourceId,
        table: goal.targetRefs.table,
        views: [],
      },
    };
  }
  return {
    kind: goal.kind === "revise_view" ? "revise_view" : "create_view",
    goal: {
      summary: goal.summary,
      dataMode: goal.dataMode,
      chartSkillId: goal.chartPlan?.chartSkillId,
      requestedChartLabel: goal.chartPlan?.requestedChartLabel,
      metrics: goal.chartPlan?.metrics,
      dimensions: goal.chartPlan?.dimensions,
      timeGrain: goal.chartPlan?.timeGrain,
      datasourceId: goal.targetRefs.datasourceId,
      table: goal.targetRefs.table,
      targetViewId: goal.targetRefs.viewId,
    },
  };
}

export function isWorkflowActive(state: AuthoringWorkflowState) {
  const active = getActiveGoal(state);
  if (state.pendingProposalId) {
    return true;
  }
  return Boolean(
    active &&
      active.status !== "blocked" &&
      active.status !== "failed" &&
      active.status !== "completed",
  );
}

export function getWorkflowToolExecution(input: {
  action: WorkflowAction;
  toolResults?: Array<{ toolName?: string; output?: unknown; error?: unknown }>;
}): WorkflowToolExecution {
  const toolName = "tool" in input.action ? input.action.tool : null;
  if (!toolName) {
    return {
      status: "failed",
      reason: "missing_result",
      message: "Workflow action does not have an associated tool.",
    };
  }
  const result = input.toolResults?.find(
    (candidate) => candidate.toolName === toolName,
  );
  if (!result) {
    return {
      status: "failed",
      reason: "missing_result",
      message: `${toolName} did not return a tool result.`,
    };
  }
  if (result.error !== undefined) {
    return {
      status: "failed",
      reason: "tool_error",
      message: `${toolName} returned a tool execution error.`,
      output: result.output,
      error: result.error,
    };
  }
  if (isSemanticToolResultError({ toolName, result })) {
    return {
      status: "failed",
      reason: "semantic_error",
      message: `${toolName} returned a semantic failure result.`,
      output: result.output,
    };
  }
  return { status: "succeeded", output: result.output };
}
