import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRendererSlot,
  DatasourceContext,
  DatasourceField,
  QueryParamType,
} from "@/contracts";
import type {
  DashboardDesignKitId,
  DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";
import type { RendererValidationChecks } from "@/renderers/core/validation-result";
import type { AiSuggestion } from "@/ai/authoring/contracts/artifacts";
import type {
  AuthoringCheckFailure,
  AuthoringCheckSummary,
  BindingDetail,
  DatasourceListItemSummary,
  DatasourceListSummary,
  QueryDetail,
  ViewCheckSnapshot,
  ViewDetail,
  ViewListItem,
} from "@/ai/authoring/contracts/datasource-view-summaries";
import type {
  AuthoringContextEnvelope,
  AuthoringDataParts,
  AuthoringPatchApprovalPayload,
  AuthoringScopeResolution,
  AuthoringModeStageId,
  AuthoringModeSummary,
} from "@/ai/authoring/contracts/mode-summary";

export type {
  AuthoringCheckFailure,
  AuthoringCheckSummary,
  BindingDetail,
  DatasourceListItemSummary,
  DatasourceListSummary,
  QueryDetail,
  ViewCheckSnapshot,
  ViewDetail,
  ViewListItem,
} from "@/ai/authoring/contracts/datasource-view-summaries";
export {
  buildBindingDetail,
  collectViewQueryIds,
} from "@/ai/authoring/contracts/datasource-view-summaries";
export type {
  AuthoringContextEnvelope,
  AuthoringDataParts,
  AuthoringPatchApprovalPayload,
  AuthoringScopeResolution,
  AuthoringModeStageId,
  AuthoringModeSummary,
} from "@/ai/authoring/contracts/mode-summary";

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

export interface ListDatasourceTablesToolInput {
  datasource_id: string;
  reason?: string;
}

export interface DatasourceTableSummary {
  name: string;
  description?: string;
  field_count: number;
}

export interface ListDatasourceTablesToolOutput {
  datasource_id: string;
  dialect: DatasourceContext["dialect"];
  table_count: number;
  tables: DatasourceTableSummary[];
}

export interface GetTableSchemaToolInput {
  datasource_id: string;
  table: string;
  reason?: string;
}

export interface TableSchemaFieldSummary {
  name: string;
  qualified_name: string;
  standard_type: string;
  database_type?: string;
  nullable: boolean;
  semantic_type?: DatasourceField["semantic_type"];
  filterable?: boolean;
  available_aggregations?: string[];
  description?: string;
  comment?: string;
  primary_key?: boolean;
  indexed?: boolean;
}

export interface GetTableSchemaToolOutput {
  datasource_id: string;
  dialect: DatasourceContext["dialect"];
  table: {
    name: string;
    description?: string;
  };
  field_count: number;
  fields: TableSchemaFieldSummary[];
}

export interface PreviewTableDataToolInput {
  datasource_id: string;
  table: string;
  columns?: string[];
  limit?: number;
  reason?: string;
}

export interface PreviewTableDataToolOutput {
  datasource_id: string;
  table: string;
  columns: string[];
  limit: number;
  row_count: number;
  rows: Record<string, unknown>[];
}

export interface AuthoringSkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  /** Optional metadata from SKILL.md; not used for route/tool authorization. */
  triggers?: string[];
}

/**
 * Explicit intent the UI (or caller) can pass into the scope capability
 * resolver. Authoring mode is resolved by the runtime before tools are exposed.
 */
export type AuthoringIntent =
  | "apply"
  | "cancel"
  | "ask-capability"
  | "explore"
  | "author";

export interface DeclareViewGoalInput {
  summary?: string;
  dataMode?: "live" | "mock" | "undecided";
  chartSkillId?: string;
  requestedChartLabel?: string;
  metrics?: string[];
  dimensions?: string[];
  timeGrain?: "day" | "week" | "month";
  datasourceId?: string;
  table?: string;
  targetViewId?: string;
  targetViewTitle?: string;
}

export type DeclareAuthoringGoalToolInput =
  | {
      kind: "set_data_mode";
      dataMode: "live" | "mock";
      reason?: string;
    }
  | {
      kind: "create_view" | "revise_view";
      goal: DeclareViewGoalInput;
      reason?: string;
    }
  | {
      kind: "create_dashboard";
      goal: {
        summary?: string;
        dataMode?: "live" | "mock" | "undecided";
        chartSkillId?: string;
        requestedChartLabel?: string;
        datasourceId?: string;
        table?: string;
        views: DeclareViewGoalInput[];
      };
      reason?: string;
    };

