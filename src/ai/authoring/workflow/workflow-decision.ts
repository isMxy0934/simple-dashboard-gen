import { isWorkflowToolAllowed } from "@/ai/authoring/workflow/capabilities";
import type {
  ApprovalState,
  ArtifactStatus,
  AuthoringGoal,
  ContextStatus,
  ToolAvailability,
  TurnIntent,
  WorkflowAction,
  AuthoringWorkflowState,
} from "@/ai/authoring/workflow/types";
import {
  allChildGoalsCompleted,
  getActiveGoal,
  nextSiblingGoal,
  normalizeAuthoringWorkflowState,
} from "@/ai/authoring/workflow/workflow-state";

function hasGoalSchemaContext(goal: AuthoringGoal, contextStatus: ContextStatus): boolean {
  if (goal.dataMode !== "live") {
    return true;
  }
  const loaded = contextStatus.schemaLoadedFor;
  if (!loaded || !goal.targetRefs.datasourceId) {
    return false;
  }
  if (loaded.datasourceId !== goal.targetRefs.datasourceId) {
    return false;
  }
  if (goal.targetRefs.table && loaded.table !== goal.targetRefs.table) {
    return false;
  }
  if (goal.contextRefs?.schemaFingerprint) {
    return Boolean(
      loaded.fingerprint &&
        loaded.fingerprint === goal.contextRefs.schemaFingerprint,
    );
  }
  return true;
}

function hasGoalChartSkillContext(goal: AuthoringGoal, contextStatus: ContextStatus): boolean {
  const expectedSkillId = goal.chartPlan?.chartSkillId;
  const loaded = contextStatus.chartSkillLoadedFor;
  return Boolean(
    expectedSkillId &&
      loaded?.skillId === expectedSkillId &&
      (!goal.contextRefs?.chartSkillVersion ||
        !loaded.version ||
        loaded.version === goal.contextRefs.chartSkillVersion),
  );
}

function hasAvailableChartSkillContext(
  goal: AuthoringGoal,
  contextStatus: ContextStatus,
): boolean {
  const skillId = goal.chartPlan?.chartSkillId;
  return Boolean(skillId && contextStatus.availableChartSkillIds.includes(skillId));
}

function artifactReadyForCompose(status: ArtifactStatus) {
  return (
    status.dataModeConsistent &&
    (!status.query.required || (status.query.exists && status.query.valid)) &&
    (!status.view.required || (status.view.exists && status.view.valid)) &&
    (!status.binding.required ||
      (status.binding.exists &&
        status.binding.valid &&
        status.binding.missingSlots.length === 0)) &&
    (!status.layout.required ||
      (status.layout.existsDesktop &&
        status.layout.existsMobile &&
        status.layout.valid)) &&
    (!status.runtimeCheck.required || status.runtimeCheck.status === "passed")
  );
}

function firstRuntimeCheckError(status: ArtifactStatus) {
  return status.runtimeCheck.errors[0] ?? {
    code: "run_check_failed",
    message: "Runtime check failed.",
  };
}

function summarizeRuntimeCheckFailure(status: ArtifactStatus): string {
  const error = firstRuntimeCheckError(status);
  return error.message || "Runtime check failed.";
}

