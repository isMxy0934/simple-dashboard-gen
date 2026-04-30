import type {
  Binding,
  DashboardDocument,
  DashboardView,
  QueryDef,
} from "@/contracts";
import { getLayoutItemsForView } from "@/domain/dashboard/document";
import { getViewSlots } from "@/domain/dashboard/contract-kernel";
import type { AuthoringWorkingDraftOwnership } from "@/ai/authoring/contracts/session";
import type {
  ArtifactStatus,
  AuthoringDataMode,
  AuthoringGoal,
  ContextStatus,
} from "@/ai/authoring/workflow/types";

export function inspectContextStatus(input: {
  datasourcesLoaded?: boolean;
  availableChartSkillIds?: string[];
  schemaLoadedFor?: ContextStatus["schemaLoadedFor"];
  chartSkillLoadedFor?: ContextStatus["chartSkillLoadedFor"];
}): ContextStatus {
  return {
    datasourcesLoaded: Boolean(input.datasourcesLoaded),
    availableChartSkillIds: [...(input.availableChartSkillIds ?? [])],
    ...(input.schemaLoadedFor ? { schemaLoadedFor: { ...input.schemaLoadedFor } } : {}),
    ...(input.chartSkillLoadedFor
      ? { chartSkillLoadedFor: { ...input.chartSkillLoadedFor } }
      : {}),
  };
}

function ownerIdsForKind(input: {
  goal: AuthoringGoal;
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

function goalQueryId(goal: AuthoringGoal, ownership?: AuthoringWorkingDraftOwnership | null) {
  return goal.targetRefs.queryId ?? ownerIdsForKind({ goal, ownership, kind: "query" })[0];
}

function goalViewId(goal: AuthoringGoal, ownership?: AuthoringWorkingDraftOwnership | null) {
  return goal.targetRefs.viewId ?? ownerIdsForKind({ goal, ownership, kind: "view" })[0];
}

function goalBindingIds(goal: AuthoringGoal, ownership?: AuthoringWorkingDraftOwnership | null) {
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

function bindingTargetsCurrentView(binding: Binding, view?: DashboardView): boolean {
  return Boolean(view?.id) && binding.view_id === view?.id;
}

function liveBindingTargetsCurrentQuery(input: {
  binding: Binding;
  queryId?: string;
}): boolean {
  return (
    bindingMode(input.binding) === "live" &&
    Boolean(input.queryId) &&
    input.binding.query_id === input.queryId
  );
}

function isStaleLiveBinding(input: {
  binding: Binding;
  queryId?: string;
}): boolean {
  return (
    bindingMode(input.binding) === "live" &&
    Boolean(input.queryId) &&
    Boolean(input.binding.query_id) &&
    input.binding.query_id !== input.queryId
  );
}

function observedDataMode(input: {
  expected: AuthoringDataMode;
  query?: QueryDef;
  bindings: Binding[];
}): ArtifactStatus["observedDataMode"] {
  const hasLive = Boolean(input.query) || input.bindings.some((binding) => bindingMode(binding) === "live");
  const hasMock = input.bindings.some((binding) => bindingMode(binding) === "mock");
  if (hasLive && hasMock) return "mixed";
  if (hasLive) return "live";
  if (hasMock) return "mock";
  return "none";
}

function dataModeConsistent(
  expected: AuthoringDataMode,
  observed: ArtifactStatus["observedDataMode"],
) {
  if (expected === "undecided" || observed === "none") {
    return true;
  }
  if (expected === "live") {
    return observed === "live";
  }
  return observed === "mock";
}

export function inspectArtifacts(input: {
  goal: AuthoringGoal | null;
  candidate: DashboardDocument;
  candidateFingerprint?: string | null;
  ownership?: AuthoringWorkingDraftOwnership | null;
  runtimeCheck?: ArtifactStatus["runtimeCheck"];
  pendingProposalId?: string | null;
  pendingProposalDraftFingerprint?: string | null;
}): ArtifactStatus {
  const patchStale = Boolean(
    input.pendingProposalId &&
      (!input.pendingProposalDraftFingerprint ||
        !input.candidateFingerprint ||
        input.pendingProposalDraftFingerprint !== input.candidateFingerprint),
  );
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
        stale: patchStale,
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
    : [];
  const requiredSlots = view ? getViewSlots(view).filter((slot) => slot.required !== false) : [];
  const missingSlots = requiredSlots
    .filter((slot) => {
      return !relevantBindings.some((binding) => {
        if (!bindingTargetsCurrentView(binding, view) || binding.slot_id !== slot.id) {
          return false;
        }
        if (goal.dataMode === "mock") {
          return bindingMode(binding) === "mock" && hasMockValue(binding);
        }
        if (goal.dataMode === "live") {
          return liveBindingTargetsCurrentQuery({ binding, queryId });
        }
        return false;
      });
    })
    .map((slot) => slot.id);
  const hasStaleQueryBinding =
    goal.dataMode === "live" &&
    relevantBindings.some((binding) => {
      return (
        bindingTargetsCurrentView(binding, view) &&
        requiredSlots.some((slot) => slot.id === binding.slot_id) &&
        isStaleLiveBinding({ binding, queryId })
      );
    });
  const bindingIssues = [
    ...(missingSlots.length ? ["missing_required_bindings"] : []),
    ...(hasStaleQueryBinding ? ["stale_query_binding"] : []),
  ];
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
      issues: bindingIssues,
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
      stale: patchStale,
      ...(input.pendingProposalId ? { proposalId: input.pendingProposalId } : {}),
    },
  };
}
