import {
  ECHARTS_STAGE_CHART_RECIPE_IDS,
  type EChartsStageChartRecipeId,
} from "./dashboard-chart-recipes";
import {
  EXECUTIVE_REPORT_DESIGN_KIT_ID,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
  type DashboardDesignKitId,
} from "./dashboard-presentation";
import { listTemplateCapabilityRecipeIds } from "@/presentation/dashboard/runtime";

export interface DesignKitRecipePolicyRejection {
  allowed: false;
  recommendedRecipeId?: EChartsStageChartRecipeId;
  reason: string;
}

const ALL_RECIPE_IDS = [...ECHARTS_STAGE_CHART_RECIPE_IDS] as const;
const EXECUTIVE_REPORT_RECIPE_IDS = listTemplateCapabilityRecipeIds(
  "report_runtime_v1",
);

const AI_VISIBLE_RECIPE_IDS = {
  [OPERATIONAL_REPORT_DESIGN_KIT_ID]: ALL_RECIPE_IDS,
  [EXECUTIVE_REPORT_DESIGN_KIT_ID]: EXECUTIVE_REPORT_RECIPE_IDS,
} satisfies Record<DashboardDesignKitId, readonly EChartsStageChartRecipeId[]>;

const SUPPORTED_RECIPE_IDS = AI_VISIBLE_RECIPE_IDS;

const EXECUTIVE_REJECTIONS: Partial<
  Record<EChartsStageChartRecipeId, DesignKitRecipePolicyRejection>
> = {
  "echarts-kpi-text": {
    allowed: false,
    recommendedRecipeId: "echarts-kpi-card",
    reason:
      "echarts-kpi-text is a legacy KPI alias and cannot create executive report views.",
  },
};

export function getDesignKitSupportedRecipeIds(
  designKitId: string,
): readonly EChartsStageChartRecipeId[] {
  if (
    designKitId !== OPERATIONAL_REPORT_DESIGN_KIT_ID &&
    designKitId !== EXECUTIVE_REPORT_DESIGN_KIT_ID
  ) {
    return [];
  }
  return SUPPORTED_RECIPE_IDS[designKitId];
}

export function getDesignKitAiVisibleRecipeIds(
  designKitId: string,
): readonly EChartsStageChartRecipeId[] {
  if (
    designKitId !== OPERATIONAL_REPORT_DESIGN_KIT_ID &&
    designKitId !== EXECUTIVE_REPORT_DESIGN_KIT_ID
  ) {
    return [];
  }
  return AI_VISIBLE_RECIPE_IDS[designKitId];
}

export function isRecipeSupportedForDesignKit(
  designKitId: string,
  recipeId: string,
): boolean {
  return getDesignKitSupportedRecipeIds(designKitId).includes(
    recipeId as EChartsStageChartRecipeId,
  );
}

export function getRecipePolicyRejection(
  designKitId: string,
  recipeId: string,
): DesignKitRecipePolicyRejection | null {
  if (isRecipeSupportedForDesignKit(designKitId, recipeId)) {
    return null;
  }
  if (designKitId === EXECUTIVE_REPORT_DESIGN_KIT_ID) {
    return (
      EXECUTIVE_REJECTIONS[recipeId as EChartsStageChartRecipeId] ?? {
        allowed: false,
        reason: `${recipeId} is not supported for executive report views.`,
      }
    );
  }
  return {
    allowed: false,
    reason: `${recipeId} is not supported for ${designKitId}.`,
  };
}
