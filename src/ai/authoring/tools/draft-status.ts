import { tool } from "ai";
import { z } from "zod";
import type {
  Binding,
  DashboardDocument,
  DashboardRendererSlot,
  DashboardView,
  QueryDef,
  QueryParamType,
  ResultSchemaField,
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

function stagedQueryIds(draft: AuthoringWorkingDraftSnapshot | null): Set<string> {
  return toSet(draft?.dirtyQueryIds);
}

function pickCandidateQuery(input: {
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
}): QueryDef | null {
  const dirtyQueryIds = stagedQueryIds(input.draft);
  return (
    input.candidate.query_defs.find((query) => dirtyQueryIds.has(query.id)) ??
    input.candidate.query_defs[0] ??
    null
  );
}

function roleForSlot(slot: DashboardRendererSlot): "time" | "category" | "metric" | null {
  const text = `${slot.id} ${slot.path}`.toLowerCase();
  if (text.includes("xaxis") || text.includes("time") || text.includes("date")) {
    return "time";
  }
  if (text.includes("category")) {
    return "category";
  }
  if (
    text.includes("series") ||
    text.includes("yaxis") ||
    text.includes("metric") ||
    text.includes("value")
  ) {
    return "metric";
  }
  return null;
}

function fieldTypeMatchesRole(type: QueryParamType, role: "time" | "category" | "metric") {
  if (role === "metric") {
    return type === "number";
  }
  if (role === "time") {
    return type === "date" || type === "datetime" || type === "string";
  }
  return type === "string" || type === "boolean" || type === "number";
}

function fieldNameMatchesRole(name: string, role: "time" | "category" | "metric") {
  const lowered = name.toLowerCase();
  if (role === "metric") {
    return /metric|value|amount|gmv|orders|count|rate|revenue|sales/.test(lowered);
  }
  if (role === "time") {
    return /time|date|week|month|day|start|bucket/.test(lowered);
  }
  return /category|region|channel|segment|name|type|group/.test(lowered);
}

function pickFieldForSlot(input: {
  query: QueryDef;
  slot: DashboardRendererSlot;
}): ResultSchemaField | null {
  if (input.query.output.kind !== "rows") {
    return null;
  }
  const role = roleForSlot(input.slot);
  if (role) {
    const roleFields = input.query.output.schema.filter((field) =>
      fieldTypeMatchesRole(field.type, role),
    );
    return (
      roleFields.find((field) => fieldNameMatchesRole(field.name, role)) ??
      roleFields[0] ??
      null
    );
  }
  if (input.slot.value_kind === "array" || input.slot.value_kind === "scalar") {
    return input.query.output.schema[0] ?? null;
  }
  return null;
}

function selectorForSlot(input: {
  query: QueryDef | null;
  slot: DashboardRendererSlot;
}): string | null {
  const query = input.query;
  if (!query) {
    return null;
  }
  if (query.output.kind === input.slot.value_kind) {
    return null;
  }
  if (query.output.kind !== "rows") {
    return null;
  }
  if (input.slot.value_kind === "rows") {
    return "rows";
  }
  if (input.slot.value_kind === "object") {
    return "rows[0]";
  }
  const field = pickFieldForSlot({ query, slot: input.slot });
  if (!field) {
    return null;
  }
  if (input.slot.value_kind === "scalar") {
    return `rows[0].${field.name}`;
  }
  if (input.slot.value_kind === "array") {
    return `rows[].${field.name}`;
  }
  return null;
}

function recommendedBindingId(viewId: string, slotId: string) {
  return `b_${viewId}_${slotId}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

function missingRequiredBindings(input: {
  candidate: DashboardDocument;
  draft: AuthoringWorkingDraftSnapshot | null;
}): DraftStatusMissingBinding[] {
  const views = stagedViews(input);
  if (views.length === 0) {
    return [];
  }
  const candidateQuery = pickCandidateQuery(input);
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
        candidate_query_id: candidateQuery?.id ?? null,
        recommended_binding_id: recommendedBindingId(view.id, slot.id),
        recommended_result_selector: selectorForSlot({
          query: candidateQuery,
          slot,
        }),
      })),
  );
}

function chooseNextTool(input: {
  hasDraft: boolean;
  hasQuery: boolean;
  needsView: boolean;
  missingBindings: DraftStatusMissingBinding[];
  canCompose: boolean;
  unresolvedFailure: AuthoringTaskStateSnapshot["lastFailedTool"] | null | undefined;
}): DraftStatusToolOutput["recommended_next_tool"] {
  if (input.unresolvedFailure) {
    return input.unresolvedFailure.toolName === "runCheck" ||
      input.unresolvedFailure.toolName === "composePatch" ||
      input.unresolvedFailure.toolName === "applyPatch"
      ? "runCheck"
      : input.unresolvedFailure.toolName;
  }
  if (!input.hasDraft || !input.hasQuery) {
    return "upsertQuery";
  }
  if (input.needsView) {
    return "upsertView";
  }
  if (input.missingBindings.length > 0) {
    return "upsertBinding";
  }
  return input.canCompose ? "composePatch" : "runCheck";
}

function buildSummary(input: {
  blockers: DraftStatusToolOutput["blockers"];
  missingBindings: DraftStatusMissingBinding[];
  canCompose: boolean;
  recommendedNextTool: DraftStatusToolOutput["recommended_next_tool"];
}) {
  if (input.blockers.includes("unresolved_tool_failure")) {
    return `Draft status: unresolved tool failure. Recommended next tool: ${input.recommendedNextTool ?? "none"}.`;
  }
  if (input.missingBindings.length > 0) {
    return `Draft status: ${input.missingBindings.length} required live binding(s) missing. Recommended next tool: upsertBinding.`;
  }
  if (input.canCompose) {
    return "Draft status: complete and ready to compose.";
  }
  return `Draft status: incomplete. Recommended next tool: ${input.recommendedNextTool ?? "none"}.`;
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
  const recommendedNextTool = chooseNextTool({
    hasDraft,
    hasQuery,
    needsView,
    missingBindings,
    canCompose,
    unresolvedFailure,
  });
  return {
    summary: buildSummary({
      blockers,
      missingBindings,
      canCompose,
      recommendedNextTool,
    }),
    has_draft: hasDraft,
    has_query: hasQuery,
    has_view: hasView,
    live_binding_count: liveBindingCount,
    mock_binding_count: mockBindingCount,
    missing_required_bindings: missingBindings,
    can_compose: canCompose,
    recommended_next_tool: recommendedNextTool,
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
