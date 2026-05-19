import type {
  StageChartBuilderInput,
  StageChartBuilderOutput,
  StageChartSkillId,
} from "@/ai/authoring/skills/contract";
import { buildEChartsStageChartRecipe } from "@/renderers/echarts/recipes/chart-recipe-registry";

export function buildRegisteredStageChartRecipe(
  skillId: StageChartSkillId,
  input: StageChartBuilderInput,
): StageChartBuilderOutput {
  return buildEChartsStageChartRecipe(skillId, input);
}
