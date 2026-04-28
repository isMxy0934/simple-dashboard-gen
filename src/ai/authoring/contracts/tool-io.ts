import type { UIMessage } from "ai";
import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardView,
  DatasourceContext,
  QueryDef,
} from "@/contracts";
import type { RendererSlotSummary, RendererSummary } from "@/renderers/core/contracts";
import type { RendererValidationChecks } from "@/renderers/core/validation-result";
import type { AiSuggestion } from "@/ai/authoring/contracts/artifacts";
import type { AuthoringSkillReferenceCheck } from "@/ai/authoring/skill-checks";

export interface DatasourceListItemSummary {
  datasource_id: string;
  label: string;
  description?: string;
}

export interface DatasourceListSummary {
  datasource_count: number;
  datasources: DatasourceListItemSummary[];
}

export interface AuthoringCheckSummary {
  status: "ok" | "warning" | "error";
  reason: string;
  counts: {
    ok: number;
    empty: number;
    error: number;
  };
  errors: AuthoringCheckFailure[];
}

export interface AuthoringCheckFailure {
  source: "contract" | "runtime" | "renderer";
  code: string;
  message: string;
  path?: string;
  view_id?: string;
  query_id?: string;
  binding_id?: string;
}

export interface ViewCheckSnapshot {
  view_id: string;
  status: "unknown" | "ok" | "empty" | "error" | "stale";
  reason: string;
  last_checked_at?: string;
  query_ids: string[];
  binding_ids: string[];
  runtime_summary?: AuthoringCheckSummary;
  renderer_checks?: Partial<RendererValidationChecks>;
}

export interface ViewListItem {
  id: string;
  title: string;
  description?: string;
  renderer_kind: DashboardRenderer["kind"];
  slot_summaries: RendererSlotSummary[];
  renderer_summary: RendererSummary;
  slot_count: number;
  has_query: boolean;
  has_binding: boolean;
  check_status: ViewCheckSnapshot["status"];
  check_reason?: string;
  last_checked_at?: string;
}

export interface QueryUsageRef {
  binding_id: string;
  view_id: string;
  slot_id: string;
}

export interface QueryDetail {
  query: QueryDef;
  used_by: QueryUsageRef[];
}

export interface BindingDetail {
  binding: Binding;
  slot?: DashboardRendererSlot;
  query?: QueryDef;
}

export interface ViewDetail {
  view: DashboardView;
  renderer_kind: DashboardRenderer["kind"];
  slot_summaries: RendererSlotSummary[];
  renderer_summary: RendererSummary;
  layout: {
    desktop?: DashboardLayoutItem | null;
    mobile?: DashboardLayoutItem | null;
  };
  bindings: BindingDetail[];
  query_ids: string[];
  latest_check?: ViewCheckSnapshot | null;
}

export interface GetViewsToolInput {
  reason?: string;
}

export interface GetViewsToolOutput {
  dashboard_name: string;
  dashboard_id: string | null;
  view_count: number;
  views: ViewListItem[];
}

export interface GetDatasourcesToolInput {
  reason?: string;
}

export interface GetDatasourcesToolOutput extends DatasourceListSummary {}

export interface GetViewToolInput {
  view_id?: string;
  title?: string;
}

export interface GetViewToolOutput {
  match_status: "exact" | "ambiguous" | "missing";
  view?: ViewDetail;
  matches?: ViewListItem[];
}

export interface GetQueryToolInput {
  query_id: string;
}

export interface GetBindingToolInput {
  view_id: string;
  slot_id?: string;
}

export interface GetDraftStatusToolInput {
  reason?: string;
}

export type AuthoringDataMode = "live" | "mock" | "undecided";

export interface DraftStatusMissingBinding {
  view_id: string;
  view_title: string;
  slot_id: string;
  slot_path: string;
  slot_value_kind: DashboardRendererSlot["value_kind"];
  expected_mode: Exclude<AuthoringDataMode, "undecided">;
  has_mock_binding: boolean;
}

export type AuthoringNextAction =
  | "none"
  | "clarify_scope"
  | "decide_data_mode"
  | "stage_query"
  | "stage_view"
  | "stage_binding"
  | "fix_layout"
  | "fix_failure"
  | "run_check"
  | "compose_patch"
  | "await_approval";

