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
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session-state";
import { isDraftComposable } from "@/ai/authoring/draft-completion";
import { getViewSlots } from "@/domain/dashboard/contract-kernel";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";

type DraftStatusInput = {
  dashboard: DashboardDocument;
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
  taskState?: AuthoringTaskStateSnapshot | null;
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

function buildSummary(input: {
  blockers: DraftStatusToolOutput["blockers"];
  missingBindings: DraftStatusMissingBinding[];
  canCompose: boolean;
}) {
  if (input.blockers.includes("unresolved_tool_failure")) {
    return "Draft status: unresolved tool failure; see unresolved_failure.";
  }
  if (input.missingBindings.length > 0) {
    return `Draft status: ${input.missingBindings.length} required live binding(s) missing.`;
  }
  if (input.canCompose) {
    return "Draft status: complete and ready to compose.";
  }
  return `Draft status: incomplete; see blockers.`;
}

export function buildDraftStatus(input: DraftStatusInput): DraftStatusToolOutput {
  const draft = input.draft;
  const stagedViewList = stagedViews({ candidate: input.candidate, draft });
  const hasDraft = Boolean(draft);
  const hasQuery = input.candidate.query_defs.length > 0;
  const dirtyBindingIds = toSet(draft?.dirtyBindingIds);
  const hasView = input.candidate.dashboard_spec.views.length > 0;
  const needsView = hasDraft && hasQuery && stagedViewList.length === 0 && dirtyBindingIds.size === 0;
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
  const unresolvedFailure = input.taskState?.lastFailedTool ?? null;
  const canCompose =
    isDraftComposable({ dashboard: input.dashboard, draft }) && !unresolvedFailure;
  const blockers: DraftStatusToolOutput["blockers"] = [];
  if (!hasDraft) {
    blockers.push("no_draft");
  }
  if (hasDraft && !hasQuery) {
    blockers.push("missing_query");
  }
  if (needsView) {
    blockers.push("missing_view");
  }
  if (missingBindings.length > 0) {
    blockers.push("missing_required_bindings");
  }
  if (unresolvedFailure) {
    blockers.push("unresolved_tool_failure");
  }
  return {
    summary: buildSummary({
      blockers,
      missingBindings,
      canCompose,
    }),
    has_draft: hasDraft,
    has_query: hasQuery,
    has_view: hasView,
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
  getTaskState?: () => AuthoringTaskStateSnapshot | null;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
}) {
  return tool({
    description:
      "Inspect the current working draft lifecycle status and missing pieces. This is read-only. Use it after staging query/view/binding when you need to know what is still missing before composing.",
    inputSchema: z.object({ reason: z.string().optional() }).strict(),
    execute: async (_toolInput: GetDraftStatusToolInput): Promise<DraftStatusToolOutput> =>
      buildDraftStatus({
        dashboard: input.dashboard,
        candidate: input.buildCandidateDocument(input.dashboard, input.workingDraft),
        draft: input.getDraftSnapshot(),
        taskState: input.getTaskState?.() ?? null,
      }),
  });
}
