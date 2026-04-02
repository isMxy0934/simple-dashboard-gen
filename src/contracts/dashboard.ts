export type SchemaVersion = "0.2";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type JsonArray = JsonValue[];

export interface DashboardSpec {
  schema_version: SchemaVersion;
  dashboard: DashboardMeta;
  layout: DashboardLayoutMap;
  views: DashboardView[];
  filters: DashboardFilter[];
}

export interface DashboardMeta {
  name: string;
  description?: string;
}

export interface DashboardLayoutMap {
  desktop?: DashboardBreakpointLayout;
  mobile?: DashboardBreakpointLayout;
}

export interface DashboardBreakpointLayout {
  cols: number;
  row_height: number;
  items: DashboardLayoutItem[];
}

export interface DashboardLayoutItem {
  view_id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardView {
  id: string;
  title: string;
  description?: string;
  renderer: DashboardRenderer;
}

export interface EChartsDashboardRenderer {
  kind: "echarts";
  option_template: JsonObject;
  slots: DashboardRendererSlot[];
}

export type DashboardRenderer = EChartsDashboardRenderer;

export interface DashboardRendererSlot {
  id: string;
  path: string;
  value_kind: QueryOutputKind;
  required?: boolean;
}

export type DashboardFilter = TimeRangeFilter | SingleSelectFilter;

export interface BaseDashboardFilter {
  id: string;
  kind: "time_range" | "single_select";
  label: string;
  default_value?: string;
  options?: FilterOption[];
  resolved_fields?: string[];
}

export interface TimeRangeFilter extends BaseDashboardFilter {
  kind: "time_range";
  resolved_fields: string[];
}

export interface SingleSelectFilter extends BaseDashboardFilter {
  kind: "single_select";
  options: FilterOption[];
}

export interface FilterOption {
  label: string;
  value: string;
}

export type QueryParamType = "string" | "number" | "boolean" | "date" | "datetime";
export type QueryParamCardinality = "scalar" | "array";

export interface QueryDef {
  id: string;
  name: string;
  datasource_id: string;
  sql_template: string;
  params: QueryParamDef[];
  output: QueryOutput;
}

export interface QueryParamDef {
  name: string;
  type: QueryParamType;
  required?: boolean;
  default_value?: JsonValue;
  cardinality?: QueryParamCardinality;
}

export interface ResultSchemaField {
  name: string;
  type: QueryParamType;
  nullable: boolean;
}

export type QueryOutputKind = "rows" | "array" | "object" | "scalar";

export interface QueryRowsOutput {
  kind: "rows";
  schema: ResultSchemaField[];
}

export interface QueryArrayOutput {
  kind: "array";
}

export interface QueryObjectOutput {
  kind: "object";
}

export interface QueryScalarOutput {
  kind: "scalar";
  value_type: QueryParamType;
}

export type QueryOutput =
  | QueryRowsOutput
  | QueryArrayOutput
  | QueryObjectOutput
  | QueryScalarOutput;

export type BindingMode = "mock" | "live";

export interface MockBindingData {
  rows: BindingRow[];
}

export interface Binding {
  id: string;
  view_id: string;
  slot_id: string;
  mode?: BindingMode;
  query_id?: string;
  param_mapping?: Record<string, BindingParamMapping>;
  result_selector?: string | null;
  field_mapping?: Record<string, string>;
  mock_value?: JsonValue;
  mock_data?: MockBindingData;
}

export type BindingParamSource = "filter" | "constant" | "runtime_context";

export interface BindingParamMapping {
  source: BindingParamSource;
  value: JsonValue;
}

export interface DatasourceContext {
  datasource_id: string;
  dialect: "postgres";
  tables: DatasourceTable[];
  metrics?: DatasourceMetric[];
  visibility_scope: DatasourceVisibilityScope;
}

export interface DatasourceTable {
  name: string;
  description?: string;
  fields: DatasourceField[];
}

export interface DatasourceField {
  name: string;
  type: string;
  semantic_type?: "time" | "dimension" | "metric";
  filterable?: boolean;
  aggregations?: string[];
  description?: string;
}

export interface DatasourceMetric {
  id: string;
  label: string;
  description?: string;
  default_aggregation?: string;
}

export interface DatasourceVisibilityScope {
  allowed_tables: string[];
  allowed_fields: string[];
}

export interface RuntimeContext {
  timezone?: string;
  locale?: string;
}

export type BindingRowValue = string | number | boolean | null;
export type BindingRow = Record<string, BindingRowValue>;

export interface BindingData {
  value: JsonValue;
  rows?: BindingRow[];
}

export interface BindingResultSuccess {
  view_id: string;
  slot_id: string;
  query_id: string;
  status: "ok" | "empty";
  data: BindingData;
}

export interface BindingResultError {
  view_id: string;
  slot_id: string;
  query_id: string;
  status: "error";
  code?: string;
  message?: string;
}

export type BindingResult = BindingResultSuccess | BindingResultError;
export type BindingResults = Record<string, BindingResult>;

export interface ApiResponse<T> {
  status_code: number;
  reason: string;
  data: T | null;
}

export interface DashboardDocument {
  dashboard_spec: DashboardSpec;
  query_defs: QueryDef[];
  bindings: Binding[];
}

export interface PreviewRequest extends DashboardDocument {
  visible_view_ids?: string[];
  filter_values?: Record<string, JsonValue>;
  runtime_context?: RuntimeContext;
}

export interface SaveRequest extends DashboardDocument {
  dashboard_id?: string;
}

export interface PublishRequest extends DashboardDocument {
  dashboard_id?: string;
}

export type DashboardSnapshotSource = "draft" | "published";
export type DashboardListMode = "authoring" | "viewer";

export interface DashboardSummary {
  dashboard_id: string;
  name: string;
  description?: string;
  updated_at: string;
  latest_version: number;
  snapshot_source: DashboardSnapshotSource;
}

export interface DashboardSnapshot {
  dashboard_id: string;
  version: number;
  source: DashboardSnapshotSource;
  updated_at: string;
  document: DashboardDocument;
}

export interface ExecuteBatchRequest {
  dashboard_id: string;
  version: number;
  visible_view_ids: string[];
  filter_values?: Record<string, JsonValue>;
  runtime_context?: RuntimeContext;
}
