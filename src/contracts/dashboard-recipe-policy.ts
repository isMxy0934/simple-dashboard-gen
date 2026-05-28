import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";
import {
  CANONICAL_RUNTIME_DESIGN_KIT_ID,
  type DashboardDesignKitId,
} from "./dashboard-presentation";
import { listTemplateCapabilityRecipeIds } from "./dashboard-template-capability-registry";

export interface DesignKitRecipePolicyRejection {
  allowed: false;
  recommendedRecipeId?: EChartsStageChartRecipeId;
  reason: string;
}

const CANONICAL_RUNTIME_RECIPE_IDS = listTemplateCapabilityRecipeIds(
  "report_runtime_v1",
);

const AI_VISIBLE_RECIPE_IDS = {
  [CANONICAL_RUNTIME_DESIGN_KIT_ID]: CANONICAL_RUNTIME_RECIPE_IDS,
} satisfies Record<DashboardDesignKitId, readonly EChartsStageChartRecipeId[]>;

const SUPPORTED_RECIPE_IDS = AI_VISIBLE_RECIPE_IDS;

const CANONICAL_RUNTIME_REJECTIONS: Partial<
  Record<EChartsStageChartRecipeId, DesignKitRecipePolicyRejection>
> = {
  "echarts-kpi-text": {
    allowed: false,
    recommendedRecipeId: "echarts-kpi-card",
    reason:
      "echarts-kpi-text is a legacy KPI alias and cannot create canonical report runtime views.",
  },
};

export function getDesignKitSupportedRecipeIds(
  designKitId: string,
): readonly EChartsStageChartRecipeId[] {
  if (designKitId !== CANONICAL_RUNTIME_DESIGN_KIT_ID) {
    return [];
  }
  return SUPPORTED_RECIPE_IDS[designKitId];
}

export function getDesignKitAiVisibleRecipeIds(
  designKitId: string,
): readonly EChartsStageChartRecipeId[] {
  if (designKitId !== CANONICAL_RUNTIME_DESIGN_KIT_ID) {
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
  if (designKitId === CANONICAL_RUNTIME_DESIGN_KIT_ID) {
    return (
      CANONICAL_RUNTIME_REJECTIONS[recipeId as EChartsStageChartRecipeId] ?? {
        allowed: false,
        reason: `${recipeId} is not supported for the canonical report runtime.`,
      }
    );
  }
  return {
    allowed: false,
    reason: `${recipeId} is not supported for ${designKitId}.`,
  };
}
