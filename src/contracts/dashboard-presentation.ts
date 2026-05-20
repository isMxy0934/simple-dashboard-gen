import { ECHARTS_STAGE_CHART_RECIPE_IDS } from "./dashboard-chart-recipes";
import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";
export {
  DASHBOARD_COLOR_THEME_ID_PURPLE,
  DASHBOARD_COLOR_THEME_ID_TEAL,
  DASHBOARD_COLOR_THEME_IDS,
  DASHBOARD_DESIGN_KIT_IDS,
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  DASHBOARD_VIEW_STYLE_IDS,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
} from "./dashboard-presentation-ids.js";
import {
  DASHBOARD_COLOR_THEME_IDS,
  DASHBOARD_DESIGN_KIT_IDS,
  DASHBOARD_VIEW_STYLE_ID_CLEAN,
  DASHBOARD_VIEW_STYLE_ID_EMPHASIS,
  DASHBOARD_VIEW_STYLE_ID_GRADIENT,
  DASHBOARD_VIEW_STYLE_IDS,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
} from "./dashboard-presentation-ids.js";

export type DashboardDesignKitId = (typeof DASHBOARD_DESIGN_KIT_IDS)[number];
export type DashboardColorThemeId = (typeof DASHBOARD_COLOR_THEME_IDS)[number];
export type DashboardViewStyleId = (typeof DASHBOARD_VIEW_STYLE_IDS)[number];

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
