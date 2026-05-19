import { dashboardChartI18nRef } from "@/presentation/dashboard/chart-i18n";
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
  type EChartsGraphicElement,
  resolveRecipeTheme,
} from "@/renderers/echarts/recipes/dashboard-theme-preset";
import type {
  EChartsStageChartRecipeInput,
  EChartsStageChartRecipeOutput,
  EChartsStageChartThemeInput,
} from "@/renderers/echarts/recipes/stage-chart-recipe-types";

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
            name: dashboardChartI18nRef("series.actual"),
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
  const graphic: EChartsGraphicElement[] = [
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
