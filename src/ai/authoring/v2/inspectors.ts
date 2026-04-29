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
  ArtifactStatusV2,
  AuthoringDataModeV2,
  AuthoringGoalV2,
  ContextStatusV2,
  WorkflowActionV2,
} from "@/ai/authoring/v2/types";

function nowIso() {
  return new Date().toISOString();
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

function dataModeConsistent(
  expected: AuthoringDataModeV2,
  observed: ArtifactStatusV2["observedDataMode"],
) {
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
      patch: {
        composed: Boolean(input.pendingProposalId),
        stale: false,
        ...(input.pendingProposalId ? { proposalId: input.pendingProposalId } : {}),
      },
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
      missingRequiredSlots: requiredSlots
        .map((slot) => slot.id)
        .filter((slotId) => !view?.renderer.slots.some((slot) => slot.id === slotId)),
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
  }

  if (input.action.kind === "stage_view" && isViewOutput(input.toolResult)) {
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
  }

  if (input.action.kind === "stage_binding" && isBindingOutput(input.toolResult)) {
    for (const bindingDetail of input.toolResult.bindings) {
      const binding = "binding" in bindingDetail ? bindingDetail.binding : bindingDetail;
      draft.dirtyBindingIds.add(binding.id);
      markWorkingDraftArtifactOwner({
        workingDraft: draft,
        goalId: input.goalId,
        artifactKind: "binding",
        artifactId: binding.id,
        timestamp: now,
      });
    }
  }

  if (input.action.kind === "stage_layout" && isLayoutOutput(input.toolResult)) {
    draft.layoutTouched = true;
    markWorkingDraftArtifactOwner({
      workingDraft: draft,
      goalId: input.goalId,
      artifactKind: "layout",
      artifactId: input.toolResult.view_id,
      timestamp: now,
    });
  }

  return draft;
}
