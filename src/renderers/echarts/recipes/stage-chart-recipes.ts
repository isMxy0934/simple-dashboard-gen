import type {
  DashboardLayoutItem,
  DashboardRenderer,
  DashboardRendererSlot,
  QueryOutputKind,
  QueryParamType,
} from "@/contracts";
import { dashboardChartI18nRef } from "@/domain/dashboard/chart-i18n";
import {
  dashboardThemeBarSeries,
  dashboardThemeCategoryAxis,
  dashboardThemeChart,
  dashboardThemeGraphicText,
  dashboardThemeGrid,
  dashboardThemeLegend,
  dashboardThemeLineSeries,
  dashboardThemeTooltip,
  dashboardThemeValueAxis,
  resolveRecipeTheme,
} from "@/renderers/echarts/recipes/dashboard-theme-preset";

export type EChartsStageChartRecipeId =
  | "echarts-line"
  | "echarts-bar"
  | "echarts-kpi-text"
  | "echarts-kpi-gauge"
  | "echarts-kpi-card"
  | "echarts-signal-list"
  | "echarts-funnel"
  | "echarts-ranked-bar";

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
  themeId?: string | null;
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

type EChartsStageChartThemeInput = Pick<EChartsStageChartRecipeInput, "themeId">;

function assertCategoryMetricFields(
  input: EChartsStageChartRecipeInput,
  recipeName: string,
): void {
  if (!input.fields.category) {
    throw new Error(`stageChart ${recipeName} requires fields.category`);
  }
  if (!input.fields.metric) {
    throw new Error(`stageChart ${recipeName} requires fields.metric`);
  }
}

function rowsDatasetBinding(): EChartsStageChartSlotBindingTemplate[] {
  return [
    {
      slot_id: "rows",
      field_role: "category",
      value_kind: "rows",
      required: true,
    },
  ];
}

export function buildEChartsBarRecipe(
  input: EChartsStageChartThemeInput = {},
): EChartsStageChartRecipeOutput {
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        tooltip: dashboardThemeTooltip(theme, "axis"),
        color: [chart.primary, chart.forecast],
        grid: dashboardThemeGrid({ top: 26, bottom: 38 }),
        xAxis: dashboardThemeCategoryAxis(theme, { data: [] }),
        yAxis: dashboardThemeValueAxis(theme),
        series: [
          dashboardThemeBarSeries(theme, {
            data: [],
            name: "Actual",
          }),
        ],
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
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  if (input.fields.series && input.fields.time && input.fields.metric) {
    return {
      renderer: {
        kind: "echarts",
        option_template: {
          tooltip: dashboardThemeTooltip(theme, "axis"),
          color: chart.palette,
          legend: dashboardThemeLegend(theme),
          grid: dashboardThemeGrid({ top: 30, bottom: 52 }),
          dataset: { source: [] },
          xAxis: dashboardThemeCategoryAxis(theme),
          yAxis: dashboardThemeValueAxis(theme),
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
            defaults: {
              smooth: true,
              showSymbol: false,
              symbolSize: 5,
              lineStyle: { width: 2 },
            },
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
        tooltip: dashboardThemeTooltip(theme, "axis"),
        color: [chart.primary, chart.forecast],
        grid: dashboardThemeGrid({ top: 28, bottom: 38 }),
        xAxis: dashboardThemeCategoryAxis(theme, { data: [] }),
        yAxis: dashboardThemeValueAxis(theme),
        series: [
          dashboardThemeLineSeries(theme, {
            data: [],
            areaStyle: {
              color: chart.primarySoft,
            },
          }),
        ],
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
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        graphic: [
          dashboardThemeGraphicText(theme, input.title, {
            fill: chart.muted,
            fontSize: 12,
            fontWeight: 600,
          }, { left: 18, top: 18 }),
          dashboardThemeGraphicText(theme, "0", {
            fill: chart.text,
            fontSize: 34,
            fontWeight: 700,
            lineHeight: 40,
          }, { left: 18, top: "38%" }),
          dashboardThemeGraphicText(theme, input.description ?? "", {
            fill: chart.muted,
            fontSize: 12,
            lineHeight: 18,
          }, { left: 18, top: "70%" }),
        ],
      },
      slots: [
        {
          id: "value",
          path: "graphic[1].style.text",
          value_kind: "scalar",
          required: true,
          formatter: "integer",
        },
      ],
    },
    bindings: [
      {
        slot_id: "value",
        field_role: "value",
        value_kind: "scalar",
        required: true,
        formatter: "integer",
      },
    ],
    layout: { desktop: { w: 3, h: 3 }, mobile: { w: 4, h: 3 } },
  };
}

export function buildEChartsKpiGaugeRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        color: [chart.current, chart.primary],
        series: [{
          type: "gauge",
          min: 0,
          max: 100,
          startAngle: 210,
          endAngle: -30,
          progress: {
            show: true,
            width: 12,
            itemStyle: { color: chart.current },
          },
          axisLine: {
            lineStyle: {
              width: 12,
              color: [[1, chart.track]],
            },
          },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: {
            length: "58%",
            width: 4,
            itemStyle: { color: chart.text },
          },
          detail: {
            valueAnimation: true,
            formatter: "{value}",
            fontSize: 24,
            fontWeight: 700,
            color: chart.text,
            offsetCenter: [0, "32%"],
          },
          title: {
            show: true,
            offsetCenter: [0, "72%"],
            color: chart.muted,
            fontSize: 12,
            fontWeight: 600,
          },
          data: [{ value: 0, name: input.title }],
        }],
      },
      slots: [
        {
          id: "value",
          path: "series[0].data[0].value",
          value_kind: "scalar",
          required: true,
        },
      ],
    },
    bindings: [
      { slot_id: "value", field_role: "value", value_kind: "scalar", required: true },
    ],
    layout: { desktop: { w: 4, h: 4 }, mobile: { w: 4, h: 4 } },
  };
}

