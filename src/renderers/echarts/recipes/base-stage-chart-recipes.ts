import { dashboardChartI18nRef } from "@/presentation/dashboard/chart-i18n";
import {
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
} from "@/contracts/dashboard-presentation";
import {
  dashboardThemeBarSeries,
  dashboardThemeCategoryAxis,
  dashboardThemeChart,
  dashboardThemeGraphicText,
  dashboardReportGrid,
  dashboardThemeLegend,
  dashboardThemeLineSeries,
  dashboardThemeTooltip,
  dashboardThemeValueAxis,
  type EChartsGraphicElement,
  isExecutiveReportTheme,
  resolveRecipeTheme,
  resolveRecipeViewStyleId,
} from "@/renderers/echarts/recipes/dashboard-theme-preset";
import type {
  EChartsStageChartRecipeInput,
  EChartsStageChartRecipeOutput,
  EChartsStageChartThemeInput,
} from "@/renderers/echarts/recipes/stage-chart-recipe-types";

export function buildEChartsBarRecipe(
  input: EChartsStageChartThemeInput = {},
): EChartsStageChartRecipeOutput {
  const theme = resolveRecipeTheme(input.presentation);
  const styleId = resolveRecipeViewStyleId(input.presentation);
  const chart = dashboardThemeChart(theme);
  return {
    renderer: {
      kind: "echarts",
      recipe_id: "echarts-bar",
      option_template: {
        tooltip: dashboardThemeTooltip(theme, "axis"),
        color: [chart.primary, chart.forecast],
        grid: dashboardReportGrid(theme, {
          top: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 24 : 28,
          bottom: 38,
        }),
        xAxis: dashboardThemeCategoryAxis(theme, { data: [] }),
        yAxis: dashboardThemeValueAxis(theme),
        series: [
          dashboardThemeBarSeries(theme, styleId, {
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
  const theme = resolveRecipeTheme(input.presentation);
  const styleId = resolveRecipeViewStyleId(input.presentation);
  const chart = dashboardThemeChart(theme);
  if (input.fields.series && input.fields.time && input.fields.metric) {
    return {
      renderer: {
        kind: "echarts",
        recipe_id: "echarts-line",
        option_template: {
          tooltip: dashboardThemeTooltip(theme, "axis"),
          color: chart.palette,
          legend: dashboardThemeLegend(theme),
          grid: dashboardReportGrid(theme, { top: 30, bottom: 52 }),
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
              showSymbol: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
              symbolSize: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 6 : 4,
              lineStyle: { width: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 2 : 3 },
              areaStyle:
                styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
                  ? undefined
                  : { color: chart.primarySoft },
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
      recipe_id: "echarts-line",
      option_template: {
        tooltip: dashboardThemeTooltip(theme, "axis"),
        color: [chart.primary, chart.forecast],
        grid: dashboardReportGrid(theme, {
          top: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 30 : 26,
          bottom: 38,
        }),
        xAxis: dashboardThemeCategoryAxis(theme, { data: [] }),
        yAxis: dashboardThemeValueAxis(theme),
        series: [
          dashboardThemeLineSeries(theme, styleId, {
            data: [],
            areaStyle:
              styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
                ? undefined
                : { color: chart.primarySoft },
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
  return buildEChartsKpiCardRecipe(input);
}

export function buildEChartsKpiGaugeRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  const theme = resolveRecipeTheme(input.presentation);
  const styleId = resolveRecipeViewStyleId(input.presentation);
  const chart = dashboardThemeChart(theme);
  const gaugeWidth =
    styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
      ? 9
      : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
        ? 12
        : 14;
  return {
    renderer: {
      kind: "echarts",
      recipe_id: "echarts-kpi-gauge",
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
            width: gaugeWidth,
            roundCap: styleId !== DASHBOARD_VIEW_STYLE_ID_CLEAN,
            itemStyle: {
              color:
                styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
                  ? chart.primary
                  : chart.current,
              shadowBlur: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 10 : 0,
              shadowColor:
                styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
                  ? chart.currentSoft
                  : undefined,
            },
          },
          axisLine: {
            lineStyle: {
              width: gaugeWidth,
              color: [[1, chart.track]],
            },
          },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: {
            length: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? "50%" : "58%",
            width: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 3 : 4,
            itemStyle: { color: chart.text },
          },
          detail: {
            valueAnimation: true,
            formatter: "{value}",
            fontSize: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 26 : 23,
            fontWeight: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 650 : 750,
            color: chart.text,
            offsetCenter: [0, "32%"],
          },
          title: {
            show: false,
            offsetCenter: [0, "72%"],
            color: chart.muted,
            fontSize: 12,
            fontWeight: 600,
          },
          data: [{ value: 0, name: dashboardChartI18nRef("series.actual") }],
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

const KPI_MONO_FONT = "IBM Plex Mono, SF Mono, Consolas, monospace";

export function buildEChartsKpiCardRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  const theme = resolveRecipeTheme(input.presentation);
  const styleId = resolveRecipeViewStyleId(input.presentation);
  const chart = dashboardThemeChart(theme);
  if (isExecutiveReportTheme(theme)) {
    return {
      renderer: {
        kind: "echarts",
        recipe_id: "echarts-kpi-card",
        option_template: {
          graphic: [
            dashboardThemeGraphicText(theme, "0", {
              fill: chart.text,
              fontSize: 38,
              fontWeight: 760,
              lineHeight: 44,
              fontFamily: KPI_MONO_FONT,
            }, { left: 24, top: 8 }),
          ],
        },
        slots: [
          {
            id: "value",
            path: "graphic[0].style.text",
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
      layout: { desktop: { w: 3, h: 2 }, mobile: { w: 4, h: 2 } },
    };
  }
  const graphic: EChartsGraphicElement[] = [
    // index 0: full-width accent bar anchored to the top edge of the card
    {
      type: "rect",
      left: 0,
      top: 0,
      shape: { width: 9999, height: 3 },
      style: { fill: chart.current },
    },
    // index 1: primary value - slot target. Card chrome owns title, description, and status.
    dashboardThemeGraphicText(theme, "0", {
      fill: chart.text,
      fontSize:
        styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
          ? 30
          : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? 34
            : 36,
      fontWeight: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 650 : 760,
      lineHeight: 38,
      fontFamily: KPI_MONO_FONT,
    }, { left: 22, top: 18 }),
  ];
  if (styleId !== DASHBOARD_VIEW_STYLE_ID_CLEAN) {
    graphic.push({
      type: "rect",
      left: 22,
      bottom: 18,
      shape: {
        width: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 72 : 52,
        height: 4,
        r: 2,
      },
      style: {
        fill:
          styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
            ? chart.primarySoft
            : chart.current,
      },
    });
  }
  return {
    renderer: {
      kind: "echarts",
      recipe_id: "echarts-kpi-card",
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
