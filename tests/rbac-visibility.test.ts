import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./ts-paths-loader.mjs", import.meta.url);

const managementPermissions = await import("../src/web/management/permissions.ts");
const contractsPermissions = await import("../src/contracts/permissions.ts");

test("shared permission constants are browser-safe and match server permission strings", () => {
  assert.equal(contractsPermissions.Permission.DashboardRead, "dashboard.read");
  assert.equal(contractsPermissions.Permission.DashboardEdit, "dashboard.edit");
  assert.equal(contractsPermissions.Permission.DashboardPublish, "dashboard.publish");
  assert.equal(contractsPermissions.Permission.DatasourceRead, "datasource.read");
  assert.equal(contractsPermissions.Permission.DatasourceManage, "datasource.manage");
  assert.equal(contractsPermissions.Permission.WorkspaceAdmin, "workspace.admin");
});

test("management capabilities derive visible sections and operations from permissions", () => {
  const viewer = managementPermissions.deriveManagementCapabilities([
    contractsPermissions.Permission.DashboardRead,
  ]);
  assert.deepEqual(viewer.visibleSections, ["overview", "views", "settings"]);
  assert.equal(viewer.defaultSection, "overview");
  assert.equal(viewer.canReadPublishedDashboards, true);
  assert.equal(viewer.canEditDashboards, false);
  assert.equal(viewer.canPublishDashboards, false);
  assert.equal(viewer.canReadDatasources, false);
  assert.equal(viewer.canManageDatasources, false);
  assert.equal(viewer.canManageWorkspace, false);

  const editor = managementPermissions.deriveManagementCapabilities([
    contractsPermissions.Permission.DashboardRead,
    contractsPermissions.Permission.DashboardEdit,
    contractsPermissions.Permission.DashboardPublish,
    contractsPermissions.Permission.DatasourceRead,
  ]);
  assert.deepEqual(editor.visibleSections, [
    "overview",
    "reports",
    "views",
    "datasources",
    "settings",
  ]);
  assert.equal(editor.canEditDashboards, true);
  assert.equal(editor.canPublishDashboards, true);
  assert.equal(editor.canReadDatasources, true);
  assert.equal(editor.canManageDatasources, false);
  assert.equal(editor.canManageWorkspace, false);

  const admin = managementPermissions.deriveManagementCapabilities([
    contractsPermissions.Permission.DashboardRead,
    contractsPermissions.Permission.DashboardEdit,
    contractsPermissions.Permission.DashboardPublish,
    contractsPermissions.Permission.DatasourceRead,
    contractsPermissions.Permission.DatasourceManage,
    contractsPermissions.Permission.WorkspaceAdmin,
  ]);
  assert.deepEqual(admin.visibleSections, [
    "overview",
    "reports",
    "views",
    "datasources",
    "users",
    "settings",
  ]);
  assert.equal(admin.canManageDatasources, true);
  assert.equal(admin.canManageWorkspace, true);
});

test("management section fallback rejects hidden sections", () => {
  const viewer = managementPermissions.deriveManagementCapabilities([
    contractsPermissions.Permission.DashboardRead,
  ]);

  assert.equal(managementPermissions.resolvePermittedManagementSection("users", viewer), "overview");
  assert.equal(managementPermissions.resolvePermittedManagementSection("datasources", viewer), "overview");
  assert.equal(managementPermissions.resolvePermittedManagementSection("views", viewer), "views");
});

test("dashboard routes use stricter permissions for authoring mode than viewer mode", async () => {
  const listRoute = await readFile(
    new URL("../src/app/api/dashboards/route.ts", import.meta.url),
    "utf8",
  );
  const detailRoute = await readFile(
    new URL("../src/app/api/dashboards/[dashboardId]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(listRoute, /dashboardReadPermissionForMode\(mode\)/);
  assert.match(detailRoute, /dashboardReadPermissionForMode\(mode\)/);
  assert.match(listRoute, /mode\s*===\s*"authoring"\s*\?\s*Permission\.DashboardEdit\s*:\s*Permission\.DashboardRead/);
  assert.match(detailRoute, /mode\s*===\s*"authoring"\s*\?\s*Permission\.DashboardEdit\s*:\s*Permission\.DashboardRead/);
});

test("personal settings update requires dashboard read before parsing request body", async () => {
  const source = await readFile(
    new URL("../src/app/api/authoring/settings/route.ts", import.meta.url),
    "utf8",
  );
  const authIndex = source.indexOf("requireApiSession(request, Permission.DashboardRead");
  const jsonIndex = source.indexOf("request.json()");

  assert.notEqual(authIndex, -1);
  assert.notEqual(jsonIndex, -1);
  assert.ok(authIndex < jsonIndex);
  assert.doesNotMatch(source, /PUT[\s\S]*requireApiSession\(request,\s*Permission\.DashboardEdit\)/);
});

test("management UI consumes capabilities instead of showing all tabs and actions", async () => {
  const managementPage = await readFile(
    new URL("../src/web/management/ui/management-page.tsx", import.meta.url),
    "utf8",
  );
  const dashboardList = await readFile(
    new URL("../src/web/management/ui/dashboard-list-panel.tsx", import.meta.url),
    "utf8",
  );
  const datasourcePanel = await readFile(
    new URL("../src/web/management/ui/datasource-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(managementPage, /deriveManagementCapabilities/);
  assert.match(managementPage, /visibleSections/);
  assert.doesNotMatch(managementPage, /const MANAGEMENT_NAV: ManagementSection\[\]/);
  assert.match(dashboardList, /canEditDashboards/);
  assert.match(dashboardList, /canPublishDashboards/);
  assert.match(datasourcePanel, /readOnly/);
  assert.match(datasourcePanel, /canManageDatasources/);
});

test("authoring entrypoints gate editor access with dashboard edit permission", async () => {
  const appSource = await readFile(
    new URL("../src/web/authoring/ui/authoring-app.tsx", import.meta.url),
    "utf8",
  );
  const templateSource = await readFile(
    new URL("../src/web/authoring/ui/template-picker-page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(appSource, /canEditDashboards/);
  assert.match(appSource, /auth\.gate\.permissionDenied/);
  assert.match(templateSource, /canEditDashboards/);
});
