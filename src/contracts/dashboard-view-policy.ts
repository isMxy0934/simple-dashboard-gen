import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";
import {
  EXECUTIVE_REPORT_DESIGN_KIT_ID,
  OPERATIONAL_REPORT_DESIGN_KIT_ID,
} from "./dashboard-presentation";
import {
  DASHBOARD_VIEW_KIND_IDS,
  type DashboardViewKind,
} from "./dashboard-view-intent";

export interface DesignKitViewKindMapping {
  recipeId: EChartsStageChartRecipeId;
  bodyContract: "shell_chrome_forbidden";
}

const VIEW_KIND_TO_RECIPE = {
  stat_kpi: "echarts-kpi-card",
  time_trend: "echarts-line",
  category_comparison: "echarts-bar",
  ranked_bar: "echarts-ranked-bar",
  signal_list: "echarts-signal-list",
  funnel: "echarts-funnel",
  bounded_gauge: "echarts-kpi-gauge",
} as const satisfies Record<DashboardViewKind, EChartsStageChartRecipeId>;

export function getDesignKitSupportedViewKinds(
  designKitId: string,
): readonly DashboardViewKind[] {
  if (
    designKitId === OPERATIONAL_REPORT_DESIGN_KIT_ID ||
    designKitId === EXECUTIVE_REPORT_DESIGN_KIT_ID
  ) {
    return DASHBOARD_VIEW_KIND_IDS;
  }
  return [];
}

export function getDesignKitViewKindMapping(input: {
  designKitId: string;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DesignKitViewKindMapping | null {
  if (!getDesignKitSupportedViewKinds(input.designKitId).includes(input.viewKind)) {
    return null;
  }
  return {
    recipeId: VIEW_KIND_TO_RECIPE[input.viewKind],
    bodyContract: "shell_chrome_forbidden",
  };
}
