import type {
  StageChartBuilder,
  StageChartSkillId,
} from "@/ai/authoring/skills/contract";
import { echartsBarBuilder } from "@/ai/authoring/skills/echarts-bar/builder";
import { echartsRankedBarBuilder } from "@/ai/authoring/skills/echarts-ranked-bar/builder";
import { echartsFunnelBuilder } from "@/ai/authoring/skills/echarts-funnel/builder";
import { echartsKpiCardBuilder } from "@/ai/authoring/skills/echarts-kpi-card/builder";
import { echartsKpiGaugeBuilder } from "@/ai/authoring/skills/echarts-kpi-gauge/builder";
import { echartsKpiTextBuilder } from "@/ai/authoring/skills/echarts-kpi-text/builder";
import { echartsLineBuilder } from "@/ai/authoring/skills/echarts-line/builder";
import { echartsSignalListBuilder } from "@/ai/authoring/skills/echarts-signal-list/builder";

const LEGACY_STAGE_CHART_SKILL_ALIASES: Record<string, StageChartSkillId> = {
  "echarts-data-table": "echarts-ranked-bar",
};

const STAGE_CHART_BUILDERS = [
  echartsBarBuilder,
  echartsRankedBarBuilder,
  echartsFunnelBuilder,
  echartsKpiCardBuilder,
  echartsKpiGaugeBuilder,
  echartsKpiTextBuilder,
  echartsLineBuilder,
  echartsSignalListBuilder,
] satisfies StageChartBuilder[];

export function getStageChartBuilder(skillId: string): StageChartBuilder | null {
  const resolvedSkillId = LEGACY_STAGE_CHART_SKILL_ALIASES[skillId] ?? skillId;
  return (
    STAGE_CHART_BUILDERS.find((builder) => builder.skillId === resolvedSkillId) ?? null
  );
}

export function listStageChartSkillIds(): StageChartSkillId[] {
  return STAGE_CHART_BUILDERS.map((builder) => builder.skillId);
}
