import type {
  StageChartBuilder,
  StageChartSkillId,
} from "@/ai/authoring/skills/contract";
import { echartsBarBuilder } from "@/ai/authoring/skills/echarts-bar/builder";
import { echartsKpiGaugeBuilder } from "@/ai/authoring/skills/echarts-kpi-gauge/builder";
import { echartsKpiTextBuilder } from "@/ai/authoring/skills/echarts-kpi-text/builder";
import { echartsLineBuilder } from "@/ai/authoring/skills/echarts-line/builder";

const STAGE_CHART_BUILDERS = [
  echartsBarBuilder,
  echartsKpiGaugeBuilder,
  echartsKpiTextBuilder,
  echartsLineBuilder,
] satisfies StageChartBuilder[];

export function getStageChartBuilder(skillId: string): StageChartBuilder | null {
  return STAGE_CHART_BUILDERS.find((builder) => builder.skillId === skillId) ?? null;
}

export function listStageChartSkillIds(): StageChartSkillId[] {
  return STAGE_CHART_BUILDERS.map((builder) => builder.skillId);
}
