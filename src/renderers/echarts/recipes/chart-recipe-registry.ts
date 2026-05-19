import {
  ECHARTS_STAGE_CHART_RECIPE_IDS,
  type EChartsStageChartRecipeId,
  type EChartsStageChartRecipeInput,
  type EChartsStageChartRecipeOutput,
} from "@/renderers/echarts/recipes/stage-chart-recipe-types";
import {
  buildEChartsBarRecipe,
  buildEChartsKpiCardRecipe,
  buildEChartsKpiGaugeRecipe,
  buildEChartsKpiTextRecipe,
  buildEChartsLineRecipe,
} from "@/renderers/echarts/recipes/base-stage-chart-recipes";
import {
  buildEChartsFunnelRecipe,
  buildEChartsRankedBarRecipe,
  buildEChartsSignalListRecipe,
} from "@/renderers/echarts/recipes/category-metric-stage-chart-recipes";

export type EChartsStageChartRecipeBuilder = (
  input: EChartsStageChartRecipeInput,
) => EChartsStageChartRecipeOutput;

const LEGACY_ECHARTS_STAGE_CHART_RECIPE_ALIASES: Record<string, EChartsStageChartRecipeId> = {
  "echarts-data-table": "echarts-ranked-bar",
};

const ECHARTS_STAGE_CHART_RECIPE_BUILDERS = {
  "echarts-bar": buildEChartsBarRecipe,
  "echarts-line": buildEChartsLineRecipe,
  "echarts-kpi-card": buildEChartsKpiCardRecipe,
  "echarts-kpi-text": buildEChartsKpiTextRecipe,
  "echarts-kpi-gauge": buildEChartsKpiGaugeRecipe,
  "echarts-signal-list": buildEChartsSignalListRecipe,
  "echarts-funnel": buildEChartsFunnelRecipe,
  "echarts-ranked-bar": buildEChartsRankedBarRecipe,
} satisfies Record<EChartsStageChartRecipeId, EChartsStageChartRecipeBuilder>;

function assertEChartsStageChartRecipeRegistryComplete(): void {
  const missingRecipeIds = ECHARTS_STAGE_CHART_RECIPE_IDS.filter(
    (recipeId) => !ECHARTS_STAGE_CHART_RECIPE_BUILDERS[recipeId],
  );
  if (missingRecipeIds.length > 0) {
    throw new Error(
      `ECharts recipe registry is missing builders for: ${missingRecipeIds.join(", ")}`,
    );
  }
}

assertEChartsStageChartRecipeRegistryComplete();

export function getEChartsStageChartRecipeBuilder(
  recipeId: string,
): EChartsStageChartRecipeBuilder | null {
  const resolvedRecipeId =
    LEGACY_ECHARTS_STAGE_CHART_RECIPE_ALIASES[recipeId] ?? recipeId;
  return (
    ECHARTS_STAGE_CHART_RECIPE_BUILDERS[resolvedRecipeId as EChartsStageChartRecipeId] ??
    null
  );
}

export function buildEChartsStageChartRecipe(
  recipeId: EChartsStageChartRecipeId,
  input: EChartsStageChartRecipeInput,
): EChartsStageChartRecipeOutput {
  return ECHARTS_STAGE_CHART_RECIPE_BUILDERS[recipeId](input);
}

export function listEChartsStageChartRecipeIds(): EChartsStageChartRecipeId[] {
  return [...ECHARTS_STAGE_CHART_RECIPE_IDS];
}
