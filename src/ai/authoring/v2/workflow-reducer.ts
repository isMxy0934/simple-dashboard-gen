import {
  createDashboardGoalsFromIntentV2,
  createGoalFromIntentV2,
} from "@/ai/authoring/v2/intent";
import type {
  TurnIntentV2,
  WorkflowStateV2,
} from "@/ai/authoring/v2/types";
import {
  clearBlockers,
  getActiveGoalV2,
  isTerminalGoalStatus,
  normalizeWorkflowStateV2,
  nowIso,
  updateGoal,
  withGoals,
} from "@/ai/authoring/v2/workflow-state";

export function reduceIntentToWorkflowStateV2(input: {
  state?: WorkflowStateV2 | null;
  intent: TurnIntentV2 | null;
  turnId: string;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
  pendingProposalId?: string | null;
  pendingProposalBaseVersion?: number | null;
  pendingProposalDraftFingerprint?: string | null;
  now?: string;
}): WorkflowStateV2 {
  const state = normalizeWorkflowStateV2(input.state);
  const now = input.now ?? nowIso();
  const withPending = {
    ...state,
    ...(input.pendingProposalId && !state.pendingProposalId
      ? { pendingProposalId: input.pendingProposalId }
      : {}),
    ...(typeof input.pendingProposalBaseVersion === "number" &&
    input.pendingProposalId &&
    state.pendingProposalBaseVersion === undefined
      ? { pendingProposalBaseVersion: input.pendingProposalBaseVersion }
      : {}),
    ...(input.pendingProposalDraftFingerprint && !state.pendingProposalDraftFingerprint
      ? { pendingProposalDraftFingerprint: input.pendingProposalDraftFingerprint }
      : {}),
  };

  if (!input.intent) {
    return withPending;
  }

  const active = getActiveGoalV2(withPending);
  if (input.intent.kind === "set_data_mode") {
    return active
      ? updateGoal(withPending, active.id, (goal) => ({
          ...goal,
          status: "active",
          dataMode: input.intent?.kind === "set_data_mode" ? input.intent.dataMode : goal.dataMode,
          blockers: clearBlockers(goal.blockers, ["ambiguous_data_mode"]),
          updatedAt: now,
        }))
      : withPending;
  }

  if (input.intent.kind === "create_dashboard") {
    const goals = createDashboardGoalsFromIntentV2({
      intent: input.intent,
      turnId: input.turnId,
      now,
      selectedDatasourceId: input.selectedDatasourceId,
      selectedTable: input.selectedTable,
    });
    const firstChild = goals.find((goal) => goal.parentGoalId === goals[0]?.id);
    return withGoals(
      {
        ...withPending,
        pendingProposalId: undefined,
        pendingProposalBaseVersion: undefined,
        pendingProposalDraftFingerprint: undefined,
      },
      goals,
      firstChild?.id ?? goals[0]?.id ?? null,
    );
  }

  if (input.intent.kind !== "create_view" && input.intent.kind !== "revise_view") {
    return withPending;
  }

  const viewIntent = input.intent;
  const viewGoal = viewIntent.goal;
  if (
    active &&
    active.kind === viewIntent.kind &&
    !isTerminalGoalStatus(active.status)
  ) {
    const nextDataMode = viewGoal.dataMode ?? active.dataMode;
    return updateGoal(withPending, active.id, (goal) => ({
      ...goal,
      status: goal.status === "awaiting_user" ? "active" : goal.status,
      summary: viewGoal.summary?.trim() || goal.summary,
      dataMode: nextDataMode,
      chartPlan: {
        ...goal.chartPlan,
        ...(viewGoal.chartSkillId ? { chartSkillId: viewGoal.chartSkillId } : {}),
        ...(viewGoal.requestedChartLabel
          ? { requestedChartLabel: viewGoal.requestedChartLabel }
          : {}),
        ...(viewGoal.metrics ? { metrics: [...viewGoal.metrics] } : {}),
        ...(viewGoal.dimensions ? { dimensions: [...viewGoal.dimensions] } : {}),
        ...(viewGoal.timeGrain ? { timeGrain: viewGoal.timeGrain } : {}),
      },
      targetRefs: {
        ...goal.targetRefs,
        ...(viewGoal.datasourceId || input.selectedDatasourceId
          ? {
              datasourceId:
                viewGoal.datasourceId ?? input.selectedDatasourceId ?? undefined,
            }
          : {}),
        ...(viewGoal.table || input.selectedTable
          ? { table: viewGoal.table ?? input.selectedTable ?? undefined }
          : {}),
        ...(viewGoal.targetViewId
          ? { viewId: viewGoal.targetViewId }
          : {}),
      },
      blockers: clearBlockers(goal.blockers, [
        "ambiguous_data_mode",
        "missing_chart_skill",
        "missing_target_view",
        "missing_datasource",
        "missing_query_requirements",
        "missing_view_requirements",
        "missing_binding_requirements",
        "check_failed",
      ]),
      updatedAt: now,
    }));
  }

  const goal = createGoalFromIntentV2({
    intent: viewIntent,
    turnId: input.turnId,
    now,
    selectedDatasourceId: input.selectedDatasourceId,
    selectedTable: input.selectedTable,
  });
  return goal
    ? withGoals(withPending, [...withPending.goals, goal], goal.id)
    : withPending;
}
