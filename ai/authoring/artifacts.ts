import type {
  DashboardDocument,
  DashboardLayoutItem,
  DatasourceContext,
} from "../../contracts";

export type AiSuggestionKind = "layout" | "data";

export interface ContractPatchOperation {
  op: "add" | "update" | "remove" | "upsert";
  path: string;
  summary: string;
}

export interface ContractPatch {
  summary: string;
  operations: ContractPatchOperation[];
}

export interface AiSuggestion {
  id: string;
  kind: AiSuggestionKind;
  title: string;
  summary: string;
  details: string[];
  patch: ContractPatch;
  /** Full candidate document; omitted after prune/redact to keep chat payloads small. */
  dashboard?: DashboardDocument;
}

export type LayoutChartType = "line" | "bar" | "pie" | "metric";
export type LayoutViewSize = "small" | "medium" | "large" | "full";

export interface LayoutViewSpec {
  view_id?: string;
  title: string;
  description?: string;
  chart_type: LayoutChartType;
  x_field?: string;
  y_field?: string;
  item_name_field?: string;
  value_field?: string;
  size?: LayoutViewSize;
  smooth?: boolean;
}

export interface LayoutBreakpointSpec {
  cols?: number;
  row_height?: number;
  items: DashboardLayoutItem[];
}

export interface LayoutDraftToolInput {
  request: string;
  include_filters?: boolean;
  replace_existing_views?: boolean;
  view_specs: LayoutViewSpec[];
  layout?: {
    desktop?: LayoutBreakpointSpec;
    mobile?: LayoutBreakpointSpec;
  };
}

export interface GenerateLayoutInput extends LayoutDraftToolInput {
  currentDocument: DashboardDocument;
}

export interface GenerateDataInput {
  prompt: string;
  currentDocument: DashboardDocument;
  datasourceContext?: DatasourceContext | null;
}
