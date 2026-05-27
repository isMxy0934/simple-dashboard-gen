import type { Binding, QueryParamType } from "./dashboard";
import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";

export const DASHBOARD_VIEW_KIND_IDS = [
  "stat_kpi",
  "time_trend",
  "category_comparison",
  "ranked_bar",
  "signal_list",
  "funnel",
  "bounded_gauge",
] as const;

export type DashboardViewKind = (typeof DASHBOARD_VIEW_KIND_IDS)[number];

export type DashboardViewIntentDataMode = "live" | "mock";

export type DashboardViewIntentFieldRole =
  | "value"
  | "time"
  | "category"
  | "metric"
  | "series";

export interface DashboardViewIntentField {
  source_field: string;
  label?: string;
  type?: QueryParamType;
  aggregation?: string;
  time_grain?: "day" | "week" | "month";
}

export interface DashboardViewIntentFilter {
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
  value: string | number | boolean;
}

export interface DashboardViewIntent {
  view_kind: DashboardViewKind;
  datasource_id: string;
  table: string;
  data_mode: DashboardViewIntentDataMode;
  fields: Partial<Record<DashboardViewIntentFieldRole, DashboardViewIntentField>>;
  sort?: {
    field_role?: DashboardViewIntentFieldRole;
    direction?: "asc" | "desc";
  };
  limit?: number;
  filters?: DashboardViewIntentFilter[];
  mock_data?: Binding["mock_data"];
  mock_value?: Binding["mock_value"];
}

const DASHBOARD_VIEW_KIND_BY_RECIPE_ID = {
  "echarts-bar": "category_comparison",
  "echarts-line": "time_trend",
  "echarts-kpi-card": "stat_kpi",
  "echarts-kpi-text": "stat_kpi",
  "echarts-kpi-gauge": "bounded_gauge",
  "echarts-signal-list": "signal_list",
  "echarts-funnel": "funnel",
  "echarts-ranked-bar": "ranked_bar",
} as const satisfies Record<EChartsStageChartRecipeId, DashboardViewKind>;

export function isDashboardViewKind(value: string): value is DashboardViewKind {
  return (DASHBOARD_VIEW_KIND_IDS as readonly string[]).includes(value);
}

export function getDashboardViewKindForRecipe(
  recipeId: EChartsStageChartRecipeId,
): DashboardViewKind {
  return DASHBOARD_VIEW_KIND_BY_RECIPE_ID[recipeId];
}

function sanitizeDashboardViewIntentField(
  field: DashboardViewIntentField,
): DashboardViewIntentField {
  return {
    source_field: field.source_field,
    ...(field.label !== undefined ? { label: field.label } : {}),
    ...(field.type !== undefined ? { type: field.type } : {}),
    ...(field.aggregation !== undefined ? { aggregation: field.aggregation } : {}),
    ...(field.time_grain !== undefined ? { time_grain: field.time_grain } : {}),
  };
}

function sanitizeDashboardViewIntentFields(
  fields: Partial<Record<DashboardViewIntentFieldRole, DashboardViewIntentField>>,
): DashboardViewIntent["fields"] {
  const sanitized: DashboardViewIntent["fields"] = {};
  for (const role of ["value", "time", "category", "metric", "series"] as const) {
    const field = fields[role];
    if (field) {
      sanitized[role] = sanitizeDashboardViewIntentField(field);
    }
  }
  return sanitized;
}

export function createTemporaryDashboardViewIntentForRecipe(input: {
  recipe_id: EChartsStageChartRecipeId;
  datasource_id?: string;
  table?: string;
  data_mode?: DashboardViewIntentDataMode;
  fields?: Partial<Record<DashboardViewIntentFieldRole, DashboardViewIntentField>>;
  sort?: DashboardViewIntent["sort"];
  limit?: number;
  filters?: DashboardViewIntentFilter[];
  mock_data?: Binding["mock_data"];
  mock_value?: Binding["mock_value"];
  time_grain?: DashboardViewIntentField["time_grain"];
}): DashboardViewIntent {
  const fields = sanitizeDashboardViewIntentFields(input.fields ?? {});
  if (input.time_grain && fields.time) {
    fields.time = {
      ...fields.time,
      time_grain: input.time_grain,
    };
  }

  return {
    view_kind: getDashboardViewKindForRecipe(input.recipe_id),
    datasource_id: input.datasource_id?.trim() || "__unassigned_datasource__",
    table: input.table?.trim() || "__unassigned_table__",
    data_mode: input.data_mode ?? "live",
    fields,
    ...(input.sort ? { sort: input.sort } : {}),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    ...(input.filters ? { filters: input.filters } : {}),
    ...(input.mock_data ? { mock_data: input.mock_data } : {}),
    ...(input.mock_value !== undefined ? { mock_value: input.mock_value } : {}),
  };
}
