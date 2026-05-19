import type { QueryDef } from "@/contracts";
import type { StageChartBuilder } from "@/ai/authoring/skills/contract";
import { buildCategoryMetricQueryDef } from "@/ai/authoring/skills/category-metric-query";
import { buildRegisteredStageChartRecipe } from "@/ai/authoring/skills/recipe-build";

export const echartsFunnelBuilder: StageChartBuilder = {
  skillId: "echarts-funnel",
  build(input) {
    return buildRegisteredStageChartRecipe("echarts-funnel", input);
  },
  buildQueryDef(input): QueryDef | null {
    return buildCategoryMetricQueryDef(input, "funnel");
  },
};
