import type { QueryDef } from "@/contracts";
import type { StageChartBuilder } from "@/ai/authoring/skills/contract";
import { buildCategoryMetricQueryDef } from "@/ai/authoring/skills/category-metric-query";
import { buildRegisteredStageChartRecipe } from "@/ai/authoring/skills/recipe-build";

export const echartsSignalListBuilder: StageChartBuilder = {
  skillId: "echarts-signal-list",
  build(input) {
    return buildRegisteredStageChartRecipe("echarts-signal-list", input);
  },
  buildQueryDef(input): QueryDef | null {
    return buildCategoryMetricQueryDef(input, "signal-list");
  },
};
