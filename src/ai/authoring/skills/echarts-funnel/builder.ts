import type { QueryDef } from "@/contracts";
import type { StageChartBuilder } from "@/ai/authoring/skills/contract";
import { buildCategoryMetricQueryDef } from "@/ai/authoring/skills/category-metric-query";
import { buildEChartsFunnelRecipe } from "@/renderers/echarts/recipes/stage-chart-recipes";

export const echartsFunnelBuilder: StageChartBuilder = {
  skillId: "echarts-funnel",
  build(input) {
    return buildEChartsFunnelRecipe(input);
  },
  buildQueryDef(input): QueryDef | null {
    return buildCategoryMetricQueryDef(input, "funnel");
  },
};