export type AuthoringLifecyclePhase =
  | "idle"
  | "drafting"
  | "ready_to_check"
  | "ready_to_compose"
  | "awaiting_approval"
  | "recovering_tool_error"
  | "completed";

export interface DraftStatusLayoutCoverage {
  view_id: string;
  view_title: string;
  desktop: boolean;
  mobile: boolean;
}

export interface DraftStatusToolOutput {
  summary: string;
  document_hash: string;
  data_mode: AuthoringDataMode;
  has_draft: boolean;
  has_query: boolean;
  has_view: boolean;
  dirty_view_ids: string[];
  dirty_query_ids: string[];
  dirty_binding_ids: string[];
  layout_coverage: DraftStatusLayoutCoverage[];
  unplaced_view_ids: string[];
  last_check_hash?: string | null;
  check_fresh: boolean;
  next_required_action: AuthoringNextAction;
  live_binding_count: number;
  mock_binding_count: number;
  missing_required_bindings: DraftStatusMissingBinding[];
  can_compose: boolean;
  blockers: Array<
    | "no_draft"
    | "staging_not_started"
    | "data_mode_undecided"
    | "missing_query"
    | "missing_view"
    | "missing_layout"
    | "stale_check"
    | "missing_required_bindings"
    | "unresolved_tool_failure"
  >;
  unresolved_failure?: {
    tool_name: string;
    error_summary: string;
    recovery_hint?: string;
  } | null;
}

export interface AuthoringContextEnvelope {
  user_intent: {
    latest_user_text?: string | null;
    declared_intent?: AuthoringIntent | null;
  };
  scope_resolution: AuthoringScopeResolution;
  lifecycle: {
    phase: AuthoringLifecyclePhase;
    next_required_action: AuthoringNextAction;
    next_required_tool?: string | null;
    reason: string;
  };
  draft: {
    document_hash: string;
    data_mode: AuthoringDataMode;
    dirty_view_ids: string[];
    dirty_query_ids: string[];
    dirty_binding_ids: string[];
    layout_coverage: DraftStatusLayoutCoverage[];
    unplaced_view_ids: string[];
    last_check_hash?: string | null;
    check_fresh: boolean;
    can_compose: boolean;
    blockers: DraftStatusToolOutput["blockers"];
  };
  pending_approval: {
    proposal_id?: string | null;
    summary?: string | null;
    operation_count?: number | null;
  } | null;
  save_publish: {
    local_draft_dirty: boolean;
    cloud_draft_saved: boolean;
    published: boolean;
  };
  datasources: DatasourceListSummary;
  loaded_skill_refs: string[];
}

export interface AuthoringScopeResolution {
  effective_scope: "dashboard" | "focused";
  selected_view_id: string | null;
  scope_reason:
    | "no_selection"
    | "selected_view"
    | "invalid_selection"
    | "blocked_dashboard_request";
  requires_scope_clarification: boolean;
}

export interface GetSchemaByDatasourceToolInput {
  datasource_id: string;
  reason?: string;
}

export type GetSchemaByDatasourceToolOutput = DatasourceContext;

export interface AuthoringSkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  /** Optional metadata from SKILL.md; not used for route/tool authorization. */
  triggers?: string[];
}

/**
 * Explicit intent the UI (or caller) can pass in to override keyword-based
 * routing in `scope.ts`. Natural-language user text is not used for routing;
 * when this is absent, the authoring agent receives the normal tool surface and
 * decides whether to use tools.
 */
export type AuthoringIntent =
  | "apply"
  | "cancel"
  | "ask-capability"
  | "explore"
  | "author";

export interface LoadSkillToolInput {
  name: string;
  reason?: string;
}

export interface LoadSkillToolOutput {
  skill_id: string;
  skill_directory: string;
  content: string;
}

export interface LoadSkillReferenceToolInput {
  skill_id: string;
  reference_name: string;
  reason?: string;
}

export interface LoadSkillReferenceToolOutput {
  skill_id: string;
  reference_name: string;
  reference_path: string;
  content: string;
  check?: AuthoringSkillReferenceCheck | null;
}

