import { tool } from "ai";
import { z } from "zod";
import type {
  Binding,
  DashboardDocument,
  DashboardView,
} from "@/contracts";
import type {
  DraftStatusMissingBinding,
  DraftStatusToolOutput,
  GetDraftStatusToolInput,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringTaskStateSnapshot,
  AuthoringRunCheckStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session-state";
import { isDraftComposable } from "@/ai/authoring/draft-completion";
import { getViewSlots } from "@/domain/dashboard/contract-kernel";
import { getLayoutItemsForView } from "@/domain/dashboard/document";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";

type DraftStatusInput = {
  dashboard: DashboardDocument;
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
  taskState?: AuthoringTaskStateSnapshot | null;
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

function hasMockBindingForSlot(input: {
  bindings: Binding[];
  viewId: string;
  slotId: string;
}): boolean {
  return input.bindings.some(
    (binding) =>
      binding.view_id === input.viewId &&
      binding.slot_id === input.slotId &&
      bindingMode(binding) === "mock",
  );
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
}): DraftStatusMissingBinding[] {
  const views = stagedViews(input);
  if (views.length === 0) {
    return [];
  }
  return views.flatMap((view) =>
    getViewSlots(view)
      .filter((slot) => slot.required !== false)
      .filter(
        (slot) =>
          !hasLiveBindingForSlot({
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
  missingBindings: DraftStatusMissingBinding[];
  unplacedViewIds: string[];
  canCompose: boolean;
}) {
  if (input.blockers.includes("unresolved_tool_failure")) {
    return "Draft status: unresolved tool failure; see unresolved_failure.";
  }
  if (input.unplacedViewIds.length > 0) {
    return `Draft status: ${input.unplacedViewIds.length} staged view(s) are missing desktop or mobile layout.`;
  }
  if (input.missingBindings.length > 0) {
    return `Draft status: ${input.missingBindings.length} required live binding(s) missing.`;
  }
  if (input.blockers.includes("stale_check")) {
    return "Draft status: complete, but a fresh runtime check is required before composing.";
  }
  if (input.canCompose) {
    return "Draft status: complete and ready to compose.";
  }
  if (
    input.blockers.length === 1 &&
    input.blockers[0] === "staging_not_started"
  ) {
    return "Draft status: no write tools have staged changes in this session yet. The saved dashboard may already list views; call upsertQuery, upsertView, and upsertBinding to add or edit a chart.";
  }
  return `Draft status: incomplete; see blockers.`;
}

function resolveNextRequiredAction(input: {
  hasDraft: boolean;
  hasQuery: boolean;
  needsView: boolean;
  missingBindings: DraftStatusMissingBinding[];
  unplacedViewIds: string[];
  unresolvedFailure: AuthoringTaskStateSnapshot["lastFailedTool"] | null;
  checkFresh: boolean;
  canCompose: boolean;
}): DraftStatusToolOutput["next_required_action"] {
  if (input.unresolvedFailure) {
    return "fix_failure";
  }
  if (!input.hasDraft) {
    return "stage_view";
  }
  if (!input.hasQuery) {
    return "stage_query";
  }
  if (input.needsView) {
    return "stage_view";
  }
  if (input.unplacedViewIds.length > 0) {
    return "fix_layout";
  }
  if (input.missingBindings.length > 0) {
    return "stage_binding";
  }
  if (!input.checkFresh) {
    return "run_check";
  }
  if (input.canCompose) {
    return "compose_patch";
  }
  return "none";
}

export function buildDraftStatus(input: DraftStatusInput): DraftStatusToolOutput {
  const draft = input.draft;
  const dirtyViewIds = [...toSet(draft?.dirtyViewIds)];
  const dirtyQueryIds = [...toSet(draft?.dirtyQueryIds)];
  const dirtyBindingIds = [...toSet(draft?.dirtyBindingIds)];
  const dirtyBindingIdSet = toSet(draft?.dirtyBindingIds);
  const stagedViewList = stagedViews({ candidate: input.candidate, draft });
  const hasDraft = Boolean(draft);
  const hasQuery = input.candidate.query_defs.length > 0;
  const hasView = input.candidate.dashboard_spec.views.length > 0;
  const needsView =
    hasDraft &&
    hasQuery &&
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
  });
  const layoutCoverage = stagedLayoutCoverage({
    candidate: input.candidate,
    draft,
  });
  const unplacedViewIds = layoutCoverage
    .filter((coverage) => !coverage.desktop || !coverage.mobile)
    .map((coverage) => coverage.view_id);
  const unresolvedFailure = input.taskState?.lastFailedTool ?? null;
  const lastCheckHash = input.lastRunCheckState?.fingerprint ?? null;
  const checkFresh = Boolean(
    lastCheckHash &&
      lastCheckHash === input.documentHash &&
      (input.lastRunCheckState?.signatures.length ?? 0) === 0,
  );
  const canCompose =
    isDraftComposable({ dashboard: input.dashboard, draft }) &&
    missingBindings.length === 0 &&
    unplacedViewIds.length === 0 &&
    checkFresh &&
    !unresolvedFailure;
  const blockers: DraftStatusToolOutput["blockers"] = [];
  if (!hasDraft) {
    if (hasView || hasQuery) {
      blockers.push("staging_not_started");
    } else {
      blockers.push("no_draft");
    }
  }
  if (hasDraft && !hasQuery) {
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
    hasQuery &&
    !needsView &&
    missingBindings.length === 0 &&
    unplacedViewIds.length === 0;
  if (stagingComplete && !checkFresh) {
    blockers.push("stale_check");
  }
  if (unresolvedFailure) {
    blockers.push("unresolved_tool_failure");
  }
  const nextRequiredAction = resolveNextRequiredAction({
    hasDraft,
    hasQuery,
    needsView,
    missingBindings,
    unplacedViewIds,
    unresolvedFailure,
    checkFresh,
    canCompose,
  });
  return {
    summary: buildSummary({
      blockers,
      missingBindings,
      unplacedViewIds,
      canCompose,
    }),
    document_hash: input.documentHash,
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
    next_required_action: nextRequiredAction,
    live_binding_count: liveBindingCount,
    mock_binding_count: mockBindingCount,
    missing_required_bindings: missingBindings,
    can_compose: canCompose,
    blockers,
    unresolved_failure: unresolvedFailure
      ? {
          tool_name: unresolvedFailure.toolName,
          error_summary: unresolvedFailure.userSafeSummary ?? unresolvedFailure.errorSummary,
          recovery_hint: unresolvedFailure.recoveryHint,
        }
      : null,
  };
}

export function buildGetDraftStatusTool(input: {
  dashboard: DashboardDocument;
  workingDraft: WorkingDraftState;
  getDraftSnapshot: () => AuthoringWorkingDraftSnapshot | null;
  getLastRunCheckState?: () => AuthoringRunCheckStateSnapshot | null;
  getTaskState?: () => AuthoringTaskStateSnapshot | null;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return tool({
    description:
      "Inspect the current working draft lifecycle status and missing pieces. This is read-only. Use it after staging query/view/binding when you need to know what is still missing before composing.",
    inputSchema: z.object({ reason: z.string().optional() }).strict(),
    execute: async (_toolInput: GetDraftStatusToolInput): Promise<DraftStatusToolOutput> =>
      {
        const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
        return buildDraftStatus({
          dashboard: input.dashboard,
          candidate,
          draft: input.getDraftSnapshot(),
          taskState: input.getTaskState?.() ?? null,
          documentHash: input.buildDocumentFingerprint(candidate),
          lastRunCheckState: input.getLastRunCheckState?.() ?? null,
        });
      },
  });
}
