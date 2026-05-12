import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";

type AuthoringToolCategory =
  | "read"
  | "declaration"
  | "author"
  | "approval";

export interface AuthoringToolRegistration {
  name: AuthoringToolName;
  category: AuthoringToolCategory;
  inspectLane: boolean;
  readScopes?: readonly ("dashboard" | "focused")[];
  authorScopes?: readonly ("dashboard" | "focused")[];
  lifecycleWrite?: boolean;
  labelKey: string;
}

export const AUTHORING_TOOL_REGISTRY = [
  { name: "loadSkill", category: "read", inspectLane: false, authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.loadSkill" },
  { name: "getViews", category: "read", inspectLane: true, readScopes: ["dashboard"], labelKey: "authoring.chat.toolLabels.getViews" },
  { name: "getView", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getView" },
  { name: "getDatasources", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getDatasources" },
  { name: "listDatasourceTables", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.listDatasourceTables" },
  { name: "getTableSchema", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getTableSchema" },
  { name: "previewTableData", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.previewTableData" },
  { name: "getQuery", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getQuery" },
  { name: "getBinding", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getBinding" },
  { name: "getDraftStatus", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getDraftStatus" },
  { name: "declareAuthoringGoal", category: "declaration", inspectLane: true, labelKey: "authoring.chat.toolLabels.declareAuthoringGoal" },
  { name: "runCheck", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.runCheck" },
  { name: "stageChart", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.stageChart" },
  { name: "stageQuery", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.stageQuery" },
  { name: "stageDelete", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.stageDelete" },
  { name: "composePatch", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.composePatch" },
  { name: "applyPatch", category: "approval", inspectLane: false, labelKey: "authoring.chat.toolLabels.applyPatch" },
] satisfies AuthoringToolRegistration[];

export function getInspectLaneToolNames(): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => definition.inspectLane)
    .map((definition) => definition.name);
}

export function getReadToolNamesForScope(
  scope: "dashboard" | "focused",
): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => definition.readScopes?.includes(scope))
    .map((definition) => definition.name);
}

export function getAuthorToolNamesForScope(
  scope: "dashboard" | "focused",
): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => definition.authorScopes?.includes(scope))
    .map((definition) => definition.name);
}

function getAuthoringToolDefinition(
  name: string,
): AuthoringToolRegistration | undefined {
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