export interface RunCheckToolInput {
  scope: "dashboard" | "view";
  view_id?: string;
  reason?: string;
}

export interface RunCheckToolOutput {
  status: "ok" | "warning" | "error";
  reason: string;
  checks: ViewCheckSnapshot[];
  failures: AuthoringCheckFailure[];
  renderer_checks: Array<{
    view_id: string;
    checks: Partial<RendererValidationChecks>;
  }>;
}

export interface UpsertViewToolInput {
  request: string;
  skill_reference?: string;
  view_spec: {
    view_id?: string;
    title: string;
    description?: string;
    renderer: DashboardRenderer;
  };
  layout?: {
    desktop?: DashboardLayoutItem;
    mobile?: DashboardLayoutItem;
  };
}

export interface UpsertQueryToolInput {
  reason?: string;
  skill_reference?: string;
  query: QueryDef;
}

export interface UpsertBindingToolInput {
  reason?: string;
  skill_reference?: string;
  binding: Binding;
}

export interface DeleteViewToolInput {
  reason?: string;
  view_id: string;
}

export interface DeleteQueryToolInput {
  reason?: string;
  query_id: string;
}

export interface DeleteBindingToolInput {
  reason?: string;
  binding_id: string;
}

export interface UpsertViewToolOutput {
  summary: string;
  view: ViewDetail;
}

export interface UpsertQueryToolOutput {
  summary: string;
  query: QueryDetail;
}

export interface UpsertBindingToolOutput {
  summary: string;
  bindings: BindingDetail[];
}

export interface DeleteViewToolOutput {
  summary: string;
  view_id: string;
  removed_binding_ids: string[];
}

export interface DeleteQueryToolOutput {
  summary: string;
  query_id: string;
  removed_binding_ids: string[];
}

export interface DeleteBindingToolOutput {
  summary: string;
  binding_id: string;
  view_id: string;
}

export interface ComposePatchToolInput {
  reason?: string;
  intent?: string;
}

export interface ApplyPatchToolInput {
  suggestion_id?: string;
}

export interface ProposalApprovalSummary {
  required: true;
  status: "pending";
  summary: string;
  operation_count: number;
  affected_paths: string[];
}

export interface ProposalRepairSummary {
  status: "not-needed" | "repaired" | "failed";
  attempted: number;
  max_attempts: number;
  repaired: boolean;
  notes: string[];
}

export interface AuthoringDraftOutput {
  suggestion: AiSuggestion;
  approval: ProposalApprovalSummary;
  runtime_check?: AuthoringCheckSummary;
  repair: ProposalRepairSummary;
}

export interface ApplyPatchToolOutput {
  applied: true;
  suggestion_id: string;
  kind: AiSuggestion["kind"];
  title: string;
  summary: string;
  patch_summary: string;
  focused_view_id?: string | null;
  dashboard?: DashboardDocument;
}

export interface AuthoringWorkflowStage {
  id: "chat" | "explore" | "author" | "approval";
  title: string;
  description: string;
  status: "complete" | "active" | "pending";
}

export interface AuthoringWorkflowSummary {
  route: "approval" | "chat" | "authoring";
  mode:
    | "chat"
    | "explore"
    | "author-dashboard"
    | "author-focused"
    | "approval";
  active_stage: AuthoringWorkflowStage["id"];
  summary: string;
  active_tools: string[];
  skill_ids: string[];
  approval_required: boolean;
  stages: AuthoringWorkflowStage[];
}

export interface AuthoringPatchApprovalPayload {
  approvalId: string;
  suggestionId: string | null;
}

export interface AuthoringDataParts extends Record<string, unknown> {
  authoring_scope?: {
    mode:
      | "chat"
      | "explore"
      | "author-dashboard"
      | "author-focused"
      | "approval";
    scope:
      | { kind: "dashboard" }
      | { kind: "focused"; viewId: string }
      | { kind: "empty" };
    scopeResolution?: AuthoringScopeResolution;
    activeTools: string[];
    toolChoice?: "auto" | "none" | { type: "tool"; toolName: string };
    contextFingerprint?: string | null;
    stopReason?: "approval-applied" | null;
    taskState?: Record<string, unknown> | null;
  };
  authoring_patch?: AuthoringDraftOutput;
  authoring_checks?: ViewCheckSnapshot[];
  authoring_patch_approval?: AuthoringPatchApprovalPayload;
}

