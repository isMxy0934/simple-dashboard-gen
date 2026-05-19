import type { JsonObject } from "@/contracts";
import {
  dashboardThemeBarSeries,
  dashboardThemeCategoryAxis,
  dashboardThemeChart,
  dashboardThemeGrid,
  dashboardThemeTooltip,
  dashboardThemeValueAxis,
  resolveRecipeTheme,
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
  layout: EChartsStageChartRecipeOutput["layout"];
  buildOptionTemplate(input: {
    input: EChartsStageChartRecipeInput;
    theme: CategoryMetricTheme;
    chart: CategoryMetricChart;
  }): JsonObject;
}

function buildCategoryMetricChartRecipe(
  input: EChartsStageChartRecipeInput,
  config: CategoryMetricChartRecipeConfig,
): EChartsStageChartRecipeOutput {
  assertCategoryMetricFields(input, config.recipeName);
  const theme = resolveRecipeTheme(input.themeId);
  const chart = dashboardThemeChart(theme);

  return {
    renderer: {
      kind: "echarts",
      option_template: {
        dataset: { source: [] },
        ...config.buildOptionTemplate({ input, theme, chart }),
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
    layout: { desktop: { w: 4, h: 6 }, mobile: { w: 4, h: 6 } },
    buildOptionTemplate: ({ input: recipeInput, theme, chart }) => ({
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
          name: recipeInput.title,
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
    }),
  });
}

export function buildEChartsFunnelRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return buildCategoryMetricChartRecipe(input, {
    recipeName: "funnel",
    layout: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
    buildOptionTemplate: ({ chart, theme }) => ({
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
    }),
  });
}

export function buildEChartsRankedBarRecipe(
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return buildCategoryMetricChartRecipe(input, {
    recipeName: "ranked-bar",
    layout: { desktop: { w: 6, h: 5 }, mobile: { w: 4, h: 5 } },
    buildOptionTemplate: ({ input: recipeInput, theme, chart }) => ({
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
          name: recipeInput.title,
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
    }),
  });
}
