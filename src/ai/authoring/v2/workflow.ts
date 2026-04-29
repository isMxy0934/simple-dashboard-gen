import {
  createDashboardGoalsFromIntentV2,
  createGoalFromIntentV2,
} from "@/ai/authoring/v2/intent";
import { expectedDataFormatShapeForGoalV2 } from "@/ai/authoring/v2/context-shape";
import { findChartCapabilityV2 } from "@/ai/authoring/v2/chart-capabilities";
import type {
  ApprovalStateV2,
  ArtifactStatusV2,
  AuthoringGoalV2,
  ContextStatusV2,
  RepairArtifactTargetV2,
  ToolStepV2,
  TurnIntentV2,
  WorkflowActionV2,
  WorkflowStateV2,
  WorkflowToolExecutionV2,
} from "@/ai/authoring/v2/types";

function nowIso() {
  return new Date().toISOString();
}

function emptyWorkflowState(): WorkflowStateV2 {
  return { goals: [], activeGoalId: null };
}

export function normalizeWorkflowStateV2(
  state?: (WorkflowStateV2 & { activeGoal?: AuthoringGoalV2 | null }) | null,
): WorkflowStateV2 {
  if (!state) {
    return emptyWorkflowState();
  }
  const legacyGoal = state.activeGoal ?? null;
  const goals = Array.isArray(state.goals)
    ? state.goals
    : legacyGoal
      ? [legacyGoal]
      : [];
  const activeGoalId =
    state.activeGoalId ??
    legacyGoal?.id ??
    goals.find((goal) => !isTerminalGoalStatus(goal.status))?.id ??
    null;
  return {
    goals,
    activeGoalId,
    ...(state.pendingProposalId ? { pendingProposalId: state.pendingProposalId } : {}),
    ...(typeof state.pendingProposalBaseVersion === "number"
      ? { pendingProposalBaseVersion: state.pendingProposalBaseVersion }
      : {}),
  };
}

function isTerminalGoalStatus(status: AuthoringGoalV2["status"]) {
  return status === "blocked" || status === "failed" || status === "completed";
}

export function getActiveGoalV2(state: WorkflowStateV2): AuthoringGoalV2 | null {
  const normalized = Array.isArray(state.goals)
    ? state
    : normalizeWorkflowStateV2(state as WorkflowStateV2 & { activeGoal?: AuthoringGoalV2 | null });
  const explicit = normalized.activeGoalId
    ? normalized.goals.find((goal) => goal.id === normalized.activeGoalId)
    : null;
  if (explicit && explicit.kind !== "create_dashboard") {
    return explicit;
  }
  if (explicit?.kind === "create_dashboard") {
    const child = normalized.goals.find(
      (goal) =>
        goal.parentGoalId === explicit.id &&
        !isTerminalGoalStatus(goal.status),
    );
    if (child) {
      return child;
    }
  }
  return normalized.goals.find((goal) => !isTerminalGoalStatus(goal.status)) ?? null;
}

function activeGoalIdForState(state: WorkflowStateV2): string | null {
  return getActiveGoalV2(state)?.id ?? state.activeGoalId ?? null;
}

function withGoals(
  state: WorkflowStateV2,
  goals: AuthoringGoalV2[],
  activeGoalId = activeGoalIdForState({ ...state, goals }),
): WorkflowStateV2 {
  return {
    ...state,
    goals,
    activeGoalId,
  };
}

function updateGoal(
  state: WorkflowStateV2,
  goalId: string,
  updater: (goal: AuthoringGoalV2) => AuthoringGoalV2,
): WorkflowStateV2 {
  return withGoals(
    state,
    state.goals.map((goal) => (goal.id === goalId ? updater(goal) : goal)),
  );
}

function updateActiveGoal(
  state: WorkflowStateV2,
  updater: (goal: AuthoringGoalV2) => AuthoringGoalV2,
): WorkflowStateV2 {
  const goal = getActiveGoalV2(state);
  return goal ? updateGoal(state, goal.id, updater) : state;
}

