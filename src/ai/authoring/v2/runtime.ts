import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardView,
  QueryDef,
} from "@/contracts";
import { getLayoutItemsForView } from "@/domain/dashboard/document";
import { getViewSlots } from "@/domain/dashboard/contract-kernel";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneQuery,
  cloneWorkingDraftOwnership,
  markWorkingDraftArtifactOwner,
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import type { AuthoringWorkingDraftOwnership } from "@/ai/authoring/contracts/session-state";
import type {
  ApprovalStateV2,
  ArtifactStatusV2,
  AuthoringDataModeV2,
  AuthoringGoalV2,
  ContextStatusV2,
  TurnIntentV2,
  ViewGoalV2,
  WorkflowActionV2,
  WorkflowStateV2,
  ForcedToolStepV2,
} from "@/ai/authoring/v2/types";

function nowIso() {
  return new Date().toISOString();
}

function slugPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferChartTypeFromText(text: string): ViewGoalV2["chartType"] | undefined {
  if (/(折线|趋势|时间序列|time\s*series|timeseries|trend|line)/i.test(text)) {
    return "line";
  }
  if (/(柱状|条形|排行|排名|top\s*n|bar|ranking|rank)/i.test(text)) {
    return "bar";
  }
  if (/(指标|卡片|kpi|metric\s*card|scorecard)/i.test(text)) {
    return "kpi";
  }
  if (/(面积|area)/i.test(text)) {
    return "area";
  }
  if (/(饼图|pie)/i.test(text)) {
    return "pie";
  }
  if (/(表格|明细|列表|table|detail)/i.test(text)) {
    return "table";
  }
  return undefined;
}

export function resolveDataModeV2(input: {
  intent: TurnIntentV2;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
}): AuthoringDataModeV2 {
  if (input.intent.kind !== "create_view") {
    return "undecided";
  }
  if (input.intent.goal.dataMode) {
    return input.intent.goal.dataMode;
  }
  if (input.intent.goal.datasourceId || input.intent.goal.table) {
    return "live";
  }
  if (input.selectedDatasourceId || input.selectedTable) {
    return "live";
  }
  return "undecided";
}

export function resolveIntentV2(input: {
  latestUserText?: string | null;
  approvalEvent?: Extract<TurnIntentV2, { kind: "approve_patch_event" }> | null;
}): TurnIntentV2 {
  if (input.approvalEvent) {
    return input.approvalEvent;
  }
  const text = input.latestUserText?.trim() ?? "";
  const normalized = text.toLowerCase();
  if (!text) {
    return { kind: "chat" };
  }
  if (/(schema|表结构|字段|有哪些表|有哪些数据|数据源|datasource|tables?)/i.test(normalized)) {
    return { kind: "explore_data", scope: "datasources" };
  }
  if (/(创建|新增|添加|生成|做一个|搭建|create|add|build|generate).*(图|图表|报表|chart|view|dashboard)/i.test(normalized)) {
    const chartType = inferChartTypeFromText(text);
    const dataMode = /(mock|占位|示例|样例|模拟|placeholder|sample)/i.test(normalized)
      ? "mock"
      : /(真实|实际|数据源|字段|数据表|query|sql|datasource|table|live)/i.test(normalized)
        ? "live"
      : undefined;
    return {
      kind: "create_view",
      goal: {
        summary: text,
        ...(chartType ? { chartType } : {}),
        ...(dataMode ? { dataMode } : {}),
      },
    };
  }
  if (/(确认|可以|同意|approve|approved|ok|okay|go ahead)/i.test(normalized)) {
    return { kind: "approve_patch_text", decision: "approve" };
  }
  if (/(拒绝|取消|reject|cancel)/i.test(normalized)) {
    return { kind: "approve_patch_text", decision: "reject" };
  }
  return { kind: "chat" };
}

