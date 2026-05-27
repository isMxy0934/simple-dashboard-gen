// The recipe builder registry is intentionally internal. Public authoring skill
// metadata is loaded by src/server/ai/skill-loader.ts from semantic skill dirs.
export {
  getInternalStageChartBuilder,
  listInternalStageChartSkillIds,
} from "@/ai/authoring/view-intent/internal-stage-chart-builders";
