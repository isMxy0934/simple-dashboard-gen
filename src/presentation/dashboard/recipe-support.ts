import type { EChartsStageChartRecipeId } from "@/contracts/dashboard-chart-recipes";
import { getDesignKitSupportedRecipeIds } from "@/contracts/dashboard-recipe-policy";
import {
  CANONICAL_RUNTIME_DESIGN_KIT_ID,
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  type DashboardDesignKitId,
  type DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";

export const CANONICAL_RUNTIME_VIEW_STYLE_RECIPE_IDS =
  [...getDesignKitSupportedRecipeIds(CANONICAL_RUNTIME_DESIGN_KIT_ID)] as EChartsStageChartRecipeId[];

export const DASHBOARD_VIEW_STYLE_RECIPE_SUPPORT = {
  [CANONICAL_RUNTIME_DESIGN_KIT_ID]: {
    [DASHBOARD_VIEW_STYLE_ID_CLEAN]: CANONICAL_RUNTIME_VIEW_STYLE_RECIPE_IDS,
    [DASHBOARD_VIEW_STYLE_ID_GRADIENT]: CANONICAL_RUNTIME_VIEW_STYLE_RECIPE_IDS,
    [DASHBOARD_VIEW_STYLE_ID_EMPHASIS]: CANONICAL_RUNTIME_VIEW_STYLE_RECIPE_IDS,
  },
} satisfies Record<
  DashboardDesignKitId,
  Record<DashboardViewStyleId, readonly EChartsStageChartRecipeId[]>
>;

export function getDashboardViewStyleSupportedRecipeIds(
  designKitId: string,
  viewStyleId: string,
): readonly EChartsStageChartRecipeId[] {
  if (designKitId !== CANONICAL_RUNTIME_DESIGN_KIT_ID) {
    return [];
  }
  return (
    DASHBOARD_VIEW_STYLE_RECIPE_SUPPORT[designKitId][
      viewStyleId as DashboardViewStyleId
    ] ?? []
  );
}

export function isDashboardViewStyleRecipeSupported(input: {
  designKitId: string;
  viewStyleId: string;
  recipeId: string;
}): boolean {
  return getDashboardViewStyleSupportedRecipeIds(
    input.designKitId,
    input.viewStyleId,
  ).includes(input.recipeId as EChartsStageChartRecipeId);
}