export function createGoalFromIntentV2(input: {
  intent: TurnIntentV2;
  turnId: string;
  now?: string;
  selectedDatasourceId?: string | null;
  selectedTable?: string | null;
}): AuthoringGoalV2 | null {
  if (input.intent.kind !== "create_view") {
    return null;
  }
  const now = input.now ?? nowIso();
  const goal = input.intent.goal;
  const summary = goal.summary?.trim() || "Create dashboard view";
  const dataMode = resolveDataModeV2({
    intent: input.intent,
    selectedDatasourceId: input.selectedDatasourceId,
    selectedTable: input.selectedTable,
  });
  return {
    id: `goal_${slugPart(input.turnId || summary) || Date.now()}`,
    kind: "create_view",
    status: "active",
    summary,
    dataMode,
    chartPlan: {
      ...(goal.chartType ? { chartType: goal.chartType } : {}),
      ...(goal.metrics ? { metrics: [...goal.metrics] } : {}),
      ...(goal.dimensions ? { dimensions: [...goal.dimensions] } : {}),
      ...(goal.timeGrain ? { timeGrain: goal.timeGrain } : {}),
    },
    targetRefs: {
      ...(goal.datasourceId || input.selectedDatasourceId
        ? { datasourceId: goal.datasourceId ?? input.selectedDatasourceId ?? undefined }
        : {}),
      ...(goal.table || input.selectedTable
        ? { table: goal.table ?? input.selectedTable ?? undefined }
        : {}),
    },
    blockers: [],
    createdFromTurnId: input.turnId,
    createdAt: now,
    updatedAt: now,
  };
}

