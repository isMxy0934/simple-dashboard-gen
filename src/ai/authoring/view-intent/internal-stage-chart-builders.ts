import type {
  StageChartBuilder,
  StageChartSkillId,
} from "@/ai/authoring/skills/contract";
import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "@/contracts/dashboard-chart-recipes";
import { echartsBarBuilder } from "@/ai/authoring/skills/echarts-bar/builder";
import { echartsRankedBarBuilder } from "@/ai/authoring/skills/echarts-ranked-bar/builder";
import { echartsFunnelBuilder } from "@/ai/authoring/skills/echarts-funnel/builder";
import { echartsKpiCardBuilder } from "@/ai/authoring/skills/echarts-kpi-card/builder";
import { echartsKpiGaugeBuilder } from "@/ai/authoring/skills/echarts-kpi-gauge/builder";
import { echartsKpiTextBuilder } from "@/ai/authoring/skills/echarts-kpi-text/builder";
import { echartsLineBuilder } from "@/ai/authoring/skills/echarts-line/builder";
import { echartsSignalListBuilder } from "@/ai/authoring/skills/echarts-signal-list/builder";

// echarts-* recipe builders are renderer implementation internals used by the
// semantic view-intent compiler. They are not agent-visible skill metadata.
const INTERNAL_STAGE_CHART_BUILDERS_BY_ID = {
  "echarts-bar": echartsBarBuilder,
  "echarts-line": echartsLineBuilder,
  "echarts-kpi-card": echartsKpiCardBuilder,
  "echarts-kpi-text": echartsKpiTextBuilder,
  "echarts-kpi-gauge": echartsKpiGaugeBuilder,
  "echarts-signal-list": echartsSignalListBuilder,
  "echarts-funnel": echartsFunnelBuilder,
  "echarts-ranked-bar": echartsRankedBarBuilder,
} satisfies Record<StageChartSkillId, StageChartBuilder>;

function assertStageChartSkillRegistryComplete(): void {
  const missingRecipeIds = ECHARTS_STAGE_CHART_RECIPE_IDS.filter(
    (recipeId) => !INTERNAL_STAGE_CHART_BUILDERS_BY_ID[recipeId],
  );
  if (missingRecipeIds.length > 0) {
    throw new Error(
      `internal chart recipe registry is missing builders for: ${missingRecipeIds.join(", ")}`,
    );
  }
}

assertStageChartSkillRegistryComplete();

export function getInternalStageChartBuilder(skillId: string): StageChartBuilder | null {
  return INTERNAL_STAGE_CHART_BUILDERS_BY_ID[skillId as StageChartSkillId] ?? null;
}

export function listInternalStageChartSkillIds(): StageChartSkillId[] {
  return [...ECHARTS_STAGE_CHART_RECIPE_IDS];
}
