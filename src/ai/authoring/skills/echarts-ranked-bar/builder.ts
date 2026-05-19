import type { QueryDef } from "@/contracts";
import type { StageChartBuilder } from "@/ai/authoring/skills/contract";
import { buildCategoryMetricQueryDef } from "@/ai/authoring/skills/category-metric-query";
import { buildRegisteredStageChartRecipe } from "@/ai/authoring/skills/recipe-build";

export const echartsRankedBarBuilder: StageChartBuilder = {
  skillId: "echarts-ranked-bar",
  build(input) {
    return buildRegisteredStageChartRecipe("echarts-ranked-bar", input);
  },
  buildQueryDef(input): QueryDef | null {
    return buildCategoryMetricQueryDef(input, "ranked-bar");
  },
};
