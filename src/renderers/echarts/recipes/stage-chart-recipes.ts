import type {
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  QueryOutputKind,
  QueryParamType,
} from "@/contracts";

export type EChartsStageChartRecipeId =
  | "echarts-line"
  | "echarts-bar"
  | "echarts-kpi-text"
  | "echarts-kpi-gauge";

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

export function buildEChartsBarRecipe(): EChartsStageChartRecipeOutput {
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        color: ["#4e79a7", "#f28e2b"],
        grid: { left: 40, right: 20, top: 30, bottom: 36, containLabel: true },
        xAxis: { type: "category", data: [] },
        yAxis: { type: "value" },
        series: [{ type: "bar", data: [], barMaxWidth: 36 }],
      },
      slots: [
        { id: "category", path: "xAxis.data", value_kind: "array", required: true },
        { id: "value", path: "series[0].data", value_kind: "array", required: true },
      ],
    },
    bindings: [
      { slot_id: "category", field_role: "category", value_kind: "array", required: true },
      { slot_id: "value", field_role: "metric", value_kind: "array", required: true },
    ],
    layout: { desktop: { w: 6, h: 6 }, mobile: { w: 4, h: 6 } },
  };
}

export function buildEChartsLineRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  if (input.fields.series) {
    if (!input.fields.time || !input.fields.metric) {
      throw new Error("stageChart line with fields.series requires fields.time and fields.metric.");
    }

    return {
      renderer: {
        kind: "echarts",
        option_template: {
          tooltip: { trigger: "axis" },
          color: ["#4e79a7", "#f28e2b"],
          legend: {},
          grid: { left: 40, right: 20, top: 30, bottom: 36, containLabel: true },
          dataset: { source: [] },
          xAxis: { type: "category" },
          yAxis: { type: "value" },
          series: [],
        },
        slots: [
          {
            id: "dataset",
            path: "dataset.source",
            value_kind: "rows",
            required: true,
          },
        ],
        transforms: [
          {
            id: "pivot_dataset",
            kind: "pivot_rows",
            source_slot: "dataset",
            row_key: "time_value",
            column_key: "series_value",
            value_field: "metric_value",
            target_path: "dataset.source",
          },
          {
            id: "dynamic_series",
            kind: "generate_series",
            source_transform: "pivot_dataset",
            target_path: "series",
            series_type: "line",
            encode_x: "time_value",
            defaults: { smooth: true, showSymbol: false },
          },
        ],
      },
      bindings: [
        { slot_id: "dataset", field_role: "series", value_kind: "rows", required: true },
      ],
      layout: { desktop: { w: 8, h: 6 }, mobile: { w: 4, h: 6 } },
    };
  }

  return {
    renderer: {
      kind: "echarts",
      option_template: {
        tooltip: { trigger: "axis" },
        color: ["#4e79a7", "#f28e2b"],
        grid: { left: 40, right: 20, top: 30, bottom: 36, containLabel: true },
        xAxis: { type: "category", data: [] },
        yAxis: { type: "value" },
        series: [{ type: "line", data: [], smooth: true, showSymbol: false }],
      },
      slots: [
        { id: "time", path: "xAxis.data", value_kind: "array", required: true },
        { id: "value", path: "series[0].data", value_kind: "array", required: true },
      ],
    },
    bindings: [
      { slot_id: "time", field_role: "time", value_kind: "array", required: true },
      { slot_id: "value", field_role: "metric", value_kind: "array", required: true },
    ],
    layout: { desktop: { w: 8, h: 6 }, mobile: { w: 4, h: 6 } },
  };
}

export function buildEChartsKpiTextRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        graphic: [
          { type: "text", left: "center", top: "middle", style: { text: "0", fontSize: 36, fontWeight: 700, fill: "#111827", textAlign: "center" } },
          { type: "text", left: "center", top: "68%", style: { text: input.title, fontSize: 13, fill: "#6b7280", textAlign: "center" } },
        ],
      },
      slots: [{ id: "value", path: "graphic[0].style.text", value_kind: "scalar", required: true, formatter: "integer" }],
    },
    bindings: [{ slot_id: "value", field_role: "value", value_kind: "scalar", required: true, formatter: "integer" }],
    layout: { desktop: { w: 4, h: 3 }, mobile: { w: 4, h: 3 } },
  };
}

export function buildEChartsKpiGaugeRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        series: [{
          type: "gauge", min: 0, max: 100,
          progress: { show: true, width: 12 },
          axisLine: { lineStyle: { width: 12 } },
          axisTick: { show: false },
          splitLine: { length: 8, lineStyle: { width: 1 } },
          axisLabel: { distance: 16 },
          pointer: { width: 4 },
          detail: { valueAnimation: true, formatter: "{value}", fontSize: 24, color: "#111827" },
          title: { show: true, offsetCenter: [0, "72%"], color: "#6b7280", fontSize: 12 },
          data: [{ value: 0, name: input.title }],
        }],
      },
      slots: [{ id: "value", path: "series[0].data[0].value", value_kind: "scalar", required: true }],
    },
    bindings: [{ slot_id: "value", field_role: "value", value_kind: "scalar", required: true }],
    layout: { desktop: { w: 4, h: 4 }, mobile: { w: 4, h: 4 } },
  };
}
