import { createGoalFromIntentV2 } from "@/ai/authoring/v2/intent";
import { expectedDataFormatShapeForGoalV2 } from "@/ai/authoring/v2/context-shape";
import type {
  ApprovalStateV2,
  ArtifactStatusV2,
  AuthoringGoalV2,
  ContextStatusV2,
  ForcedToolStepV2,
  TurnIntentV2,
  ViewGoalV2,
  WorkflowActionV2,
  WorkflowStateV2,
  WorkflowToolExecutionV2,
} from "@/ai/authoring/v2/types";

function nowIso() {
  return new Date().toISOString();
}

function hasGoalSchemaContext(goal: AuthoringGoalV2, contextStatus: ContextStatusV2): boolean {
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
  return true;
}

function hasSchemaContextForIntent(
  intent: Extract<TurnIntentV2, { kind: "explore_data" }>,
  contextStatus: ContextStatusV2,
): boolean {
  if (intent.scope === "datasources") {
    return contextStatus.datasourcesLoaded;
  }
  const loaded = contextStatus.schemaLoadedFor;
  if (!loaded || !intent.datasourceId) {
    return false;
  }
  if (loaded.datasourceId !== intent.datasourceId) {
    return false;
  }
  if (intent.table && loaded.table !== intent.table) {
    return false;
  }
  return true;
}

function hasGoalChartSkillContext(goal: AuthoringGoalV2, contextStatus: ContextStatusV2): boolean {
  const chartType = goal.chartPlan?.chartType;
  return Boolean(
    chartType &&
      contextStatus.chartSkillLoadedFor?.chartType === chartType &&
      contextStatus.chartSkillLoadedFor.referenceKey,
  );
}

function hasGoalDataFormatContext(goal: AuthoringGoalV2, contextStatus: ContextStatusV2): boolean {
  const expectedShape = expectedDataFormatShapeForGoalV2(goal);
  const loaded = contextStatus.dataFormatSkillLoadedFor;
  return Boolean(
    expectedShape &&
      loaded?.referenceKey &&
      loaded.shape === expectedShape,
  );
}

function isSupportedChartType(chartType: ViewGoalV2["chartType"] | undefined): boolean {
  return chartType === "line" || chartType === "bar" || chartType === "kpi";
}

export function reduceIntentToWorkflowStateV2(input: {
  state?: WorkflowStateV2 | null;
  intent: TurnIntentV2 | null;
  turnId: string;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
  pendingProposalId?: string | null;
  pendingProposalBaseVersion?: number | null;
  now?: string;
}): WorkflowStateV2 {
  const state = input.state ?? { activeGoal: null };
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
  };

  if (!input.intent) {
    return withPending;
  }

  if (input.intent.kind === "set_data_mode") {
    return withPending.activeGoal
      ? {
          ...withPending,
          activeGoal: {
            ...withPending.activeGoal,
            status: "active",
            dataMode: input.intent.dataMode,
            blockers: withPending.activeGoal.blockers.filter(
              (blocker) => blocker.kind !== "ambiguous_data_mode",
            ),
            updatedAt: now,
          },
        }
      : withPending;
  }

  if (input.intent.kind !== "create_view") {
    return withPending;
  }

  const current = withPending.activeGoal;
  if (
    current &&
    current.kind === "create_view" &&
    current.status !== "completed" &&
    current.status !== "blocked" &&
    current.status !== "failed"
  ) {
    const nextDataMode = input.intent.goal.dataMode ?? current.dataMode;
    return {
      ...withPending,
      activeGoal: {
        ...current,
        status: current.status === "awaiting_user" ? "active" : current.status,
        summary: input.intent.goal.summary?.trim() || current.summary,
        dataMode: nextDataMode,
        chartPlan: {
          ...current.chartPlan,
          ...(input.intent.goal.chartType ? { chartType: input.intent.goal.chartType } : {}),
          ...(input.intent.goal.metrics ? { metrics: [...input.intent.goal.metrics] } : {}),
          ...(input.intent.goal.dimensions ? { dimensions: [...input.intent.goal.dimensions] } : {}),
          ...(input.intent.goal.timeGrain ? { timeGrain: input.intent.goal.timeGrain } : {}),
        },
        targetRefs: {
          ...current.targetRefs,
          ...(input.intent.goal.datasourceId || input.selectedDatasourceId
            ? { datasourceId: input.intent.goal.datasourceId ?? input.selectedDatasourceId ?? undefined }
            : {}),
          ...(input.intent.goal.table || input.selectedTable
            ? { table: input.intent.goal.table ?? input.selectedTable ?? undefined }
            : {}),
        },
        blockers: current.blockers.filter(
          (blocker) =>
            blocker.kind !== "ambiguous_data_mode" &&
            blocker.kind !== "missing_chart_type",
        ),
        updatedAt: now,
      },
    };
  }

  return {
    ...withPending,
    activeGoal: createGoalFromIntentV2({
      intent: input.intent,
      turnId: input.turnId,
      now,
      selectedDatasourceId: input.selectedDatasourceId,
      selectedTable: input.selectedTable,
    }),
  };
}