export interface AuthoringTools
  extends Record<string, { input: unknown; output: unknown }> {
  loadSkill: {
    input: LoadSkillToolInput;
    output: LoadSkillToolOutput;
  };
  loadSkillReference: {
    input: LoadSkillReferenceToolInput;
    output: LoadSkillReferenceToolOutput;
  };
  getViews: {
    input: GetViewsToolInput;
    output: GetViewsToolOutput;
  };
  getDatasources: {
    input: GetDatasourcesToolInput;
    output: GetDatasourcesToolOutput;
  };
  getView: {
    input: GetViewToolInput;
    output: GetViewToolOutput;
  };
  getQuery: {
    input: GetQueryToolInput;
    output: QueryDetail;
  };
  getBinding: {
    input: GetBindingToolInput;
    output: { bindings: BindingDetail[] };
  };
  getDraftStatus: {
    input: GetDraftStatusToolInput;
    output: DraftStatusToolOutput;
  };
  getSchemaByDatasource: {
    input: GetSchemaByDatasourceToolInput;
    output: GetSchemaByDatasourceToolOutput;
  };
  runCheck: {
    input: RunCheckToolInput;
    output: RunCheckToolOutput;
  };
  upsertView: {
    input: UpsertViewToolInput;
    output: UpsertViewToolOutput;
  };
  upsertQuery: {
    input: UpsertQueryToolInput;
    output: UpsertQueryToolOutput;
  };
  upsertBinding: {
    input: UpsertBindingToolInput;
    output: UpsertBindingToolOutput;
  };
  deleteView: {
    input: DeleteViewToolInput;
    output: DeleteViewToolOutput;
  };
  deleteQuery: {
    input: DeleteQueryToolInput;
    output: DeleteQueryToolOutput;
  };
  deleteBinding: {
    input: DeleteBindingToolInput;
    output: DeleteBindingToolOutput;
  };
  composePatch: {
    input: ComposePatchToolInput;
    output: AuthoringDraftOutput;
  };
  applyPatch: {
    input: ApplyPatchToolInput;
    output: ApplyPatchToolOutput;
  };
}

export type AuthoringMessage = UIMessage<
  unknown,
  AuthoringDataParts,
  AuthoringTools
>;

export interface AuthoringChatRequestBody {
  workspaceId?: string | null;
  sessionId: string;
  dashboardId?: string | null;
  focusedViewId?: string | null;
  messages: AuthoringMessage[];
  dashboard: DashboardDocument;
  /**
   * Optional explicit intent the UI attaches when it already knows what the
   * user is doing (e.g. clicking "Explore" or a pre-set prompt). When absent,
   * the scope layer does not infer intent from user text.
   */
  intent?: AuthoringIntent | null;
}

export interface AuthoringSessionContext {
  sessionId: string;
  dashboardId?: string | null;
  turnId?: string | null;
}

export function collectViewQueryIds(
  viewId: string,
  bindings: Binding[],
): string[] {
  return [...new Set(bindings.filter((binding) => binding.view_id === viewId)
    .map((binding) => binding.query_id)
    .filter((queryId): queryId is string => typeof queryId === "string"))];
}

export function resolveViewHasQuery(viewId: string, bindings: Binding[]) {
  return bindings.some(
    (binding) => binding.view_id === viewId && typeof binding.query_id === "string",
  );
}

export function resolveViewHasBinding(viewId: string, bindings: Binding[]) {
  return bindings.some((binding) => binding.view_id === viewId);
}

export function buildBindingDetail(input: {
  binding: Binding;
  view?: DashboardView;
  query?: QueryDef;
}): BindingDetail {
  const slot = input.view?.renderer.slots.find(
    (candidate) => candidate.id === input.binding.slot_id,
  );

  return {
    binding: input.binding,
    slot,
    query: input.query,
  };
}
