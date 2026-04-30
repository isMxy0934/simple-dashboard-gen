import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";

export type AuthoringToolCategory =
  | "read"
  | "declaration"
  | "workflow"
  | "approval";

export interface AuthoringToolDefinition {
  name: AuthoringToolName;
  category: AuthoringToolCategory;
  inspectLane: boolean;
  workflowForced: boolean;
  labelKey: string;
}

export const AUTHORING_TOOL_REGISTRY = [
  { name: "loadSkill", category: "read", inspectLane: true, workflowForced: true, labelKey: "authoring.chat.toolLabels.loadSkill" },
  { name: "getViews", category: "read", inspectLane: true, workflowForced: false, labelKey: "authoring.chat.toolLabels.getViews" },
  { name: "getView", category: "read", inspectLane: true, workflowForced: true, labelKey: "authoring.chat.toolLabels.getView" },
  { name: "getDatasources", category: "read", inspectLane: true, workflowForced: true, labelKey: "authoring.chat.toolLabels.getDatasources" },
  { name: "getSchemaByDatasource", category: "read", inspectLane: true, workflowForced: true, labelKey: "authoring.chat.toolLabels.getSchemaByDatasource" },
  { name: "getQuery", category: "read", inspectLane: true, workflowForced: false, labelKey: "authoring.chat.toolLabels.getQuery" },
  { name: "getBinding", category: "read", inspectLane: true, workflowForced: false, labelKey: "authoring.chat.toolLabels.getBinding" },
  { name: "getDraftStatus", category: "read", inspectLane: true, workflowForced: false, labelKey: "authoring.chat.toolLabels.getDraftStatus" },
  { name: "declareAuthoringGoal", category: "declaration", inspectLane: true, workflowForced: false, labelKey: "authoring.chat.toolLabels.declareAuthoringGoal" },
  { name: "runCheck", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.runCheck" },
  { name: "upsertView", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.upsertView" },
  { name: "upsertQuery", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.upsertQuery" },
  { name: "upsertBinding", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.upsertBinding" },
  { name: "upsertLayout", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.upsertLayout" },
  { name: "deleteView", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.deleteView" },
  { name: "deleteQuery", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.deleteQuery" },
  { name: "deleteBinding", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.deleteBinding" },
  { name: "composePatch", category: "workflow", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.composePatch" },
  { name: "applyPatch", category: "approval", inspectLane: false, workflowForced: true, labelKey: "authoring.chat.toolLabels.applyPatch" },
] satisfies AuthoringToolDefinition[];

export function getInspectLaneToolNames(): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => definition.inspectLane)
    .map((definition) => definition.name);
}

export function getAuthoringToolDefinition(
  name: string,
): AuthoringToolDefinition | undefined {
  return AUTHORING_TOOL_REGISTRY.find((definition) => definition.name === name);
}

export function isCanonicalAuthoringToolName(
  name: string,
): name is AuthoringToolName {
  return Boolean(getAuthoringToolDefinition(name));
}

export function getAuthoringToolLabelKey(name: string): string | undefined {
  return getAuthoringToolDefinition(name)?.labelKey;
}