export function decideNextActionV2(input: {
  intent: TurnIntentV2;
  workflowState: WorkflowStateV2;
  contextStatus: ContextStatusV2;
  artifactStatus: ArtifactStatusV2;
  approvalState: ApprovalStateV2;
}): WorkflowActionV2 {
  const { intent, workflowState, contextStatus, artifactStatus, approvalState } = input;

  if (intent.kind === "chat" || intent.kind === "advise_analysis") {
    return { kind: "answer", reason: intent.kind === "chat" ? "chat_only" : "advise_only" };
  }

  if (intent.kind === "explore_data") {
    if (intent.scope === "datasources" && !contextStatus.datasourcesLoaded) {
      return { kind: "prepare_data_context", tool: "getDatasources" };
    }
    if (intent.scope === "schema" && !hasSchemaContextForIntent(intent, contextStatus)) {
      return { kind: "prepare_data_context", tool: "getSchemaByDatasource" };
    }
    return { kind: "answer", reason: "data_context_ready" };
  }

  if (intent.kind === "approve_patch_text") {
    return workflowState.pendingProposalId
      ? { kind: "await_approval" }
      : { kind: "answer", reason: "no_pending_proposal_for_text_approval" };
  }

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

  const goal = workflowState.activeGoal;
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
  if (!goal.chartPlan?.chartType) {
    return {
      kind: "ask_user",
      blocker: "missing_chart_type",
      question: "你想创建折线图、柱状图，还是 KPI 指标卡？",
    };
  }
  if (!isSupportedChartType(goal.chartPlan.chartType)) {
    return {
      kind: "block_goal",
      blocker: "unsupported_goal",
      reason:
        "This chart type is outside the v2.1 MVP workflow. Supported chart types are line, bar, and kpi.",
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
        "The staged artifacts do not match the active goal dataMode. Stop before check/compose and repair or restart this draft.",
    };
  }
  if (goal.dataMode === "live" && !hasGoalSchemaContext(goal, contextStatus)) {
    return { kind: "prepare_query_context", tool: "getSchemaByDatasource" };
  }
  if (!hasGoalChartSkillContext(goal, contextStatus)) {
    return { kind: "prepare_view_context", tool: "loadSkillReference", referenceKind: "chart" };
  }
  if (goal.dataMode === "live" && !artifactStatus.query.exists) {
    return { kind: "stage_query", tool: "upsertQuery" };
  }
  if (!artifactStatus.view.exists) {
    return { kind: "stage_view", tool: "upsertView" };
  }
  if (
    artifactStatus.binding.required &&
    (!artifactStatus.binding.exists || artifactStatus.binding.missingSlots.length > 0) &&
    !hasGoalDataFormatContext(goal, contextStatus)
  ) {
    return { kind: "prepare_view_context", tool: "loadSkillReference", referenceKind: "data_format" };
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
    return {
      kind: "block_goal",
      blocker: "check_failed",
      reason:
        "Runtime check failed. MVP does not auto-repair; stop and surface the error.",
    };
  }
  if (!artifactStatus.patch.composed || artifactStatus.patch.stale) {
    return { kind: "compose_patch", tool: "composePatch" };
  }
  return { kind: "await_approval" };
}

