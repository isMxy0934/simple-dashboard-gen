import type {
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  QueryDef,
  QueryOutputKind,
  QueryParamType,
} from "@/contracts";
import type { StageChartFieldRole } from "@/ai/authoring/contracts/tool-io";

export type { StageChartFieldRole };

export type StageChartSkillId =
  | "echarts-line"
  | "echarts-bar"
  | "echarts-kpi-text"
  | "echarts-kpi-gauge"
  | "echarts-kpi-card"
  | "echarts-signal-list"
  | "echarts-funnel"
  | "echarts-ranked-bar";

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
  themeId?: string | null;
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

export interface StageChartSqlInput {
  queryId: string;
  title: string;
  datasourceId: string;
  tableName: string;
  whereClause: string;
  fields: StageChartFieldMappings;
  sort?: { field_role?: StageChartFieldRole; direction?: "asc" | "desc" };
  timeGrain?: "day" | "week" | "month";
  limit?: number;
  schema: { dialect: string };
}

export interface StageChartBuilder {
  skillId: StageChartSkillId;
  build(input: StageChartBuilderInput): StageChartBuilderOutput;
  buildQueryDef?(input: StageChartSqlInput): QueryDef | null;
}
