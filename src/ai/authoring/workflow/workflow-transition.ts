import type {
  AuthoringGoal,
  ContextStatus,
  WorkflowAction,
  AuthoringWorkflowState,
  WorkflowToolExecution,
} from "@/ai/authoring/workflow/types";
import {
  clearBlockers,
  getActiveGoal,
  nextSiblingGoal,
  normalizeAuthoringWorkflowState,
  nowIso,
  parentGoal,
  updateActiveGoal,
  updateGoal,
  upsertBlocker,
} from "@/ai/authoring/workflow/workflow-state";

function extractComposedProposalId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (
    "suggestion" in value &&
    typeof (value as { suggestion?: { id?: unknown } }).suggestion?.id === "string"
  ) {
    return (value as { suggestion: { id: string } }).suggestion.id;
  }
  return undefined;
}

function extractComposedDraftFingerprint(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const fingerprint = (value as { draft_fingerprint?: unknown }).draft_fingerprint;
  return typeof fingerprint === "string" && fingerprint ? fingerprint : undefined;
}

function isAppliedPatchOutput(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "applied" in value &&
    (value as { applied?: unknown }).applied === true
  );
}

function toolFailureMessage(
  execution: WorkflowToolExecution | undefined,
  fallback: string,
): string {
  const output = execution?.output;
  if (typeof output === "object" && output !== null) {
    const record = output as {
      reason?: unknown;
      message?: unknown;
      error?: unknown;
      failures?: Array<{ message?: unknown; reason?: unknown }>;
    };
    if (typeof record.reason === "string" && record.reason.trim()) {
      return record.reason;
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
    const firstFailure = record.failures?.[0];
    if (typeof firstFailure?.message === "string" && firstFailure.message.trim()) {
      return firstFailure.message;
    }
    if (typeof firstFailure?.reason === "string" && firstFailure.reason.trim()) {
      return firstFailure.reason;
    }
  }
  return execution?.status === "failed" ? execution.message : fallback;
}

function blockGoalForToolFailure(input: {
  state: AuthoringWorkflowState;
  blocker: string;
  reason: string;
  now: string;
  clearPendingProposal?: boolean;
}): AuthoringWorkflowState {
  return updateActiveGoal(
    {
      ...input.state,
      ...(input.clearPendingProposal
        ? {
            pendingProposalId: undefined,
            pendingProposalBaseVersion: undefined,
            pendingProposalDraftFingerprint: undefined,
          }
        : {}),
    },
    (goal) => ({
      ...goal,
      status: "blocked",
      blockers: upsertBlocker(goal.blockers, input.blocker, input.reason),
      updatedAt: input.now,
    }),
  );
}

function extractViewRefsFromOutput(output: unknown): Partial<AuthoringGoal["targetRefs"]> {
  if (typeof output !== "object" || output === null) {
    return {};
  }
  const record = output as {
    match_status?: unknown;
    view?: {
      view?: { id?: unknown };
      query_ids?: unknown;
      bindings?: Array<{ binding?: { id?: unknown } }>;
    };
  };
  if (record.match_status !== "exact" || !record.view) {
    return {};
  }
  const bindingIds = Array.isArray(record.view.bindings)
    ? record.view.bindings
        .map((entry) => entry.binding?.id)
        .filter((id): id is string => typeof id === "string")
    : [];
  return {
    ...(typeof record.view.view?.id === "string" ? { viewId: record.view.view.id } : {}),
    ...(Array.isArray(record.view.query_ids) && typeof record.view.query_ids[0] === "string"
      ? { queryId: record.view.query_ids[0] }
      : {}),
    ...(bindingIds.length ? { bindingIds } : {}),
  };
}

function contextRefsFromStatus(
  contextStatus?: ContextStatus,
): AuthoringGoal["contextRefs"] | undefined {
  if (!contextStatus) {
    return undefined;
  }
  return {
    ...(contextStatus.schemaLoadedFor?.fingerprint
      ? { schemaFingerprint: contextStatus.schemaLoadedFor.fingerprint }
      : {}),
    ...(contextStatus.chartSkillLoadedFor?.version
      ? { chartSkillVersion: contextStatus.chartSkillLoadedFor.version }
      : {}),
  };
}

function activateNextGoalAfterCompletion(
  state: AuthoringWorkflowState,
  completedGoal: AuthoringGoal,
): AuthoringWorkflowState {
  const nextSibling = nextSiblingGoal(state, completedGoal);
  if (nextSibling) {
    return { ...state, activeGoalId: nextSibling.id };
  }
  const parent = parentGoal(state, completedGoal);
  if (!parent) {
    return { ...state, activeGoalId: null };
  }
  return updateGoal(
    { ...state, activeGoalId: parent.id },
    parent.id,
    (goal) => ({ ...goal, status: "active", updatedAt: completedGoal.updatedAt }),
  );
}

export function applyWorkflowTransition(input: {
  state: AuthoringWorkflowState;
  action: WorkflowAction;
  toolExecution?: WorkflowToolExecution;
  baseVersion?: number;
  now?: string;
  contextStatus?: ContextStatus;
}): AuthoringWorkflowState {
  const now = input.now ?? nowIso();
  const state = normalizeAuthoringWorkflowState(input.state);
  const { action } = input;
  if (action.kind === "complete_goal") {
    const active = getActiveGoal(state);
    if (!active) {
      return state;
    }
    const completed = {
      ...active,
      status: "completed" as const,
      updatedAt: now,
    };
    return activateNextGoalAfterCompletion(
      updateGoal(state, active.id, () => completed),
      completed,
    );
  }
  if (action.kind === "ask_user") {
    return updateActiveGoal(state, (goal) => ({
      ...goal,
      status: "awaiting_user",
      blockers: upsertBlocker(goal.blockers, action.blocker, action.question),
      updatedAt: now,
    }));
  }
  if (action.kind === "block_goal") {
    return updateActiveGoal(state, (goal) => ({
      ...goal,
      status: "blocked",
      blockers: upsertBlocker(goal.blockers, action.blocker, action.reason),
      updatedAt: now,
    }));
  }
  if (action.kind === "reject_patch") {
    return updateActiveGoal(
      {
        ...state,
        pendingProposalId: undefined,
        pendingProposalBaseVersion: undefined,
        pendingProposalDraftFingerprint: undefined,
      },
      (goal) => ({
        ...goal,
        status: "blocked",
        blockers: upsertBlocker(
          goal.blockers,
          "proposal_rejected",
          "The pending patch proposal was rejected by the user.",
        ),
        updatedAt: now,
      }),
    );
  }
  if (action.kind === "inspect_view") {
    if (!input.toolExecution || input.toolExecution.status === "failed") {
      return blockGoalForToolFailure({
        state,
        blocker: "inspect_view_failed",
        reason:
          input.toolExecution?.message ??
          "getView did not return a successful tool result.",
        now,
      });
    }
    const refs = extractViewRefsFromOutput(input.toolExecution.output);
    if (!refs.viewId) {
      return updateActiveGoal(state, (goal) => ({
        ...goal,
        status: "awaiting_user",
        blockers: upsertBlocker(
          goal.blockers,
          "missing_target_view",
          "I could not resolve which existing view should be revised.",
        ),
        updatedAt: now,
      }));
    }
    return updateActiveGoal(state, (goal) => ({
      ...goal,
      status: "active",
      targetRefs: { ...goal.targetRefs, ...refs },
      blockers: clearBlockers(goal.blockers, ["missing_target_view"]),
      updatedAt: now,
    }));
  }
  if (
    action.kind === "prepare_query_context" ||
    (action.kind === "prepare_data_context" && action.tool === "getSchemaByDatasource") ||
    action.kind === "prepare_view_context"
  ) {
    if (!input.toolExecution || input.toolExecution.status === "failed") {
      return blockGoalForToolFailure({
        state,
        blocker: `${action.tool}_failed`,
        reason:
          input.toolExecution?.message ??
          `${action.tool} did not return a successful tool result.`,
        now,
      });
    }
    const contextRefs = contextRefsFromStatus(input.contextStatus);
    return contextRefs
      ? updateActiveGoal(state, (goal) => ({
          ...goal,
          contextRefs: { ...goal.contextRefs, ...contextRefs },
          updatedAt: now,
        }))
      : state;
  }
  if (action.kind === "compose_patch") {
    if (!input.toolExecution || input.toolExecution.status === "failed") {
      return blockGoalForToolFailure({
        state,
        blocker: "compose_patch_failed",
        reason:
          input.toolExecution?.message ??
          "composePatch did not return a successful tool result.",
        now,
        clearPendingProposal: true,
      });
    }

    const proposalId = extractComposedProposalId(input.toolExecution.output);
    const draftFingerprint = extractComposedDraftFingerprint(input.toolExecution.output);
    if (!proposalId || !draftFingerprint) {
      return blockGoalForToolFailure({
        state,
        blocker: "compose_patch_invalid_output",
        reason: "composePatch succeeded without a valid patch proposal id and draft fingerprint.",
        now,
        clearPendingProposal: true,
      });
    }

    const active = getActiveGoal(state);
    const proposalGoal = active?.parentGoalId
      ? parentGoal(state, active) ?? active
      : active;
    const nextState: AuthoringWorkflowState = {
      ...state,
      pendingProposalId: proposalId,
      pendingProposalBaseVersion:
        typeof input.baseVersion === "number" ? input.baseVersion : undefined,
      pendingProposalDraftFingerprint: draftFingerprint,
    };
    return proposalGoal
      ? updateGoal(nextState, proposalGoal.id, (goal) => ({
          ...goal,
          status: "awaiting_approval",
          updatedAt: now,
        }))
      : nextState;
  }
  if (action.kind === "run_check") {
    if (!input.toolExecution || input.toolExecution.status === "failed") {
      const message = toolFailureMessage(
        input.toolExecution,
        "runCheck did not return a successful tool result.",
      );
      return blockGoalForToolFailure({
        state,
        blocker: "check_failed",
        reason: message,
        now,
      });
    }
    return updateActiveGoal(state, (goal) => ({
      ...goal,
      blockers: clearBlockers(goal.blockers, ["check_failed"]),
      updatedAt: now,
    }));
  }
  if (
    action.kind === "stage_query" ||
    action.kind === "stage_view" ||
    action.kind === "stage_binding" ||
    action.kind === "stage_layout"
  ) {
    if (!input.toolExecution || input.toolExecution.status === "failed") {
      return blockGoalForToolFailure({
        state,
        blocker: `${action.tool}_failed`,
        reason:
          input.toolExecution?.message ??
          `${action.tool} did not return a successful tool result.`,
        now,
      });
    }
    const clearKinds =
      action.kind === "stage_query"
        ? ["missing_query_requirements"]
        : action.kind === "stage_view"
          ? ["missing_view_requirements"]
          : action.kind === "stage_binding"
            ? ["missing_binding_requirements"]
            : ["missing_layout_requirements"];
    return updateActiveGoal(state, (goal) => {
      return {
        ...goal,
        status: "active",
        blockers: clearBlockers(goal.blockers, clearKinds),
        updatedAt: now,
      };
    });
  }
  if (action.kind === "apply_patch") {
    if (!input.toolExecution || input.toolExecution.status === "failed") {
      return blockGoalForToolFailure({
        state,
        blocker: "apply_patch_failed",
        reason:
          input.toolExecution?.message ??
          "applyPatch did not return a successful tool result.",
        now,
        clearPendingProposal: true,
      });
    }
    if (!isAppliedPatchOutput(input.toolExecution.output)) {
      return blockGoalForToolFailure({
        state,
        blocker: "apply_patch_invalid_output",
        reason: "applyPatch succeeded without confirming that the patch was applied.",
        now,
        clearPendingProposal: true,
      });
    }
    return {
      ...state,
      pendingProposalId: undefined,
      pendingProposalBaseVersion: undefined,
      pendingProposalDraftFingerprint: undefined,
      activeGoalId: null,
      goals: state.goals.map((goal) => ({
        ...goal,
        status: goal.status === "blocked" || goal.status === "failed"
          ? goal.status
          : "completed",
        updatedAt: now,
      })),
    };
  }
  return state;
}
