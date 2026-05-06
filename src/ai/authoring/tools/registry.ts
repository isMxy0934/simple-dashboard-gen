import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";

export type AuthoringToolCategory =
  | "read"
  | "declaration"
  | "author"
  | "approval";

export interface AuthoringToolDefinition {
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
  { name: "getSchemaByDatasource", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getSchemaByDatasource" },
  { name: "getQuery", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getQuery" },
  { name: "getBinding", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getBinding" },
  { name: "getDraftStatus", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.getDraftStatus" },
  { name: "declareAuthoringGoal", category: "declaration", inspectLane: true, labelKey: "authoring.chat.toolLabels.declareAuthoringGoal" },
  { name: "runCheck", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.runCheck" },
  { name: "stageChart", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.stageChart" },
  { name: "upsertView", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.upsertView" },
  { name: "upsertQuery", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.upsertQuery" },
  { name: "upsertBinding", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.upsertBinding" },
  { name: "upsertLayout", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, labelKey: "authoring.chat.toolLabels.upsertLayout" },
  { name: "deleteView", category: "author", inspectLane: false, authorScopes: ["dashboard"], labelKey: "authoring.chat.toolLabels.deleteView" },
  { name: "deleteQuery", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.deleteQuery" },
  { name: "deleteBinding", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.deleteBinding" },
  { name: "composePatch", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], labelKey: "authoring.chat.toolLabels.composePatch" },
  { name: "applyPatch", category: "approval", inspectLane: false, labelKey: "authoring.chat.toolLabels.applyPatch" },
] satisfies AuthoringToolDefinition[];

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

export function getDashboardLifecycleToolNames(): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => definition.lifecycleWrite)
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
