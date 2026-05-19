import type {
  StageChartBuilderInput,
  StageChartBuilderOutput,
  StageChartSkillId,
} from "@/ai/authoring/skills/contract";
import { buildEChartsStageChartRecipe } from "@/renderers/echarts/recipes/chart-recipe-registry";

// ECharts is the only production chart renderer today, so authoring keeps a
// narrow bridge to the ECharts recipe registry instead of inventing a renderer
// abstraction without a second implementation. Split this only when another
// renderer needs to share the stageChart authoring contract.
export function buildRegisteredStageChartRecipe(
  skillId: StageChartSkillId,
  input: StageChartBuilderInput,
): StageChartBuilderOutput {
  return buildEChartsStageChartRecipe(skillId, input);
}
