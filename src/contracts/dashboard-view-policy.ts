import type { DashboardDocument } from "./dashboard";
import {
  getTemplateCapability,
  listTemplateSupportedViewKinds,
  resolveCompatibleTemplateCapabilityId,
  resolveDashboardTemplateCapabilityId,
  type TemplateViewKindCapability,
} from "./dashboard-template-capability-registry";
import type { DashboardViewKind } from "./dashboard-view-intent";

export type DashboardTemplateViewKindMapping = TemplateViewKindCapability;
export type DesignKitViewKindMapping = DashboardTemplateViewKindMapping;

export function getTemplateSupportedViewKinds(
  templateId: string,
): readonly DashboardViewKind[] {
  return listTemplateSupportedViewKinds(templateId);
}

export function getTemplateViewKindMapping(input: {
  templateId: string;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DashboardTemplateViewKindMapping | null {
  return getTemplateCapability(input.templateId, input.viewKind);
}

export function getDesignKitSupportedViewKinds(
  designKitId: string,
): readonly DashboardViewKind[] {
  const templateId = resolveCompatibleTemplateCapabilityId(designKitId);
  return templateId ? getTemplateSupportedViewKinds(templateId) : [];
}

export function getDesignKitViewKindMapping(input: {
  designKitId: string;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DesignKitViewKindMapping | null {
  const templateId = resolveCompatibleTemplateCapabilityId(input.designKitId);
  return templateId
    ? getTemplateViewKindMapping({
        templateId,
        viewKind: input.viewKind,
        viewStyleId: input.viewStyleId,
      })
    : null;
}

export function getDashboardViewKindMapping(input: {
  dashboard: Pick<DashboardDocument, "dashboard_spec">;
  viewKind: DashboardViewKind;
  viewStyleId: string;
}): DashboardTemplateViewKindMapping | null {
  const templateId = resolveDashboardTemplateCapabilityId(input.dashboard);
  return templateId
    ? getTemplateViewKindMapping({
        templateId,
        viewKind: input.viewKind,
        viewStyleId: input.viewStyleId,
      })
    : null;
}
