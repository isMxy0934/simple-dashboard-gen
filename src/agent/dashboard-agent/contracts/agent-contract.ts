import type { UIMessage } from "ai";
import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  DashboardView,
  JsonValue,
  QueryDef,
  DatasourceContext,
} from "@/contracts";
import type { RendererSlotSummary, RendererSummary } from "@/renderers/core/contracts";
import type { RendererValidationChecks } from "@/renderers/core/validation-result";
import type { AiSuggestion } from "@/agent/dashboard-agent/tools/artifacts";
import type { DashboardAgentRouteDecision } from "@/agent/dashboard-agent/contracts/route";

export interface DatasourceListItemSummary {
  datasource_id: string;
  label: string;
  description?: string;
}

export interface DatasourceListSummary {
  datasource_count: number;
  datasources: DatasourceListItemSummary[];
}

export interface DashboardAgentCheckSummary {
  status: "ok" | "warning" | "error";
  reason: string;
  counts: {
    ok: number;
    empty: number;
    error: number;
  };
  errors: DashboardAgentCheckFailure[];
}

export interface DashboardAgentCheckFailure {
  source: "contract" | "runtime" | "renderer";
  code: string;
  message: string;
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
  runtime_summary?: DashboardAgentCheckSummary;
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

export interface RunCheckToolInput {
  scope: "dashboard" | "view";
  view_id?: string;
  reason?: string;
}

export interface RunCheckToolOutput {
  status: "ok" | "warning" | "error";
  reason: string;
  checks: ViewCheckSnapshot[];
  failures: DashboardAgentCheckFailure[];
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

export interface ComposePatchToolInput {
  reason?: string;
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

export interface DashboardAgentDraftOutput {
  suggestion: AiSuggestion;
  approval: ProposalApprovalSummary;
  runtime_check?: DashboardAgentCheckSummary;
  repair: ProposalRepairSummary;
}

export interface ApplyPatchToolOutput {
  applied: true;
  suggestion_id: string;
  kind: AiSuggestion["kind"];
  title: string;
  summary: string;
  patch_summary: string;
  dashboard?: DashboardDocument;
}

export interface DashboardAgentWorkflowStage {
  id: "read" | "write" | "approval";
  title: string;
  description: string;
  status: "complete" | "active" | "pending";
}

export interface DashboardAgentWorkflowSummary {
  route: DashboardAgentRouteDecision["route"];
  mode: "read" | "write" | "approval";
  active_stage: DashboardAgentWorkflowStage["id"];
  summary: string;
  active_tools: string[];
  skill_ids: string[];
  approval_required: boolean;
  stages: DashboardAgentWorkflowStage[];
}

export interface DashboardAgentPatchApprovalPayload {
  approvalId: string;
  suggestionId: string | null;
}

export interface DashboardAgentModelDataParts {
  dashboard_agent_route: DashboardAgentRouteDecision;
  dashboard_agent_workflow: DashboardAgentWorkflowSummary;
  view_list_summary?: GetViewsToolOutput;
  view_check_updates?: ViewCheckSnapshot[];
}

export interface DashboardAgentClientOnlyDataParts {
  dashboard_agent_patch_approval: DashboardAgentPatchApprovalPayload;
}

export interface DashboardAgentDataParts
  extends Record<string, unknown>,
    DashboardAgentModelDataParts,
    DashboardAgentClientOnlyDataParts {}

export interface DashboardAgentTools
  extends Record<string, { input: unknown; output: unknown }> {
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
  composePatch: {
    input: ComposePatchToolInput;
    output: DashboardAgentDraftOutput;
  };
  applyPatch: {
    input: ApplyPatchToolInput;
    output: ApplyPatchToolOutput;
  };
}

export type DashboardAgentMessage = UIMessage<
  unknown,
  DashboardAgentDataParts,
  DashboardAgentTools
>;

export interface DashboardAgentChatRequestBody {
  sessionId: string;
  dashboardId?: string | null;
  messages: DashboardAgentMessage[];
  dashboard: DashboardDocument;
}

export interface DashboardAgentSessionContext {
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
