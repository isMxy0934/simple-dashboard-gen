import type { AuthoringSkillSummary } from "@/ai/authoring/contracts/tool-io";
import { getSemanticSkillIdForViewKind } from "@/ai/authoring/semantic-view-kinds";
import {
  getTemplateCapability,
  listTemplateSupportedViewKinds,
  resolveCompatibleTemplateCapabilityId,
  resolveDashboardTemplateCapabilityId,
} from "@/contracts/dashboard-template-capability-registry";
import type { DashboardDocument } from "@/contracts/dashboard";
import type { DashboardViewKind } from "@/contracts/dashboard-view-intent";

export function availableSemanticSkillIdsForTemplate(input: {
  templateId: string;
  runtimeSkillCatalog: Map<string, AuthoringSkillSummary>;
}) {
  const supportedKinds = listTemplateSupportedViewKinds(input.templateId);
  const supportedSkillIds = supportedKinds.map((viewKind) =>
    getSemanticSkillIdForViewKind(viewKind),
  );
  return supportedSkillIds.filter((skillId) => input.runtimeSkillCatalog.has(skillId));
}

export function resolveTemplateViewProjection(input: {
  templateId: string;
  viewKind: DashboardViewKind;
}) {
  const compatibleTemplateId = resolveCompatibleTemplateCapabilityId(input.templateId);
  return compatibleTemplateId
    ? getTemplateCapability(compatibleTemplateId, input.viewKind)
    : null;
}

export function resolveDashboardTemplateViewProjection(input: {
  dashboard: Pick<DashboardDocument, "dashboard_spec">;
  viewKind: DashboardViewKind;
}) {
  const templateCapabilityId = resolveDashboardTemplateCapabilityId(input.dashboard);
  return templateCapabilityId
    ? getTemplateCapability(templateCapabilityId, input.viewKind)
    : null;
}
