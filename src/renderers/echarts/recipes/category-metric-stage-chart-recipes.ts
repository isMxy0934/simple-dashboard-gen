import type { JsonObject } from "@/contracts";
import {
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
} from "@/contracts/dashboard-presentation";
import {
  dashboardThemeBarSeries,
  dashboardThemeCategoryAxis,
  dashboardThemeChart,
  dashboardThemeGrid,
  dashboardThemeTooltip,
  dashboardThemeValueAxis,
  resolveRecipeTheme,
  resolveRecipeViewStyleId,
} from "@/renderers/echarts/recipes/dashboard-theme-preset";
import {
  assertCategoryMetricFields,
  rowsDatasetBinding,
  type EChartsStageChartRecipeInput,
  type EChartsStageChartRecipeOutput,
} from "@/renderers/echarts/recipes/stage-chart-recipe-types";

type CategoryMetricTheme = ReturnType<typeof resolveRecipeTheme>;
type CategoryMetricChart = ReturnType<typeof dashboardThemeChart>;

interface CategoryMetricChartRecipeConfig {
  recipeName: string;
  recipeId: EChartsStageChartRecipeOutput["renderer"]["recipe_id"];
  layout: EChartsStageChartRecipeOutput["layout"];
  buildOptionTemplate(input: {
    input: EChartsStageChartRecipeInput;
    theme: CategoryMetricTheme;
    chart: CategoryMetricChart;
    styleId: ReturnType<typeof resolveRecipeViewStyleId>;
  }): JsonObject;
}

function buildCategoryMetricChartRecipe(
  input: EChartsStageChartRecipeInput,
  config: CategoryMetricChartRecipeConfig,
): EChartsStageChartRecipeOutput {
  assertCategoryMetricFields(input, config.recipeName);
  const theme = resolveRecipeTheme(input.presentation);
  const styleId = resolveRecipeViewStyleId(input.presentation);
  const chart = dashboardThemeChart(theme);

  return {
    renderer: {
      kind: "echarts",
      recipe_id: config.recipeId,
      option_template: {
        dataset: { source: [] },
        ...config.buildOptionTemplate({ input, theme, chart, styleId }),
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
    layout: config.layout,
  };
}

export function buildEChartsSignalListRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return buildCategoryMetricChartRecipe(input, {
    recipeName: "signal-list",
    recipeId: "echarts-signal-list",
    layout: { desktop: { w: 4, h: 6 }, mobile: { w: 4, h: 6 } },
    buildOptionTemplate: ({ input: recipeInput, theme, chart, styleId }) => ({
      tooltip: dashboardThemeTooltip(theme, "axis"),
      color: [chart.current],
      grid: dashboardThemeGrid({
        left: 8,
        right:
          styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
            ? 48
            : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
              ? 60
              : 68,
        top: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 18 : 20,
        bottom: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 18 : 20,
      }),
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
        dashboardThemeBarSeries(theme, styleId, {
          name: recipeInput.title,
          encode: { x: "metric_value", y: "category_name" },
          barMaxWidth:
            styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
              ? 16
              : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
                ? 20
                : 24,
          showBackground: styleId !== DASHBOARD_VIEW_STYLE_ID_CLEAN,
          backgroundStyle: {
            color: chart.track,
            borderRadius: [0, 8, 8, 0],
          },
          itemStyle: {
            color: chart.current,
            borderRadius:
              styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
                ? [0, 4, 4, 0]
                : [0, 8, 8, 0],
          },
          label: {
            show: true,
            position: "right",
            color:
              styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
                ? chart.text
                : chart.muted,
            fontSize: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 11 : 12,
            fontWeight: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 650 : 500,
          },
        }),
      ],
    }),
  });
}

export function buildEChartsFunnelRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return buildCategoryMetricChartRecipe(input, {
    recipeName: "funnel",
    recipeId: "echarts-funnel",
    layout: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
    buildOptionTemplate: ({ chart, theme, styleId }) => ({
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
          gap:
            styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
              ? 4
              : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
                ? 6
                : 8,
          encode: {
            itemName: "category_name",
            value: "metric_value",
          },
          label: {
            show: true,
            position: "inside",
            color: chart.onAccent,
            fontSize: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 13 : 12,
            fontWeight: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 600 : 750,
          },
          labelLine: { show: false },
          itemStyle: {
            borderColor: chart.onAccent,
            borderWidth: 1,
            shadowBlur:
              styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS
                ? 12
                : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
                  ? 7
                  : 0,
            shadowColor:
              styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? undefined : chart.currentSoft,
          },
        },
      ],
    }),
  });
}

export function buildEChartsRankedBarRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return buildCategoryMetricChartRecipe(input, {
    recipeName: "ranked-bar",
    recipeId: "echarts-ranked-bar",
    layout: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
    buildOptionTemplate: ({ input: recipeInput, theme, chart, styleId }) => ({
      tooltip: dashboardThemeTooltip(theme, "axis"),
      color: [chart.primary],
      grid: dashboardThemeGrid({
        left: 10,
        right:
          styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
            ? 66
            : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
              ? 76
              : 84,
        top: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 16 : 18,
        bottom: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 16 : 18,
      }),
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
        dashboardThemeBarSeries(theme, styleId, {
          name: recipeInput.title,
          encode: { x: "metric_value", y: "category_name" },
          barMaxWidth:
            styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
              ? 14
              : styleId === DASHBOARD_VIEW_STYLE_ID_GRADIENT
                ? 18
                : 22,
          showBackground: styleId !== DASHBOARD_VIEW_STYLE_ID_CLEAN,
          backgroundStyle: {
            color: chart.track,
            borderRadius: [0, 8, 8, 0],
          },
          itemStyle: {
            color: chart.primary,
            borderRadius:
              styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN
                ? [0, 4, 4, 0]
                : [0, 8, 8, 0],
          },
          label: {
            show: true,
            position: "right",
            color: chart.text,
            fontSize: styleId === DASHBOARD_VIEW_STYLE_ID_CLEAN ? 11 : 12,
            fontWeight: styleId === DASHBOARD_VIEW_STYLE_ID_EMPHASIS ? 700 : 620,
          },
        }),
      ],
    }),
  });
}
