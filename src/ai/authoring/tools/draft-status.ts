import { Type } from "typebox";
import type {
  Binding,
  DashboardDocument,
  DashboardView,
} from "@/contracts";
import type {
  AuthoringDataMode,
  DraftStatusMissingBinding,
  DraftStatusToolOutput,
  GetDraftStatusToolInput,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringRunCheckStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import type { AuthoringGoal } from "@/ai/authoring/contracts/progress";
import { defineTool } from "@/ai/authoring/tools/definition";
import { isDraftComposable } from "@/ai/authoring/tools/compose-readiness";
import { getViewSlots } from "@/domain/dashboard/contract-kernel";
import { getLayoutItemsForView } from "@/domain/dashboard/document";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";
import { MAX_REPEAT_FAILURE_ATTEMPTS } from "@/ai/authoring/tools/reliability";

type DraftStatusInput = {
  dashboard: DashboardDocument;
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
  activeGoal?: AuthoringGoal | null;
  documentHash: string;
  lastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
};

function toSet(values: string[] | Set<string> | null | undefined): Set<string> {
  return new Set(Array.isArray(values) ? values : values ? [...values] : []);
}

function bindingMode(binding: Binding): "live" | "mock" {
  return binding.mode === "mock" ? "mock" : "live";
}

function hasLiveBindingForSlot(input: {
  bindings: Binding[];
  viewId: string;
  slotId: string;
}): boolean {
  return input.bindings.some(
    (binding) =>
      binding.view_id === input.viewId &&
      binding.slot_id === input.slotId &&
      bindingMode(binding) === "live" &&
      Boolean(binding.query_id),
  );
}

function mockBindingHasValue(binding: Binding): boolean {
  return "mock_value" in binding || "mock_data" in binding;
}

function hasMockBindingForSlot(input: {
  bindings: Binding[];
  viewId: string;
  slotId: string;
}): boolean {
  return input.bindings.some(
    (binding) =>
      binding.view_id === input.viewId &&
      binding.slot_id === input.slotId &&
      bindingMode(binding) === "mock" &&
      mockBindingHasValue(binding),
  );
}

function resolveDraftDataMode(input: {
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
  activeGoal?: AuthoringGoal | null;
  hasStagedViews: boolean;
}): AuthoringDataMode {
  if (input.draft?.bindingMode) {
    return input.draft.bindingMode;
  }
  if (
    (input.draft?.queryDefs?.length ?? 0) > 0 ||
    toSet(input.draft?.dirtyQueryIds).size > 0
  ) {
    return "live";
  }
  const stagedViewIds = toSet(input.draft?.dirtyViewIds);
  const relevantBindings = (input.draft?.bindings ?? input.candidate.bindings)
    .filter((binding) => stagedViewIds.size === 0 || stagedViewIds.has(binding.view_id));
  if (relevantBindings.some((binding) => bindingMode(binding) === "mock")) {
    return "mock";
  }
  return input.hasStagedViews ? "undecided" : (input.activeGoal?.dataMode ?? "undecided");
}

function stagedViews(input: {
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
}): DashboardView[] {
  const dirtyViewIds = toSet(input.draft?.dirtyViewIds);
  if (dirtyViewIds.size === 0) {
    return [];
  }
  return input.candidate.dashboard_spec.views.filter((view) => dirtyViewIds.has(view.id));
}

function missingRequiredBindings(input: {
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
  dataMode: AuthoringDataMode;
}): DraftStatusMissingBinding[] {
  const views = stagedViews(input);
  if (views.length === 0 || input.dataMode === "undecided") {
    return [];
  }
  const expectedMode: Exclude<AuthoringDataMode, "undecided"> = input.dataMode;
  return views.flatMap((view) =>
    getViewSlots(view)
      .filter((slot) => slot.required !== false)
      .filter(
        (slot) =>
          expectedMode === "live"
            ? !hasLiveBindingForSlot({
                bindings: input.candidate.bindings,
                viewId: view.id,
                slotId: slot.id,
              })
            : !hasMockBindingForSlot({
                bindings: input.candidate.bindings,
                viewId: view.id,
                slotId: slot.id,
              }),
      )
      .map((slot) => ({
        view_id: view.id,
        view_title: view.title,
        slot_id: slot.id,
        slot_path: slot.path,
        slot_value_kind: slot.value_kind,
        expected_mode: expectedMode,
        has_mock_binding: hasMockBindingForSlot({
          bindings: input.candidate.bindings,
          viewId: view.id,
          slotId: slot.id,
        }),
      })),
  );
}

function stagedLayoutCoverage(input: {
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
}): DraftStatusToolOutput["layout_coverage"] {
  const dirtyViewIds = toSet(input.draft?.dirtyViewIds);
  if (dirtyViewIds.size === 0) {
    return [];
  }

  return input.candidate.dashboard_spec.views
    .filter((view) => dirtyViewIds.has(view.id))
    .map((view) => {
      const layout = getLayoutItemsForView(input.candidate, view.id);
      return {
        view_id: view.id,
        view_title: view.title,
        desktop: Boolean(layout.desktop),
        mobile: Boolean(layout.mobile),
      };
    });
}

function buildSummary(input: {
  blockers: DraftStatusToolOutput["blockers"];
  dataMode: AuthoringDataMode;
  missingBindings: DraftStatusMissingBinding[];
  unplacedViewIds: string[];
  canCompose: boolean;
}) {
  if (input.blockers.includes("unresolved_tool_failure")) {
    return "Draft status: unresolved tool failure; see unresolved_failure.";
  }
  if (input.blockers.includes("data_mode_undecided")) {
    return "Draft status: data mode undecided.";
  }
  if (input.unplacedViewIds.length > 0) {
    return `Draft status: ${input.unplacedViewIds.length} staged view(s) are missing desktop or mobile layout.`;
  }
  if (input.missingBindings.length > 0) {
    return `Draft status: ${input.missingBindings.length} required ${input.dataMode} binding(s) missing.`;
  }
  if (input.blockers.includes("stale_check")) {
    return "Draft status: complete; runtime check is missing or stale.";
  }
  if (input.canCompose) {
    return "Draft status: complete; required draft facts are present.";
  }
  if (
    input.blockers.length === 1 &&
    input.blockers[0] === "staging_not_started"
  ) {
    return "Draft status: no chart or delete transaction has staged changes in this session yet. The saved dashboard may already list views.";
  }
  if (
    input.blockers.length === 1 &&
    input.blockers[0] === "no_draft"
  ) {
    return "Draft status: no staged draft.";
  }
  return `Draft status: incomplete; see blockers.`;
}

export function buildDraftStatus(input: DraftStatusInput): DraftStatusToolOutput {
  const draft = input.draft;
  const dirtyViewIds = [...toSet(draft?.dirtyViewIds)];
  const dirtyQueryIds = [...toSet(draft?.dirtyQueryIds)];
  const dirtyBindingIds = [...toSet(draft?.dirtyBindingIds)];
  const dirtyBindingIdSet = toSet(draft?.dirtyBindingIds);
  const stagedViewList = stagedViews({ candidate: input.candidate, draft });
  const dataMode = resolveDraftDataMode({
    candidate: input.candidate,
    draft,
    activeGoal: input.activeGoal,
    hasStagedViews: stagedViewList.length > 0,
  });
  const hasDraft = Boolean(draft);
  const hasQuery = input.candidate.query_defs.length > 0;
  const hasView = input.candidate.dashboard_spec.views.length > 0;
  const requiresDataModeDecision =
    dataMode === "undecided" &&
    (stagedViewList.length > 0 || input.activeGoal?.dataMode === "undecided");
  const needsView =
    hasDraft &&
    dataMode !== "undecided" &&
    (dataMode === "mock" || hasQuery) &&
    stagedViewList.length === 0 &&
    dirtyBindingIdSet.size === 0;
  const liveBindingCount = input.candidate.bindings.filter(
    (binding) => bindingMode(binding) === "live",
  ).length;
  const mockBindingCount = input.candidate.bindings.filter(
    (binding) => bindingMode(binding) === "mock",
  ).length;
  const missingBindings = missingRequiredBindings({
    candidate: input.candidate,
    draft,
    dataMode,
  });
  const layoutCoverage = stagedLayoutCoverage({
    candidate: input.candidate,
    draft,
  });
  const unplacedViewIds = layoutCoverage
    .filter((coverage) => !coverage.desktop || !coverage.mobile)
    .map((coverage) => coverage.view_id);
  const lastCheckHash = input.lastRunCheckState?.fingerprint ?? null;
  // checkRan only tracks whether this exact document hash has been checked.
  const checkRan = Boolean(lastCheckHash && lastCheckHash === input.documentHash);
  // checkFresh requires a successful check and is the compose gate.
  const checkFresh = checkRan && (input.lastRunCheckState?.signatures.length ?? 0) === 0;
  // checkExhausted unlocks authoring tools after repeated identical failures.
  const checkExhausted =
    checkRan &&
    (input.lastRunCheckState?.consecutiveRepeatCount ?? 0) >= MAX_REPEAT_FAILURE_ATTEMPTS;
  const canCompose =
    dataMode !== "undecided" &&
    (dataMode === "mock" || hasQuery) &&
    isDraftComposable({ dashboard: input.dashboard, draft }) &&
    missingBindings.length === 0 &&
    unplacedViewIds.length === 0 &&
    checkFresh;
  const blockers: DraftStatusToolOutput["blockers"] = [];
  if (!hasDraft && !requiresDataModeDecision) {
    if (hasView || hasQuery) {
      blockers.push("staging_not_started");
    } else {
      blockers.push("no_draft");
    }
  }
  if (requiresDataModeDecision) {
    blockers.push("data_mode_undecided");
  }
  if (hasDraft && dataMode === "live" && !hasQuery) {
    blockers.push("missing_query");
  }
  if (needsView) {
    blockers.push("missing_view");
  }
  if (unplacedViewIds.length > 0) {
    blockers.push("missing_layout");
  }
  if (missingBindings.length > 0) {
    blockers.push("missing_required_bindings");
  }
  const stagingComplete =
    hasDraft &&
    dataMode !== "undecided" &&
    (dataMode === "mock" || hasQuery) &&
    !needsView &&
    missingBindings.length === 0 &&
    unplacedViewIds.length === 0;
  if (stagingComplete && !checkFresh && !checkExhausted) {
    blockers.push("stale_check");
  }
  return {
    summary: buildSummary({
      blockers,
      dataMode,
      missingBindings,
      unplacedViewIds,
      canCompose,
    }),
    document_hash: input.documentHash,
    data_mode: dataMode,
    has_draft: hasDraft,
    has_query: hasQuery,
    has_view: hasView,
    dirty_view_ids: dirtyViewIds,
    dirty_query_ids: dirtyQueryIds,
    dirty_binding_ids: dirtyBindingIds,
    layout_coverage: layoutCoverage,
    unplaced_view_ids: unplacedViewIds,
    last_check_hash: lastCheckHash,
    check_fresh: checkFresh,
    live_binding_count: liveBindingCount,
    mock_binding_count: mockBindingCount,
    missing_required_bindings: missingBindings,
    can_compose: canCompose,
    blockers,
    unresolved_failure: null,
  };
}

export function buildGetDraftStatusTool(input: {
  dashboard: DashboardDocument;
  workingDraft: WorkingDraftState;
  getDraftSnapshot: () => AuthoringWorkingDraftSnapshot | null;
  getLastRunCheckState?: () => AuthoringRunCheckStateSnapshot | null;
  getActiveGoal?: () => AuthoringGoal | null;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return defineTool({
    name: "getDraftStatus",
    label: "Get Draft Status",
    description:
      "Inspect current working draft facts and missing pieces. This is read-only and does not decide the next agent action.",
    parameters: Type.Object({ reason: Type.Optional(Type.String()) }, { additionalProperties: false }),
    execute: async (_toolInput: GetDraftStatusToolInput): Promise<DraftStatusToolOutput> =>
      {
        const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
        return buildDraftStatus({
          dashboard: input.dashboard,
          candidate,
          draft: input.getDraftSnapshot(),
          activeGoal: input.getActiveGoal?.() ?? null,
          documentHash: input.buildDocumentFingerprint(candidate),
          lastRunCheckState: input.getLastRunCheckState?.() ?? null,
        });
      },
  });
}
