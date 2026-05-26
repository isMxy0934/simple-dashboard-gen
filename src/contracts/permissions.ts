export const Permission = {
  DashboardRead: "dashboard.read",
  DashboardEdit: "dashboard.edit",
  DashboardPublish: "dashboard.publish",
  DatasourceRead: "datasource.read",
  DatasourceManage: "datasource.manage",
  WorkspaceAdmin: "workspace.admin",
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