export function inspectContextStatusV2(input: {
  datasourcesLoaded?: boolean;
  schemaLoadedFor?: ContextStatusV2["schemaLoadedFor"];
  chartSkillLoadedFor?: ContextStatusV2["chartSkillLoadedFor"];
  dataFormatSkillLoadedFor?: ContextStatusV2["dataFormatSkillLoadedFor"];
}): ContextStatusV2 {
  return {
    datasourcesLoaded: Boolean(input.datasourcesLoaded),
    ...(input.schemaLoadedFor ? { schemaLoadedFor: { ...input.schemaLoadedFor } } : {}),
    ...(input.chartSkillLoadedFor
      ? { chartSkillLoadedFor: { ...input.chartSkillLoadedFor } }
      : {}),
    ...(input.dataFormatSkillLoadedFor
      ? { dataFormatSkillLoadedFor: { ...input.dataFormatSkillLoadedFor } }
      : {}),
  };
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

function hasGoalDataFormatContext(_goal: AuthoringGoalV2, contextStatus: ContextStatusV2): boolean {
  return Boolean(contextStatus.dataFormatSkillLoadedFor?.referenceKey);
}

function ownerIdsForKind(input: {
  goal: AuthoringGoalV2;
  ownership?: AuthoringWorkingDraftOwnership | null;
  kind: "query" | "view" | "binding" | "layout";
}): string[] {
  const current = input.ownership?.currentByGoal[input.goal.id];
  if (current) {
    if (input.kind === "query" && current.queryId) return [current.queryId];
    if (input.kind === "view" && current.viewId) return [current.viewId];
    if (input.kind === "binding" && current.bindingIds?.length) return current.bindingIds;
    if (input.kind === "layout" && current.layoutId) return [current.layoutId];
  }

  const ids = input.ownership?.byGoalId[input.goal.id] ?? [];
  return ids
    .map((id) => input.ownership?.byArtifactId[id])
    .filter((owner): owner is NonNullable<typeof owner> => owner?.artifactKind === input.kind)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((owner) => owner.artifactId);
}

function goalQueryId(goal: AuthoringGoalV2, ownership?: AuthoringWorkingDraftOwnership | null) {
  return goal.targetRefs.queryId ?? ownerIdsForKind({ goal, ownership, kind: "query" })[0];
}

function goalViewId(goal: AuthoringGoalV2, ownership?: AuthoringWorkingDraftOwnership | null) {
  return goal.targetRefs.viewId ?? ownerIdsForKind({ goal, ownership, kind: "view" })[0];
}

function goalBindingIds(goal: AuthoringGoalV2, ownership?: AuthoringWorkingDraftOwnership | null) {
  return goal.targetRefs.bindingIds?.length
    ? goal.targetRefs.bindingIds
    : ownerIdsForKind({ goal, ownership, kind: "binding" });
}

function bindingMode(binding: Binding): "live" | "mock" {
  return binding.mode === "mock" ? "mock" : "live";
}

function hasMockValue(binding: Binding): boolean {
  return "mock_value" in binding || "mock_data" in binding;
}

function observedDataMode(input: {
  expected: AuthoringDataModeV2;
  query?: QueryDef;
  bindings: Binding[];
}): ArtifactStatusV2["observedDataMode"] {
  const hasLive = Boolean(input.query) || input.bindings.some((binding) => bindingMode(binding) === "live");
  const hasMock = input.bindings.some((binding) => bindingMode(binding) === "mock");
  if (hasLive && hasMock) return "mixed";
  if (hasLive) return "live";
  if (hasMock) return "mock";
  return "none";
}

function dataModeConsistent(expected: AuthoringDataModeV2, observed: ArtifactStatusV2["observedDataMode"]) {
  if (expected === "undecided" || observed === "none") {
    return true;
  }
  if (expected === "live") {
    return observed === "live";
  }
  return observed === "mock";
}

export function inspectArtifactsV2(input: {
  goal: AuthoringGoalV2 | null;
  candidate: DashboardDocument;
  ownership?: AuthoringWorkingDraftOwnership | null;
  runtimeCheck?: ArtifactStatusV2["runtimeCheck"];
  pendingProposalId?: string | null;
}): ArtifactStatusV2 {
  const emptyRuntimeCheck = input.runtimeCheck ?? {
    required: false,
    status: "not_applicable" as const,
    errors: [],
  };
  if (!input.goal) {
    return {
      expectedDataMode: "undecided",
      observedDataMode: "none",
      dataModeConsistent: true,
      query: { required: false, exists: false, valid: false, issues: [] },
      view: { required: false, exists: false, valid: false, missingRequiredSlots: [], issues: [] },
      binding: { required: false, exists: false, valid: false, missingSlots: [], issues: [] },
      layout: { required: false, existsDesktop: false, existsMobile: false, valid: false, issues: [] },
      runtimeCheck: emptyRuntimeCheck,
      patch: { composed: Boolean(input.pendingProposalId), stale: false, ...(input.pendingProposalId ? { proposalId: input.pendingProposalId } : {}) },
    };
  }

  const goal = input.goal;
  const queryId = goalQueryId(goal, input.ownership);
  const viewId = goalViewId(goal, input.ownership);
  const bindingIds = goalBindingIds(goal, input.ownership);
  const query = queryId
    ? input.candidate.query_defs.find((candidate) => candidate.id === queryId)
    : undefined;
  const view = viewId
    ? input.candidate.dashboard_spec.views.find((candidate) => candidate.id === viewId)
    : undefined;
  const relevantBindings = bindingIds.length
    ? input.candidate.bindings.filter((binding) => bindingIds.includes(binding.id))
    : viewId
      ? input.candidate.bindings.filter((binding) => binding.view_id === viewId)
      : [];
  const requiredSlots = view ? getViewSlots(view).filter((slot) => slot.required !== false) : [];
  const missingSlots = requiredSlots
    .filter((slot) => {
      return !relevantBindings.some((binding) => {
        if (binding.view_id !== view?.id || binding.slot_id !== slot.id) {
          return false;
        }
        if (goal.dataMode === "mock") {
          return bindingMode(binding) === "mock" && hasMockValue(binding);
        }
        if (goal.dataMode === "live") {
          return bindingMode(binding) === "live" && Boolean(binding.query_id);
        }
        return false;
      });
    })
    .map((slot) => slot.id);
  const layout = viewId ? getLayoutItemsForView(input.candidate, viewId) : {};
  const observed = observedDataMode({
    expected: goal.dataMode,
    query,
    bindings: relevantBindings,
  });
  const stagingComplete =
    Boolean(view) &&
    (goal.dataMode !== "live" || Boolean(query)) &&
    missingSlots.length === 0 &&
    Boolean(layout.desktop) &&
    Boolean(layout.mobile);
  return {
    expectedDataMode: goal.dataMode,
    observedDataMode: observed,
    dataModeConsistent: dataModeConsistent(goal.dataMode, observed),
    query: {
      required: goal.dataMode === "live",
      exists: Boolean(query),
      valid: goal.dataMode !== "live" || Boolean(query),
      issues: goal.dataMode === "live" && !query ? ["missing_query"] : [],
    },
    view: {
      required: true,
      exists: Boolean(view),
      valid: Boolean(view),
      missingRequiredSlots: requiredSlots.map((slot) => slot.id).filter((slotId) => !view?.renderer.slots.some((slot) => slot.id === slotId)),
      issues: view ? [] : ["missing_view"],
    },
    binding: {
      required: Boolean(view),
      exists: relevantBindings.length > 0,
      valid: missingSlots.length === 0,
      missingSlots,
      issues: missingSlots.length ? ["missing_required_bindings"] : [],
    },
    layout: {
      required: Boolean(view),
      existsDesktop: Boolean(layout.desktop),
      existsMobile: Boolean(layout.mobile),
      valid: Boolean(layout.desktop && layout.mobile),
      issues: layout.desktop && layout.mobile ? [] : ["missing_layout"],
    },
    runtimeCheck: input.runtimeCheck ?? {
      required: stagingComplete,
      status: stagingComplete ? "not_run" : "not_applicable",
      errors: [],
    },
    patch: {
      composed: Boolean(input.pendingProposalId),
      stale: false,
      ...(input.pendingProposalId ? { proposalId: input.pendingProposalId } : {}),
    },
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

function extractProposalId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  if (
    "proposalId" in value &&
    typeof (value as { proposalId?: unknown }).proposalId === "string"
  ) {
    return (value as { proposalId: string }).proposalId;
  }
  if (
    "suggestion" in value &&
    typeof (value as { suggestion?: { id?: unknown } }).suggestion?.id === "string"
  ) {
    return (value as { suggestion: { id: string } }).suggestion.id;
  }
  return undefined;
}

export function applyWorkflowTransitionV2(input: {
  state: WorkflowStateV2;
  action: WorkflowActionV2;
  toolResult?: unknown;
  baseVersion?: number;
  now?: string;
}): WorkflowStateV2 {
  const now = input.now ?? nowIso();
  const { state, action } = input;
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
    const proposalId = extractProposalId(input.toolResult);
    return {
      ...state,
      ...(proposalId ? { pendingProposalId: proposalId } : {}),
      ...(proposalId && typeof input.baseVersion === "number"
        ? { pendingProposalBaseVersion: input.baseVersion }
        : {}),
      activeGoal: state.activeGoal
        ? { ...state.activeGoal, status: "awaiting_approval", updatedAt: now }
        : null,
    };
  }
  if (action.kind === "run_check") {
    const checkResultId =
      typeof input.toolResult === "object" &&
      input.toolResult !== null &&
      "checkResultId" in input.toolResult &&
      typeof (input.toolResult as { checkResultId?: unknown }).checkResultId === "string"
        ? (input.toolResult as { checkResultId: string }).checkResultId
        : undefined;
    return checkResultId ? { ...state, lastCheckResultId: checkResultId } : state;
  }
  if (action.kind === "apply_patch") {
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

function cloneWorkingDraftState(draft: WorkingDraftState): WorkingDraftState {
  return {
    ...(draft.dashboardSpec ? { dashboardSpec: cloneDashboardSpec(draft.dashboardSpec) } : {}),
    ...(draft.queryDefs ? { queryDefs: draft.queryDefs.map(cloneQuery) } : {}),
    ...(draft.bindings ? { bindings: draft.bindings.map(cloneBinding) } : {}),
    ...(draft.bindingMode ? { bindingMode: draft.bindingMode } : {}),
    dirtyViewIds: new Set(draft.dirtyViewIds),
    dirtyQueryIds: new Set(draft.dirtyQueryIds),
    dirtyBindingIds: new Set(draft.dirtyBindingIds),
    layoutTouched: draft.layoutTouched,
    ownership: cloneWorkingDraftOwnership(draft.ownership),
    stagedAt: draft.stagedAt,
  };
}

function isQueryOutput(value: unknown): value is { query: { query: QueryDef } | QueryDef } {
  return typeof value === "object" && value !== null && "query" in value;
}

function isViewOutput(value: unknown): value is { view: { view: DashboardView } | DashboardView } {
  return typeof value === "object" && value !== null && "view" in value;
}

function isBindingOutput(value: unknown): value is { bindings: Array<{ binding: Binding } | Binding> } {
  return typeof value === "object" && value !== null && "bindings" in value && Array.isArray((value as { bindings?: unknown }).bindings);
}

function isLayoutOutput(value: unknown): value is { view_id: string; layout: { desktop: DashboardLayoutItem; mobile: DashboardLayoutItem } } {
  return typeof value === "object" && value !== null && "view_id" in value && "layout" in value;
}

export function applyDraftMutationV2(input: {
  workingDraft: WorkingDraftState;
  action: WorkflowActionV2;
  toolResult?: unknown;
  goalId?: string | null;
  now?: string;
}): WorkingDraftState {
  const draft = cloneWorkingDraftState(input.workingDraft);
  const now = input.now ?? nowIso();

  if (input.action.kind === "stage_query" && isQueryOutput(input.toolResult)) {
    const queryDetail = input.toolResult.query;
    const query = "query" in queryDetail ? queryDetail.query : queryDetail;
    draft.dirtyQueryIds.add(query.id);
    markWorkingDraftArtifactOwner({
      workingDraft: draft,
      goalId: input.goalId,
      artifactKind: "query",
      artifactId: query.id,
      timestamp: now,
    });
  } else if (input.action.kind === "stage_view" && isViewOutput(input.toolResult)) {
    const viewDetail = input.toolResult.view;
    const view = "view" in viewDetail ? viewDetail.view : viewDetail;
    draft.dirtyViewIds.add(view.id);
    markWorkingDraftArtifactOwner({
      workingDraft: draft,
      goalId: input.goalId,
      artifactKind: "view",
      artifactId: view.id,
      timestamp: now,
    });
  } else if (input.action.kind === "stage_binding" && isBindingOutput(input.toolResult)) {
    for (const detail of input.toolResult.bindings) {
      const binding = "binding" in detail ? detail.binding : detail;
      draft.dirtyBindingIds.add(binding.id);
      markWorkingDraftArtifactOwner({
        workingDraft: draft,
        goalId: input.goalId,
        artifactKind: "binding",
        artifactId: binding.id,
        timestamp: now,
      });
    }
  } else if (input.action.kind === "stage_layout" && isLayoutOutput(input.toolResult)) {
    draft.dirtyViewIds.add(input.toolResult.view_id);
    draft.layoutTouched = true;
    markWorkingDraftArtifactOwner({
      workingDraft: draft,
      goalId: input.goalId,
      artifactKind: "layout",
      artifactId: input.toolResult.view_id,
      timestamp: now,
    });
  } else if (input.action.kind === "apply_patch") {
    draft.dashboardSpec = undefined;
    draft.queryDefs = undefined;
    draft.bindings = undefined;
    draft.bindingMode = undefined;
    draft.dirtyViewIds.clear();
    draft.dirtyQueryIds.clear();
    draft.dirtyBindingIds.clear();
    draft.layoutTouched = false;
    draft.ownership = { byArtifactId: {}, byGoalId: {}, currentByGoal: {} };
  }

  draft.stagedAt = now;
  return draft;
}