function upsertBlocker(
  blockers: AuthoringGoalV2["blockers"],
  kind: string,
  message: string,
) {
  return [
    ...blockers.filter((blocker) => blocker.kind !== kind),
    { kind, message },
  ];
}

function clearBlockers(
  blockers: AuthoringGoalV2["blockers"],
  kinds: string[],
) {
  const blocked = new Set(kinds);
  return blockers.filter((blocker) => !blocked.has(blocker.kind));
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
  if (goal.contextRefs?.schemaFingerprint) {
    return Boolean(
      loaded.fingerprint &&
        loaded.fingerprint === goal.contextRefs.schemaFingerprint,
    );
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
  const capability = findChartCapabilityV2(goal.chartPlan?.chartType);
  const expectedReference = goal.chartPlan?.capabilityRef ?? capability?.referenceKey;
  const loaded = contextStatus.chartSkillLoadedFor;
  return Boolean(
    expectedReference &&
      loaded?.referenceKey === expectedReference &&
      (!goal.contextRefs?.chartSkillVersion ||
        !loaded.version ||
        loaded.version === goal.contextRefs.chartSkillVersion),
  );
}

function hasGoalDataFormatContext(goal: AuthoringGoalV2, contextStatus: ContextStatusV2): boolean {
  const expectedShape = expectedDataFormatShapeForGoalV2(goal);
  const loaded = contextStatus.dataFormatSkillLoadedFor;
  return Boolean(
    expectedShape &&
      loaded?.referenceKey &&
      loaded.shape === expectedShape &&
      (!goal.contextRefs?.dataFormatSkillVersion ||
        !loaded.version ||
        loaded.version === goal.contextRefs.dataFormatSkillVersion),
  );
}

function nextSiblingGoal(
  state: WorkflowStateV2,
  goal: AuthoringGoalV2,
): AuthoringGoalV2 | null {
  if (!goal.parentGoalId) {
    return null;
  }
  return (
    state.goals.find(
      (candidate) =>
        candidate.parentGoalId === goal.parentGoalId &&
        candidate.id !== goal.id &&
        !isTerminalGoalStatus(candidate.status),
    ) ?? null
  );
}

function parentGoal(state: WorkflowStateV2, goal: AuthoringGoalV2): AuthoringGoalV2 | null {
  return goal.parentGoalId
    ? state.goals.find((candidate) => candidate.id === goal.parentGoalId) ?? null
    : null;
}

function artifactReadyForCompose(status: ArtifactStatusV2) {
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

function firstRuntimeCheckError(status: ArtifactStatusV2) {
  return status.runtimeCheck.errors[0] ?? {
    code: "run_check_failed",
    message: "Runtime check failed.",
  };
}

function classifyRuntimeCheckRepairTarget(
  errors: ArtifactStatusV2["runtimeCheck"]["errors"],
): RepairArtifactTargetV2 {
  const text = errors
    .map((error) => `${error.code} ${error.message}`)
    .join("\n")
    .toLowerCase();
  if (/\b(sql|query|schema|table|column|field|datasource|source|select|where|group by)\b/.test(text)) {
    return "query";
  }
  if (/\b(renderer|view|chart|series|option|echarts|visual|axis)\b/.test(text)) {
    return "view";
  }
  if (/\b(binding|slot|selector|value|missing|required|mock|param|mapping)\b/.test(text)) {
    return "binding";
  }
  return "binding";
}

function repairToolForTarget(target: RepairArtifactTargetV2): Extract<
  WorkflowActionV2,
  { kind: "repair_artifact" }
>["tool"] {
  switch (target) {
    case "query":
      return "upsertQuery";
    case "view":
      return "upsertView";
    default:
      return "upsertBinding";
  }
}

function summarizeRuntimeCheckFailure(status: ArtifactStatusV2): string {
  const error = firstRuntimeCheckError(status);
  return error.message || "Runtime check failed.";
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
          repairState: undefined,
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
    const capability = findChartCapabilityV2(viewGoal.chartType);
    return updateGoal(withPending, active.id, (goal) => ({
      ...goal,
      status: goal.status === "awaiting_user" ? "active" : goal.status,
      summary: viewGoal.summary?.trim() || goal.summary,
      dataMode: nextDataMode,
      chartPlan: {
        ...goal.chartPlan,
        ...(viewGoal.chartType
          ? {
              chartType: viewGoal.chartType,
              capabilityRef: capability?.referenceKey ?? goal.chartPlan?.capabilityRef,
              dataShape: capability?.dataShape ?? goal.chartPlan?.dataShape,
            }
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
        "missing_chart_type",
        "missing_target_view",
        "missing_datasource",
        "missing_query_requirements",
        "missing_view_requirements",
        "missing_binding_requirements",
        "check_failed",
      ]),
      repairState: undefined,
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

export function decideNextActionV2(input: {
  intent: TurnIntentV2;
  workflowState: WorkflowStateV2;
  contextStatus: ContextStatusV2;
  artifactStatus: ArtifactStatusV2;
  approvalState: ApprovalStateV2;
}): WorkflowActionV2 {
  const {
    intent,
    contextStatus,
    artifactStatus,
    approvalState,
  } = input;
  const workflowState = normalizeWorkflowStateV2(input.workflowState);

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

  const goal = getActiveGoalV2(workflowState);
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
  if (goal.kind === "revise_view" && !goal.targetRefs.viewId) {
    return { kind: "inspect_view", tool: "getView" };
  }
  if (!goal.chartPlan?.chartType) {
    return {
      kind: "ask_user",
      blocker: "missing_chart_type",
      question: "你想创建或修改成哪一种图表？",
    };
  }
  const capability = findChartCapabilityV2(goal.chartPlan.chartType);
  if (!capability || (goal.kind === "create_view" && !capability.supportsCreate) ||
    (goal.kind === "revise_view" && !capability.supportsRevise)) {
    return {
      kind: "block_goal",
      blocker: "unsupported_goal",
      reason: `Unsupported chart type: ${goal.chartPlan.chartType}.`,
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
    const attempts = goal.repairState?.runCheckAttempts ?? 0;
    const failureMessage = summarizeRuntimeCheckFailure(artifactStatus);
    if (attempts < 1) {
      const target = classifyRuntimeCheckRepairTarget(artifactStatus.runtimeCheck.errors);
      return {
        kind: "repair_artifact",
        target,
        tool: repairToolForTarget(target),
        reason: failureMessage,
      };
    }
    return {
      kind: "ask_user",
      blocker: "check_failed",
      question: `运行检查仍未通过：${failureMessage}。请确认要调整哪些字段、绑定或图表设置后我再继续。`,
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

export function prepareToolStepV2(action: WorkflowActionV2): ToolStepV2 {
  if (
    action.kind === "answer" ||
    action.kind === "complete_goal" ||
    action.kind === "ask_user" ||
    action.kind === "block_goal" ||
    action.kind === "reject_patch" ||
    action.kind === "await_approval"
  ) {
    return { mode: "terminal", activeTools: [], toolChoice: "none" };
  }
  if (
    action.kind === "stage_query" ||
    action.kind === "stage_view" ||
    action.kind === "stage_binding" ||
    action.kind === "stage_layout" ||
    action.kind === "repair_artifact"
  ) {
    return {
      mode: "soft",
      activeTools: [action.tool],
      toolChoice: "auto",
    };
  }
  return {
    mode: "forced",
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

function toolFailureMessage(
  execution: WorkflowToolExecutionV2 | undefined,
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

function clearRepairStateAfterDraftMutation(goal: AuthoringGoalV2): AuthoringGoalV2 {
  if (!goal.repairState) {
    return goal;
  }
  return {
    ...goal,
    repairState: {
      runCheckAttempts: goal.repairState.runCheckAttempts,
      ...(goal.repairState.target ? { target: goal.repairState.target } : {}),
    },
    blockers: clearBlockers(goal.blockers, ["check_failed"]),
  };
}

function blockGoalForToolFailure(input: {
  state: WorkflowStateV2;
  blocker: string;
  reason: string;
  now: string;
  clearPendingProposal?: boolean;
}): WorkflowStateV2 {
  return updateActiveGoal(
    {
      ...input.state,
      ...(input.clearPendingProposal
        ? { pendingProposalId: undefined, pendingProposalBaseVersion: undefined }
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

function extractViewRefsFromOutput(output: unknown): Partial<AuthoringGoalV2["targetRefs"]> {
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
  contextStatus?: ContextStatusV2,
): AuthoringGoalV2["contextRefs"] | undefined {
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
    ...(contextStatus.dataFormatSkillLoadedFor?.version
      ? { dataFormatSkillVersion: contextStatus.dataFormatSkillLoadedFor.version }
      : {}),
  };
}

function activateNextGoalAfterCompletion(
  state: WorkflowStateV2,
  completedGoal: AuthoringGoalV2,
): WorkflowStateV2 {
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

export function applyWorkflowTransitionV2(input: {
  state: WorkflowStateV2;
  action: WorkflowActionV2;
  toolExecution?: WorkflowToolExecutionV2;
  baseVersion?: number;
  now?: string;
  contextStatus?: ContextStatusV2;
}): WorkflowStateV2 {
  const now = input.now ?? nowIso();
  const state = normalizeWorkflowStateV2(input.state);
  const { action } = input;
  if (action.kind === "complete_goal") {
    const active = getActiveGoalV2(state);
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
    if (!proposalId) {
      return blockGoalForToolFailure({
        state,
        blocker: "compose_patch_invalid_output",
        reason: "composePatch succeeded without a valid patch proposal id.",
        now,
        clearPendingProposal: true,
      });
    }

    const active = getActiveGoalV2(state);
    const proposalGoal = active?.parentGoalId
      ? parentGoal(state, active) ?? active
      : active;
    const nextState: WorkflowStateV2 = {
      ...state,
      pendingProposalId: proposalId,
      pendingProposalBaseVersion:
        typeof input.baseVersion === "number" ? input.baseVersion : undefined,
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
      if (input.toolExecution?.reason !== "semantic_error") {
        return blockGoalForToolFailure({
          state,
          blocker: "run_check_failed",
          reason:
            input.toolExecution?.message ??
            "runCheck did not return a successful tool result.",
          now,
        });
      }
      const active = getActiveGoalV2(state);
      const message = toolFailureMessage(
        input.toolExecution,
        "Runtime check failed.",
      );
      const code = input.toolExecution.reason;
      const target = classifyRuntimeCheckRepairTarget([{ code, message }]);
      const attempts = (active?.repairState?.runCheckAttempts ?? 0) + 1;
      return updateActiveGoal(state, (goal) => ({
        ...goal,
        status: "active",
        repairState: {
          runCheckAttempts: attempts,
          target,
          lastFailure: {
            toolName: "runCheck",
            code,
            message,
            occurredAt: now,
          },
        },
        blockers: upsertBlocker(goal.blockers, "check_failed", message),
        updatedAt: now,
      }));
    }
    return updateActiveGoal(state, (goal) => ({
      ...goal,
      repairState: undefined,
      blockers: clearBlockers(goal.blockers, ["check_failed"]),
      updatedAt: now,
    }));
  }
  if (
    action.kind === "stage_query" ||
    action.kind === "stage_view" ||
    action.kind === "stage_binding" ||
    action.kind === "repair_artifact"
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
            : ["check_failed"];
    return updateActiveGoal(state, (goal) => {
      const repaired = action.kind === "repair_artifact"
        ? clearRepairStateAfterDraftMutation(goal)
        : goal;
      return {
        ...repaired,
        status: "active",
        blockers: clearBlockers(repaired.blockers, clearKinds),
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