function decideNextActionCore(input: {
  intent: TurnIntent;
  workflowState: AuthoringWorkflowState;
  contextStatus: ContextStatus;
  artifactStatus: ArtifactStatus;
  approvalState: ApprovalState;
}): WorkflowAction {
  const {
    intent,
    contextStatus,
    artifactStatus,
    approvalState,
  } = input;
  const workflowState = normalizeAuthoringWorkflowState(input.workflowState);

  if (intent.kind === "approve_patch_event") {
    const matchesPendingProposal =
      approvalState.source === "ui_event" &&
      approvalState.pendingProposalId === intent.proposalId &&
      approvalState.pendingProposalBaseVersion === intent.baseVersion;

    if (intent.decision === "reject" && matchesPendingProposal) {
      return {
        kind: "reject_patch",
        proposalId: intent.proposalId,
        reason: "proposal_rejected",
      };
    }

    if (
      intent.decision === "approve" &&
      matchesPendingProposal &&
      approvalState.userApproved
    ) {
      return { kind: "apply_patch", tool: "applyPatch" };
    }
    return { kind: "answer", reason: "no_approved_pending_proposal" };
  }

  const goal = getActiveGoal(workflowState);
  if (!goal) {
    return {
      kind: "ask_user",
      blocker: "missing_active_goal",
      question: "我还没有明确要创建或修改哪个报表对象。",
    };
  }
  if (goal.status === "blocked" || goal.status === "failed") {
    return { kind: "answer", reason: goal.status };
  }
  if (goal.status === "awaiting_approval") {
    return { kind: "await_approval" };
  }
  if (goal.kind === "create_dashboard") {
    if (!allChildGoalsCompleted(workflowState, goal)) {
      return {
        kind: "block_goal",
        blocker: "incomplete_dashboard_children",
        reason: "Dashboard proposal cannot be composed before every child goal is completed.",
      };
    }
    if (!artifactStatus.patch.composed || artifactStatus.patch.stale) {
      return { kind: "compose_patch", tool: "composePatch" };
    }
    return { kind: "await_approval" };
  }
  if (goal.kind === "revise_view" && !goal.targetRefs.viewId) {
    return { kind: "inspect_view", tool: "getView" };
  }
  if (!goal.chartPlan?.chartSkillId) {
    return {
      kind: "ask_user",
      blocker: "missing_chart_skill",
      question: "你想创建或修改成哪一种图表？",
    };
  }
  if (!hasAvailableChartSkillContext(goal, contextStatus)) {
    return {
      kind: "block_goal",
      blocker: "unsupported_goal",
      reason: `Unsupported chart skill: ${goal.chartPlan.chartSkillId}.`,
    };
  }
  if (goal.dataMode === "undecided") {
    return {
      kind: "ask_user",
      blocker: "ambiguous_data_mode",
      question: "这个图表要使用真实数据，还是先用 mock 数据占位？",
    };
  }
  if (goal.dataMode === "live" && !goal.targetRefs.datasourceId) {
    if (!contextStatus.datasourcesLoaded) {
      return { kind: "prepare_data_context", tool: "getDatasources" };
    }
    return {
      kind: "ask_user",
      blocker: "missing_datasource",
      question: "这个图表要连接哪个数据源或表？",
    };
  }
  if (!artifactStatus.dataModeConsistent) {
    return {
      kind: "block_goal",
      blocker: "data_mode_mismatch",
      reason:
        "The staged artifacts do not match the active goal dataMode. Stop before check/compose and restart or correct this draft.",
    };
  }
  if (goal.dataMode === "live" && !hasGoalSchemaContext(goal, contextStatus)) {
    return { kind: "prepare_query_context", tool: "getSchemaByDatasource" };
  }
  if (!hasGoalChartSkillContext(goal, contextStatus)) {
    return { kind: "prepare_view_context", tool: "loadSkill" };
  }
  if (goal.dataMode === "live" && !artifactStatus.query.exists) {
    return { kind: "stage_query", tool: "upsertQuery" };
  }
  if (!artifactStatus.view.exists) {
    return { kind: "stage_view", tool: "upsertView" };
  }
  if (!artifactStatus.binding.exists || artifactStatus.binding.missingSlots.length > 0) {
    return { kind: "stage_binding", tool: "upsertBinding" };
  }
  if (!artifactStatus.layout.existsDesktop || !artifactStatus.layout.existsMobile) {
    return { kind: "stage_layout", tool: "upsertLayout" };
  }
  if (
    artifactStatus.runtimeCheck.required &&
    (artifactStatus.runtimeCheck.status === "not_run" ||
      artifactStatus.runtimeCheck.status === "stale")
  ) {
    return { kind: "run_check", tool: "runCheck" };
  }
  if (
    artifactStatus.runtimeCheck.required &&
    artifactStatus.runtimeCheck.status === "failed"
  ) {
    const failureMessage = summarizeRuntimeCheckFailure(artifactStatus);
    return {
      kind: "block_goal",
      blocker: "check_failed",
      reason: failureMessage,
    };
  }
  if (goal.parentGoalId && artifactReadyForCompose(artifactStatus) && nextSiblingGoal(workflowState, goal)) {
    return { kind: "complete_goal", reason: "subgoal_artifacts_ready" };
  }
  if (!artifactStatus.patch.composed || artifactStatus.patch.stale) {
    return { kind: "compose_patch", tool: "composePatch" };
  }
  return { kind: "await_approval" };
}

function enforceToolAvailability(input: {
  action: WorkflowAction;
  availability?: ToolAvailability;
}): WorkflowAction {
  if (!input.availability || !("tool" in input.action)) {
    return input.action;
  }
  if (
    isWorkflowToolAllowed({
      action: input.action,
      scopedTools: input.availability.scopedTools,
      scope: input.availability.scope,
      intent: input.availability.intent,
    })
  ) {
    return input.action;
  }
  return {
    kind: "block_goal",
    blocker: "tool_not_allowed",
    reason: `The workflow selected ${input.action.tool}, but the current scope does not allow that tool.`,
  };
}

export function decideNextAction(input: {
  intent: TurnIntent;
  workflowState: AuthoringWorkflowState;
  contextStatus: ContextStatus;
  artifactStatus: ArtifactStatus;
  approvalState: ApprovalState;
  toolAvailability?: ToolAvailability;
}): WorkflowAction {
  return enforceToolAvailability({
    action: decideNextActionCore(input),
    availability: input.toolAvailability,
  });
}
