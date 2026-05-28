import type { DashboardDocument } from "./dashboard";
import type { EChartsStageChartRecipeId } from "./dashboard-chart-recipes";
import {
  getTemplateCapability,
  listTemplateSupportedViewKinds,
  resolveCompatibleTemplateCapabilityId,
  resolveDashboardTemplateCapabilityId,
} from "./dashboard-template-capability-registry";
import type { DashboardViewKind } from "./dashboard-view-intent";
import type { ViewFamilyId } from "./dashboard-view-family-registry";

export interface DesignKitViewKindMapping {
  recipeId: EChartsStageChartRecipeId;
  bodyContract: "shell_chrome_forbidden";
  viewFamilyId: ViewFamilyId;
}

export function getDesignKitSupportedViewKinds(
  designKitId: string,
): readonly DashboardViewKind[] {
  const templateId = resolveCompatibleTemplateCapabilityId(designKitId);
  return templateId ? listTemplateSupportedViewKinds(templateId) : [];
}

export function getDesignKitViewKindMapping(input: {
  designKitId: string;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DesignKitViewKindMapping | null {
  const templateId = resolveCompatibleTemplateCapabilityId(input.designKitId);
  return templateId ? getTemplateCapability(templateId, input.viewKind) : null;
}

export function getDashboardViewKindMapping(input: {
  dashboard: Pick<DashboardDocument, "dashboard_spec">;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DesignKitViewKindMapping | null {
  const templateId = resolveDashboardTemplateCapabilityId(input.dashboard);
  return templateId ? getTemplateCapability(templateId, input.viewKind) : null;
}