export function prepareForcedToolStepV2(action: WorkflowActionV2): ForcedToolStepV2 {
  if (
    action.kind === "answer" ||
    action.kind === "ask_user" ||
    action.kind === "block_goal" ||
    action.kind === "reject_patch" ||
    action.kind === "await_approval"
  ) {
    return { activeTools: [], toolChoice: "none" };
  }
  return {
    activeTools: [action.tool],
    toolChoice: { type: "tool", toolName: action.tool },
  };
}

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

function isAppliedPatchOutput(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "applied" in value &&
    (value as { applied?: unknown }).applied === true
  );
}

function blockGoalForToolFailure(input: {
  state: WorkflowStateV2;
  blocker: string;
  reason: string;
  now: string;
  clearPendingProposal?: boolean;
}): WorkflowStateV2 {
  return {
    ...input.state,
    ...(input.clearPendingProposal
      ? { pendingProposalId: undefined, pendingProposalBaseVersion: undefined }
      : {}),
    activeGoal: input.state.activeGoal
      ? {
          ...input.state.activeGoal,
          status: "blocked",
          blockers: [
            ...input.state.activeGoal.blockers,
            { kind: input.blocker, message: input.reason },
          ],
          updatedAt: input.now,
        }
      : null,
  };
}

export function applyWorkflowTransitionV2(input: {
  state: WorkflowStateV2;
  action: WorkflowActionV2;
  toolExecution?: WorkflowToolExecutionV2;
  baseVersion?: number;
  now?: string;
}): WorkflowStateV2 {
  const now = input.now ?? nowIso();
  const { state, action } = input;
  if (action.kind === "ask_user" && state.activeGoal) {
    return {
      ...state,
      activeGoal: {
        ...state.activeGoal,
        status: "awaiting_user",
        blockers: [
          ...state.activeGoal.blockers,
          { kind: action.blocker, message: action.question },
        ],
        updatedAt: now,
      },
    };
  }
  if (action.kind === "block_goal" && state.activeGoal) {
    return {
      ...state,
      activeGoal: {
        ...state.activeGoal,
        status: "blocked",
        blockers: [
          ...state.activeGoal.blockers,
          { kind: action.blocker, message: action.reason },
        ],
        updatedAt: now,
      },
    };
  }
  if (action.kind === "reject_patch") {
    return {
      ...state,
      pendingProposalId: undefined,
      pendingProposalBaseVersion: undefined,
      activeGoal: state.activeGoal
        ? {
            ...state.activeGoal,
            status: "blocked",
            blockers: [
              ...state.activeGoal.blockers,
              {
                kind: "proposal_rejected",
                message: "The pending patch proposal was rejected by the user.",
              },
            ],
            updatedAt: now,
          }
        : null,
    };
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
    if (!proposalId) {
      return blockGoalForToolFailure({
        state,
        blocker: "compose_patch_invalid_output",
        reason: "composePatch succeeded without a valid patch proposal id.",
        now,
        clearPendingProposal: true,
      });
    }

    return {
      ...state,
      pendingProposalId: proposalId,
      pendingProposalBaseVersion:
        typeof input.baseVersion === "number" ? input.baseVersion : undefined,
      activeGoal: state.activeGoal
        ? { ...state.activeGoal, status: "awaiting_approval", updatedAt: now }
        : null,
    };
  }
  if (action.kind === "run_check") {
    return state;
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
      activeGoal: state.activeGoal
        ? { ...state.activeGoal, status: "completed", updatedAt: now }
        : null,
    };
  }
  return state;
}
