import type { Permission as PermissionValue } from "@/contracts/permissions";
import { Permission } from "@/contracts/permissions";
import type { DashboardListMode } from "@/contracts";
import type { ManagementSection } from "./state";

const ALL_SECTIONS: ManagementSection[] = [
  "overview",
  "reports",
  "views",
  "datasources",
  "users",
  "settings",
];

export interface ManagementCapabilities {
  permissions: ReadonlySet<PermissionValue>;
  visibleSections: ManagementSection[];
  defaultSection: ManagementSection;
  dashboardModes: DashboardListMode[];
  canReadPublishedDashboards: boolean;
  canEditDashboards: boolean;
  canPublishDashboards: boolean;
  canReadDatasources: boolean;
  canManageDatasources: boolean;
  canManageWorkspace: boolean;
}

export function deriveManagementCapabilities(
  permissions: readonly string[],
): ManagementCapabilities {
  const permissionSet = new Set(permissions as PermissionValue[]);
  const canReadPublishedDashboards = permissionSet.has(Permission.DashboardRead);
  const canEditDashboards = permissionSet.has(Permission.DashboardEdit);
  const canPublishDashboards = permissionSet.has(Permission.DashboardPublish);
  const canReadDatasources = permissionSet.has(Permission.DatasourceRead);
  const canManageDatasources = permissionSet.has(Permission.DatasourceManage);
  const canManageWorkspace = permissionSet.has(Permission.WorkspaceAdmin);
  const dashboardModes: DashboardListMode[] = [
    ...(canEditDashboards ? (["authoring"] as const) : []),
    ...(canReadPublishedDashboards ? (["viewer"] as const) : []),
  ];

  const visibleSections = ALL_SECTIONS.filter((section) => {
    if (section === "reports") {
      return canEditDashboards;
    }
    if (section === "views") {
      return canReadPublishedDashboards;
    }
    if (section === "datasources") {
      return canReadDatasources;
    }
    if (section === "users") {
      return canManageWorkspace;
    }
    return true;
  });

  return {
    permissions: permissionSet,
    visibleSections,
    defaultSection: visibleSections[0] ?? "settings",
    dashboardModes,
    canReadPublishedDashboards,
    canEditDashboards,
    canPublishDashboards,
    canReadDatasources,
    canManageDatasources,
    canManageWorkspace,
  };
}

export function resolvePermittedManagementSection(
  section: ManagementSection,
  capabilities: Pick<ManagementCapabilities, "visibleSections" | "defaultSection">,
): ManagementSection {
  return capabilities.visibleSections.includes(section)
    ? section
    : capabilities.defaultSection;
}
