import type { UIMessage } from "ai";
import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardView,
  DatasourceContext,
  JsonValue,
  QueryDef,
} from "@/contracts";
import type { RendererSlotSummary, RendererSummary } from "@/renderers/core/contracts";
import type { RendererValidationChecks } from "@/renderers/core/validation-result";
import type { AiSuggestion } from "@/ai/authoring/contracts/artifacts";

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
}

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
  query: QueryDef;
}

export interface UpsertBindingToolInput {
  reason?: string;
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
  id: "read" | "write" | "approval";
  title: string;
  description: string;
  status: "complete" | "active" | "pending";
}

export interface AuthoringWorkflowSummary {
  route: "approval" | "chat" | "authoring";
  mode: "read" | "write" | "approval";
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
      | "author-first-view"
      | "author-dashboard"
      | "author-focused"
      | "approval";
    scope:
      | { kind: "dashboard" }
      | { kind: "focused"; viewId: string }
      | { kind: "empty" };
    activeTools: string[];
    toolChoice?: "auto" | "none";
    contextFingerprint?: string | null;
    stopReason?: "approval-applied" | null;
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
