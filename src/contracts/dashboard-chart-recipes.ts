export const ECHARTS_STAGE_CHART_RECIPE_IDS = [
  "echarts-bar",
  "echarts-line",
  "echarts-kpi-card",
  "echarts-kpi-text",
  "echarts-kpi-gauge",
  "echarts-signal-list",
  "echarts-funnel",
  "echarts-ranked-bar",
] as const;

export type EChartsStageChartRecipeId =
  (typeof ECHARTS_STAGE_CHART_RECIPE_IDS)[number];
