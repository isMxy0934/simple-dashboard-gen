import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "@/contracts/dashboard-chart-recipes";
import type { EChartsStageChartRecipeId } from "@/contracts/dashboard-chart-recipes";
import {
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
  type DashboardDesignKitId,
  type DashboardViewStyleId,
} from "@/contracts/dashboard-presentation";

export const OPERATIONAL_REPORT_VIEW_STYLE_RECIPE_IDS =
  [...ECHARTS_STAGE_CHART_RECIPE_IDS] as EChartsStageChartRecipeId[];

export const DASHBOARD_VIEW_STYLE_RECIPE_SUPPORT = {
  [OPERATIONAL_REPORT_DESIGN_KIT_ID]: {
    [DASHBOARD_VIEW_STYLE_ID_CLEAN]: OPERATIONAL_REPORT_VIEW_STYLE_RECIPE_IDS,
    [DASHBOARD_VIEW_STYLE_ID_GRADIENT]: OPERATIONAL_REPORT_VIEW_STYLE_RECIPE_IDS,
    [DASHBOARD_VIEW_STYLE_ID_EMPHASIS]: OPERATIONAL_REPORT_VIEW_STYLE_RECIPE_IDS,
  },
} satisfies Record<
  DashboardDesignKitId,
  Record<DashboardViewStyleId, readonly EChartsStageChartRecipeId[]>
>;

export function getDashboardViewStyleSupportedRecipeIds(
  designKitId: string,
  viewStyleId: string,
): readonly EChartsStageChartRecipeId[] {
  if (designKitId !== OPERATIONAL_REPORT_DESIGN_KIT_ID) {
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
