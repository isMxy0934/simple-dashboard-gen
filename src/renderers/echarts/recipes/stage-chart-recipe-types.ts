import type {
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  QueryOutputKind,
  QueryParamType,
} from "@/contracts";
import type { DashboardViewPresentationContext } from "@/presentation/dashboard/presentation-context";
export {
  ECHARTS_STAGE_CHART_RECIPE_IDS,
  type EChartsStageChartRecipeId,
} from "@/contracts/dashboard-chart-recipes";

export type EChartsStageChartFieldRole =
  | "time"
  | "category"
  | "metric"
  | "value"
  | "series";

export interface EChartsStageChartFieldMapping {
  source_field: string;
  result_field: string;
  label?: string;
  type?: QueryParamType;
  aggregation?: string;
}

export type EChartsStageChartFieldMappings = Partial<
  Record<EChartsStageChartFieldRole, EChartsStageChartFieldMapping>
>;

export interface EChartsStageChartRecipeInput {
  title: string;
  description?: string;
  fields: EChartsStageChartFieldMappings;
  presentation?: DashboardViewPresentationContext | null;
}

export interface EChartsStageChartSlotBindingTemplate {
  slot_id: string;
  field_role: EChartsStageChartFieldRole;
  value_kind: QueryOutputKind;
  required?: boolean;
  formatter?: DashboardRendererSlot["formatter"];
}

export interface EChartsStageChartRecipeOutput {
  renderer: DashboardRenderer;
  bindings: EChartsStageChartSlotBindingTemplate[];
  layout: {
    desktop: Pick<DashboardLayoutItem, "w" | "h">;
    mobile: Pick<DashboardLayoutItem, "w" | "h">;
  };
}

export type EChartsStageChartThemeInput = Pick<
  EChartsStageChartRecipeInput,
  "presentation"
>;

export function assertCategoryMetricFields(
  input: EChartsStageChartRecipeInput,
  recipeName: string,
): void {
  if (!input.fields.category) {
    throw new Error(`compiled ${recipeName} recipe requires fields.category`);
  }
  if (!input.fields.metric) {
    throw new Error(`compiled ${recipeName} recipe requires fields.metric`);
  }
}

export function rowsDatasetBinding(): EChartsStageChartSlotBindingTemplate[] {
  return [
    {
      slot_id: "rows",
      // Row-backed recipes still map through category/metric fields; the binding
      // selector returns whole rows so ECharts can encode both dimensions.
      field_role: "category",
      value_kind: "rows",
      required: true,
    },
  ];
}
