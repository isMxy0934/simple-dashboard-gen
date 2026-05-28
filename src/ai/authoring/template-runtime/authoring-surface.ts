import type { AuthoringSkillSummary } from "@/ai/authoring/contracts/tool-io";
import { getSemanticSkillIdForViewKind } from "@/ai/authoring/semantic-view-kinds";
import {
  getTemplateCapability,
  listTemplateSupportedViewKinds,
  resolveCompatibleTemplateCapabilityId,
} from "@/contracts/dashboard-template-capability-registry";
import type { DashboardViewKind } from "@/contracts/dashboard-view-intent";
import { resolveTemplateRuntime } from "@/presentation/dashboard/runtime";

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

export function buildTemplateScopedPromptSummary(templateId: string) {
  const runtime = resolveTemplateRuntime();
  return {
    templateId: runtime.id,
    zeroViewMode: runtime.zeroView.mode,
    supportedViewKinds: listTemplateSupportedViewKinds(templateId),
  };
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
