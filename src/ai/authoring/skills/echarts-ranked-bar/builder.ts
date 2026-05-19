import type { QueryDef } from "@/contracts";
import type { StageChartBuilder } from "@/ai/authoring/skills/contract";
import { buildCategoryMetricQueryDef } from "@/ai/authoring/skills/category-metric-query";
import { buildEChartsRankedBarRecipe } from "@/renderers/echarts/recipes/stage-chart-recipes";

export const echartsRankedBarBuilder: StageChartBuilder = {
  skillId: "echarts-ranked-bar",
  build(input) {
    return buildEChartsRankedBarRecipe(input);
  },
  buildQueryDef(input): QueryDef | null {
    return buildCategoryMetricQueryDef(input, "ranked-bar");
  },
};