export interface DeclareAuthoringGoalToolOutput {
  accepted: boolean;
  declaredIntentKind: DeclareAuthoringGoalToolInput["kind"];
  activeGoalId?: string;
  declaration?: DeclareAuthoringGoalToolInput;
  message: string;
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

export type RunCheckToolInput = {
  scope: "dashboard" | "view";
  view_id?: string;
  reason?: string;
};

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

export type StageChartFieldRole =
  | "time"
  | "category"
  | "metric"
  | "value"
  | "series";

export interface StageChartFieldInput {
  /** Source table field selected for this chart role. Use the table field name or qualified field name. */
  source_field: string;
  label?: string;
  type?: QueryParamType;
  aggregation?: string;
}

export interface StageChartToolInput {
  goal_id?: string;
  reason?: string;
  skill_id: string;
  design_kit_id?: DashboardDesignKitId;
  view_style_id?: DashboardViewStyleId;
  title: string;
  description?: string;
  target_view_id?: string;
  datasource_id: string;
  table: string;
  data_mode?: "live" | "mock";
  fields: Partial<Record<StageChartFieldRole, StageChartFieldInput>>;
  time_grain?: "day" | "week" | "month";
  sort?: {
    field_role?: StageChartFieldRole;
    direction?: "asc" | "desc";
  };
  limit?: number;
  filters?: Array<{
    field: string;
    op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
    value: string | number | boolean;
  }>;
  layout?: {
    desktop?: Partial<DashboardLayoutItem>;
    mobile?: Partial<DashboardLayoutItem>;
  };
  mock_data?: Binding["mock_data"];
  mock_value?: Binding["mock_value"];
}

export type StageDeleteTarget =
  | { kind: "view"; view_id: string }
  | { kind: "query"; query_id: string }
  | { kind: "binding"; binding_id: string };

export interface StageChartToolOutput {
  summary: string;
  transaction_id: string;
  stage: "staged";
  artifact_ids: {
    view_id: string;
    query_id?: string;
    binding_ids: string[];
  };
  design_kit_id?: string;
  view_style_id?: string;
  blockers: string[];
  view: ViewDetail;
  query?: QueryDetail;
  bindings: BindingDetail[];
  draft_status: DraftStatusToolOutput;
}

export interface StageReplaceChartToolInput
  extends Omit<StageChartToolInput, "target_view_id"> {
  replace_view_id: string;
}

export interface StageReplaceChartToolOutput
  extends Omit<StageChartToolOutput, "artifact_ids"> {
  artifact_ids: {
    replaced_view_id: string;
    removed_view_ids: string[];
    removed_query_ids: string[];
    removed_binding_ids: string[];
    view_id: string;
    query_id?: string;
    binding_ids: string[];
  };
}

export interface StageQueryToolInput {
  query_id: string;
  sql: string;
  reason: string;
}

export interface StageQueryToolOutput {
  summary: string;
  stage: "staged";
  query_id: string;
  sql_preview: string;
  draft_status: DraftStatusToolOutput;
}

export interface StageDeleteToolInput {
  reason?: string;
  target: StageDeleteTarget;
}

export interface StageDeleteToolOutput {
  summary: string;
  transaction_id: string;
  stage: "staged";
  target: StageDeleteTarget;
  artifact_ids: {
    removed_view_ids: string[];
    removed_query_ids: string[];
    removed_binding_ids: string[];
  };
  blockers: string[];
  draft_status: DraftStatusToolOutput;
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

export interface ProposalStabilizationSummary {
  status: "not-needed" | "failed";
  checked: boolean;
  notes: string[];
}

export interface AuthoringDraftOutput {
  suggestion: AiSuggestion;
  approval: ProposalApprovalSummary;
  /** Fingerprint of the base dashboard document captured before staged changes. */
  base_document_fingerprint: string;
  /** Fingerprint of the staged candidate document captured when this proposal was composed. */
  draft_fingerprint: string;
  /** Draft base version captured when this proposal was composed. */
  base_version?: number;
  /** Epoch milliseconds when this proposal can no longer be approved. */
  expires_at: number;
  runtime_check?: AuthoringCheckSummary;
  stabilization: ProposalStabilizationSummary;
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

export interface AuthoringApprovalEvent {
  proposalId: string;
  decision: "approve" | "reject";
  baseVersion: number;
  currentDocumentHash: string;
}

export interface AuthoringTools
  extends Record<string, { input: unknown; output: unknown }> {
  declareAuthoringGoal: {
    input: DeclareAuthoringGoalToolInput;
    output: DeclareAuthoringGoalToolOutput;
  };
  loadSkill: {
    input: LoadSkillToolInput;
    output: LoadSkillToolOutput;
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
  listDatasourceTables: {
    input: ListDatasourceTablesToolInput;
    output: ListDatasourceTablesToolOutput;
  };
  getTableSchema: {
    input: GetTableSchemaToolInput;
    output: GetTableSchemaToolOutput;
  };
  previewTableData: {
    input: PreviewTableDataToolInput;
    output: PreviewTableDataToolOutput;
  };
  runCheck: {
    input: RunCheckToolInput;
    output: RunCheckToolOutput;
  };
  stageChart: {
    input: StageChartToolInput;
    output: StageChartToolOutput;
  };
  stageReplaceChart: {
    input: StageReplaceChartToolInput;
    output: StageReplaceChartToolOutput;
  };
  stageQuery: {
    input: StageQueryToolInput;
    output: StageQueryToolOutput;
  };
  stageDelete: {
    input: StageDeleteToolInput;
    output: StageDeleteToolOutput;
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

export interface AuthoringChatRequestBody {
  workspaceId: string;
  userId: string;
  permissions?: string[];
  chatSessionId: string;
  editingSessionId: string;
  dashboardId: string;
  focusedViewId?: string | null;
  messageText?: string;
  dashboard: DashboardDocument;
  /** Draft version at request time. Approval events use this to guard stale proposals. */
  baseVersion?: number;
  /** Explicit UI approval/rejection event. Ordinary chat text must not set this. */
  approvalEvent?: AuthoringApprovalEvent | null;
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