export function buildEChartsKpiCardRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  const description = input.description?.trim();
  const graphic = [
    dashboardThemeGraphicText(theme, input.title, {
      fill: chart.muted,
      fontSize: 12,
      fontWeight: 700,
    }, { left: 22, top: 18 }),
    dashboardThemeGraphicText(theme, "0", {
      fill: chart.text,
      fontSize: 30,
      fontWeight: 700,
      lineHeight: 38,
    }, { left: 22, top: 42 }),
    ...(description
      ? [
          dashboardThemeGraphicText(theme, description, {
            fill: chart.muted,
            fontSize: 12,
            lineHeight: 17,
          }, { left: 22, top: 86 }),
        ]
      : []),
    {
      type: "rect",
      right: 18,
      top: 20,
      shape: { width: 58, height: 24, r: 12 },
      style: {
        fill: chart.currentSoft,
      },
    },
    dashboardThemeGraphicText(theme, dashboardChartI18nRef("kpiCard.badgeLive"), {
      fill: chart.current,
      fontSize: 11,
      fontWeight: 700,
      align: "center",
    }, { right: 34, top: 23 }),
  ];
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        graphic,
      },
      slots: [
        {
          id: "value",
          path: "graphic[1].style.text",
          value_kind: "scalar",
          required: true,
          formatter: "integer",
        },
      ],
    },
    bindings: [
      {
        slot_id: "value",
        field_role: "value",
        value_kind: "scalar",
        required: true,
        formatter: "integer",
      },
    ],
    layout: { desktop: { w: 3, h: 3 }, mobile: { w: 4, h: 3 } },
  };
}

export function buildEChartsSignalListRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  assertCategoryMetricFields(input, "signal-list");
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        dataset: { source: [] },
        tooltip: dashboardThemeTooltip(theme, "axis"),
        color: [chart.current],
        grid: dashboardThemeGrid({ left: 8, right: 54, top: 18, bottom: 18 }),
        xAxis: dashboardThemeValueAxis(theme, { show: false }),
        yAxis: dashboardThemeCategoryAxis(theme, {
          type: "category",
          inverse: true,
          axisLine: { show: false },
          axisLabel: {
            color: chart.text,
            fontSize: 12,
            fontWeight: 650,
            margin: 12,
          },
        }),
        series: [
          dashboardThemeBarSeries(theme, {
            name: input.title,
            encode: { x: "metric_value", y: "category_name" },
            barMaxWidth: 22,
            itemStyle: {
              color: chart.current,
              borderRadius: [0, 6, 6, 0],
            },
            label: {
              show: true,
              position: "right",
              color: chart.muted,
              fontSize: 11,
            },
          }),
        ],
      },
      slots: [
        {
          id: "rows",
          path: "dataset.source",
          value_kind: "rows",
          required: true,
        },
      ],
    },
    bindings: rowsDatasetBinding(),
    layout: { desktop: { w: 4, h: 6 }, mobile: { w: 4, h: 6 } },
  };
}

export function buildEChartsFunnelRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  assertCategoryMetricFields(input, "funnel");
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        dataset: { source: [] },
        tooltip: dashboardThemeTooltip(theme, "item"),
        color: [
          chart.current,
          chart.primary,
          chart.success,
          chart.forecast,
        ],
        series: [
          {
            type: "funnel",
            top: 18,
            left: 28,
            right: 28,
            bottom: 18,
            minSize: "22%",
            maxSize: "92%",
            sort: "descending",
            gap: 6,
            encode: {
              itemName: "category_name",
              value: "metric_value",
            },
            label: {
              show: true,
              position: "inside",
              color: chart.onAccent,
              fontSize: 12,
              fontWeight: 700,
            },
            labelLine: { show: false },
            itemStyle: {
              borderColor: chart.onAccent,
              borderWidth: 1,
            },
          },
        ],
      },
      slots: [
        {
          id: "rows",
          path: "dataset.source",
          value_kind: "rows",
          required: true,
        },
      ],
    },
    bindings: rowsDatasetBinding(),
    layout: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
  };
}

export function buildEChartsRankedBarRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  assertCategoryMetricFields(input, "ranked-bar");
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);
  return {
    renderer: {
      kind: "echarts",
      option_template: {
        dataset: { source: [] },
        tooltip: dashboardThemeTooltip(theme, "axis"),
        color: [chart.primary],
        grid: dashboardThemeGrid({ left: 10, right: 74, top: 16, bottom: 16 }),
        xAxis: dashboardThemeValueAxis(theme, { show: false }),
        yAxis: dashboardThemeCategoryAxis(theme, {
          inverse: true,
          axisLine: { show: false },
          axisLabel: {
            color: chart.text,
            fontSize: 12,
            fontWeight: 600,
            margin: 14,
          },
        }),
        series: [
          dashboardThemeBarSeries(theme, {
            name: input.title,
            encode: { x: "metric_value", y: "category_name" },
            barMaxWidth: 18,
            itemStyle: {
              color: chart.primary,
              borderRadius: [0, 6, 6, 0],
            },
            label: {
              show: true,
              position: "right",
              color: chart.text,
              fontSize: 12,
              fontWeight: 650,
            },
          }),
        ],
      },
      slots: [
        {
          id: "rows",
          path: "dataset.source",
          value_kind: "rows",
          required: true,
        },
      ],
    },
    bindings: rowsDatasetBinding(),
    layout: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
  };
}
