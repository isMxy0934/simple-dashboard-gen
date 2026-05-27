import type { AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type { Permission } from "@/contracts/permissions";

type AuthoringToolCategory =
  | "read"
  | "declaration"
  | "author"
  | "approval";
type AuthoringToolScope = "dashboard" | "focused";

export type AuthoringToolPermission = Permission;

export interface AuthoringToolRegistration {
  name: AuthoringToolName;
  category: AuthoringToolCategory;
  inspectLane: boolean;
  readScopes?: readonly AuthoringToolScope[];
  authorScopes?: readonly AuthoringToolScope[];
  lifecycleWrite?: boolean;
  requiredPermissions: readonly AuthoringToolPermission[];
  labelKey: string;
}

export const AUTHORING_TOOL_REGISTRY = [
  { name: "loadSkill", category: "read", inspectLane: false, authorScopes: ["dashboard", "focused"], requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.loadSkill" },
  { name: "getViews", category: "read", inspectLane: true, readScopes: ["dashboard"], requiredPermissions: ["dashboard.read"], labelKey: "authoring.chat.toolLabels.getViews" },
  { name: "getView", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], requiredPermissions: ["dashboard.read"], labelKey: "authoring.chat.toolLabels.getView" },
  { name: "getDatasources", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], requiredPermissions: ["datasource.read"], labelKey: "authoring.chat.toolLabels.getDatasources" },
  { name: "listDatasourceTables", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], requiredPermissions: ["datasource.read"], labelKey: "authoring.chat.toolLabels.listDatasourceTables" },
  { name: "getTableSchema", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], requiredPermissions: ["datasource.read"], labelKey: "authoring.chat.toolLabels.getTableSchema" },
  { name: "previewTableData", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], authorScopes: ["dashboard", "focused"], requiredPermissions: ["datasource.read"], labelKey: "authoring.chat.toolLabels.previewTableData" },
  { name: "getQuery", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], requiredPermissions: ["dashboard.read"], labelKey: "authoring.chat.toolLabels.getQuery" },
  { name: "getBinding", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], requiredPermissions: ["dashboard.read"], labelKey: "authoring.chat.toolLabels.getBinding" },
  { name: "getDraftStatus", category: "read", inspectLane: true, readScopes: ["dashboard", "focused"], requiredPermissions: ["dashboard.read"], labelKey: "authoring.chat.toolLabels.getDraftStatus" },
  { name: "declareAuthoringGoal", category: "declaration", inspectLane: true, requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.declareAuthoringGoal" },
  { name: "runCheck", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.runCheck" },
  { name: "stageViewIntent", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.stageViewIntent" },
  { name: "stageQuery", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.stageQuery" },
  { name: "stageDelete", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], lifecycleWrite: true, requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.stageDelete" },
  { name: "composePatch", category: "author", inspectLane: false, authorScopes: ["dashboard", "focused"], requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.composePatch" },
  { name: "applyPatch", category: "approval", inspectLane: false, requiredPermissions: ["dashboard.edit"], labelKey: "authoring.chat.toolLabels.applyPatch" },
] satisfies AuthoringToolRegistration[];

function hasScope(
  scopes: readonly AuthoringToolScope[] | undefined,
  scope: AuthoringToolScope,
): boolean {
  return scopes?.includes(scope) ?? false;
}

export function filterAuthoringToolNamesByPermissions(
  toolNames: readonly AuthoringToolName[],
  permissions: ReadonlySet<Permission>,
): AuthoringToolName[] {
  return toolNames.filter((toolName) => {
    const definition = getAuthoringToolDefinition(toolName);
    return Boolean(
      definition &&
        definition.requiredPermissions.every((permission) =>
          permissions.has(permission),
        ),
    );
  });
}

export function getInspectLaneToolNames(): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => definition.inspectLane)
    .map((definition) => definition.name);
}

export function getReadToolNamesForScope(
  scope: AuthoringToolScope,
): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => hasScope(definition.readScopes, scope))
    .map((definition) => definition.name);
}

export function getAuthorToolNamesForScope(
  scope: AuthoringToolScope,
): AuthoringToolName[] {
  return AUTHORING_TOOL_REGISTRY
    .filter((definition) => hasScope(definition.authorScopes, scope))
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
