import "server-only";

import { ApiError } from "@/server/api-error";

export const Permission = {
  DashboardRead: "dashboard.read",
  DashboardEdit: "dashboard.edit",
  DatasourceRead: "datasource.read",
  DatasourceManage: "datasource.manage",
  WorkspaceManage: "workspace.manage",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export function requirePermission(permissions: ReadonlySet<Permission>, permission: Permission): void {
  if (!permissions.has(permission)) {
    throw new ApiError(403, "PERMISSION_DENIED", "error.auth.permission_denied", { permission });
  }
}
