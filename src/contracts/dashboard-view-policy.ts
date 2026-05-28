import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";
import type { DashboardViewKind } from "./dashboard-view-intent";
import type { ViewFamilyId } from "@/presentation/dashboard/runtime";
import {
  getTemplateCapability,
  listTemplateSupportedViewKinds,
} from "@/presentation/dashboard/runtime";

export interface DesignKitViewKindMapping {
  recipeId: EChartsStageChartRecipeId;
  bodyContract: "shell_chrome_forbidden";
  viewFamilyId: ViewFamilyId;
}

export function getDesignKitSupportedViewKinds(
  designKitId: string,
): readonly DashboardViewKind[] {
  return listTemplateSupportedViewKinds(designKitId);
}

export function getDesignKitViewKindMapping(input: {
  designKitId: string;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DesignKitViewKindMapping | null {
  return getTemplateCapability(input.designKitId, input.viewKind);
}
