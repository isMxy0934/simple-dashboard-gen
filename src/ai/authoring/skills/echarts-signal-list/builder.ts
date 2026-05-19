import type { QueryDef } from "@/contracts";
import type { StageChartBuilder } from "@/ai/authoring/skills/contract";
import { buildCategoryMetricQueryDef } from "@/ai/authoring/skills/category-metric-query";
import { buildEChartsSignalListRecipe } from "@/renderers/echarts/recipes/stage-chart-recipes";

export const echartsSignalListBuilder: StageChartBuilder = {
  skillId: "echarts-signal-list",
  build(input) {
    return buildEChartsSignalListRecipe(input);
  },
  buildQueryDef(input): QueryDef | null {
    return buildCategoryMetricQueryDef(input, "signal-list");
  },
};
