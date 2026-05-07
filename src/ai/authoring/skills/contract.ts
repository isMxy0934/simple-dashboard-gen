import type {
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  QueryDef,
  QueryOutputKind,
  QueryParamType,
} from "@/contracts";

export type StageChartSkillId =
  | "echarts-line"
  | "echarts-bar"
  | "echarts-kpi-text"
  | "echarts-kpi-gauge";

export type StageChartFieldRole =
  | "time"
  | "category"
  | "metric"
  | "value";

export interface StageChartFieldMapping {
  source_field: string;
  result_field: string;
  label?: string;
  type?: QueryParamType;
  aggregation?: string;
}

export type StageChartFieldMappings = Partial<
  Record<StageChartFieldRole, StageChartFieldMapping>
>;

export interface StageChartBuilderInput {
  title: string;
  description?: string;
  queryOutput: QueryDef["output"] | null;
  fields: StageChartFieldMappings;
}

export interface StageChartSlotBindingTemplate {
  slot_id: string;
  field_role: StageChartFieldRole;
  value_kind: QueryOutputKind;
  required?: boolean;
  formatter?: DashboardRendererSlot["formatter"];
}

export interface StageChartLayoutTemplate {
  desktop: Pick<DashboardLayoutItem, "w" | "h">;
  mobile: Pick<DashboardLayoutItem, "w" | "h">;
}

export interface StageChartBuilderOutput {
  renderer: DashboardRenderer;
  bindings: StageChartSlotBindingTemplate[];
  layout: StageChartLayoutTemplate;
}

export interface StageChartBuilder {
  skillId: StageChartSkillId;
  build(input: StageChartBuilderInput): StageChartBuilderOutput;
}
