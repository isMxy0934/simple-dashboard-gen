"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { WorkspaceRoleId } from "@/contracts";
import styles from "./management.module.css";
import { DashboardListPanel } from "./dashboard-list-panel";
import { ManagementOverviewPanel } from "./management-overview-panel";
import { DatasourcePanel } from "./datasource-panel";
import { SettingsPanel } from "./settings-panel";
import { UsersPanel } from "./users-panel";
import { useManagementController } from "../hooks/use-management-controller";
import type { ManagementSection, ReportListTab } from "../state";
import {
  deriveManagementCapabilities,
  resolvePermittedManagementSection,
} from "../permissions";
import { useI18n } from "../../i18n/i18n-context";
import { useWorkspaceContext } from "../../workspace";

const NAV_KEYS: Record<ManagementSection, string> = {
  overview: "management.nav.overview",
  reports: "management.nav.reports",
  datasources: "management.nav.datasources",
  views: "management.nav.views",
  users: "management.nav.users",
  settings: "management.nav.settings",
};

const NAV_INITIALS: Record<ManagementSection, string> = {
  overview: "O",
  reports: "R",
  datasources: "D",
  views: "V",
  users: "U",
  settings: "S",
};

export function ManagementPage({
  initialSection = "overview",
  initialReportTab = "authoring",
}: {
  initialSection?: ManagementSection;
  initialReportTab?: ReportListTab;
}) {
  const { t, locale } = useI18n();
  const {
    loading: workspaceLoading,
    error: workspaceError,
    resolved: workspaceResolved,
    workspaceId,
    workspaceName,
    users,
    roles,
    currentUserId,
    currentUserPermissions,
    canManageRoles,
    selectedUserId,
    updateUserRole,
    verbose,
    setVerbose,
    setUserLocale,
  } = useWorkspaceContext();
  const [roleUpdatingUserId, setRoleUpdatingUserId] = useState("");
  const [userRoleMessage, setUserRoleMessage] = useState("");
  const workspaceReady = workspaceResolved && Boolean(workspaceId && selectedUserId);
  const capabilities = useMemo(
    () => deriveManagementCapabilities(currentUserPermissions),
    [currentUserPermissions],
  );
  const permittedInitialSection = resolvePermittedManagementSection(
    initialSection,
    capabilities,
  );
  const {
    section,
    collections,
    overviewStats,
    recentDashboards,
    datasourceOverview,
    actionMessage,
    searchByMode,
    setSearchByMode,
    activeCollection,
    filteredDashboards,
    handleSectionChange,
    handleCreate,
    handleDelete,
    handleUnpublish,
  } = useManagementController({
    workspaceId,
    userId: selectedUserId,
    enabled: workspaceReady,
    dashboardModes: capabilities.dashboardModes,
    canReadDatasources: capabilities.canReadDatasources,
    initialSection: permittedInitialSection,
    initialReportTab,
  });
  const resolvedSection = resolvePermittedManagementSection(section, capabilities);

  async function handleUserRoleChange(userId: string, roleId: WorkspaceRoleId) {
    setRoleUpdatingUserId(userId);
    setUserRoleMessage("");
    try {
      await updateUserRole({ userId, roleId });
      setUserRoleMessage(t("management.users.roleUpdateRequiresRelogin"));
    } catch (error) {
      setUserRoleMessage(
        error instanceof Error
          ? error.message
          : t("management.users.roleUpdateFailed"),
      );
    } finally {
      setRoleUpdatingUserId("");
    }
  }

  return (
    <div className={styles.shell}>
      <div className={styles.workspace}>
        <aside
          className={styles.sidebar}
          aria-label={t("management.aria.workspace")}
        >
          <div className={styles.sidebarBrand}>
            <div className={styles.brandLockup}>
              <img
                className={styles.brandMark}
                src="/brand/logo_mercaso_color@2x.png"
                width="42"
                height="42"
                alt=""
                aria-hidden
              />
              <div>
                <h1 className={styles.sidebarTitle}>{t("management.sidebar.title")}</h1>
                <p className={styles.sidebarCopy}>{workspaceName || t("management.sidebar.copy")}</p>
              </div>
            </div>
          </div>

          <nav className={styles.modeList} aria-label={t("management.aria.primaryNav")}>
            <div className={styles.navGroupLabel}>{t("management.nav.group")}</div>
            {capabilities.visibleSections.map((entry) => (
              <Link
                key={entry}
                href={entry === "overview" ? "/" : `/?section=${entry}`}
                aria-label={t(NAV_KEYS[entry])}
                aria-current={resolvedSection === entry ? "page" : undefined}
                className={`${styles.modeButton} ${
                  resolvedSection === entry ? styles.modeButtonActive : ""
                }`}
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey
                  ) {
                    return;
                  }
                  event.preventDefault();
                  handleSectionChange(
                    resolvePermittedManagementSection(entry, capabilities),
                  );
                }}
              >
                <span className={styles.modeButtonIcon} aria-hidden>
                  {NAV_INITIALS[entry]}
                </span>
                <span className={styles.modeButtonText}>
                  <span className={styles.modeButtonLabel}>{t(NAV_KEYS[entry])}</span>
                  <span className={styles.modeButtonHint}>
                    {t(`management.navHint.${entry}`)}
                  </span>
                </span>
              </Link>
            ))}
          </nav>

        </aside>

        <div className={styles.mainColumn}>
          <main
            className={styles.content}
          >
            {resolvedSection === "overview" ? (
              <ManagementOverviewPanel
                actionMessage={actionMessage}
                overviewStats={overviewStats}
                recentDashboards={recentDashboards}
                datasourceOverview={datasourceOverview}
                userCount={users.length}
                canEditDashboards={capabilities.canEditDashboards}
                canReadDatasources={capabilities.canReadDatasources}
                canManageDatasources={capabilities.canManageDatasources}
                canManageWorkspace={capabilities.canManageWorkspace}
              />
            ) : resolvedSection === "datasources" ? (
              <DatasourcePanel
                actionMessage={actionMessage}
                canManageDatasources={capabilities.canManageDatasources}
                readOnly={!capabilities.canManageDatasources}
              />
            ) : resolvedSection === "users" ? (
              <UsersPanel
                users={users}
                roles={roles}
                currentUserId={currentUserId}
                canManageRoles={canManageRoles}
                loading={workspaceLoading}
                error={workspaceError}
                actionMessage={userRoleMessage}
                roleUpdatingUserId={roleUpdatingUserId}
                onRoleChange={(userId, roleId) => {
                  void handleUserRoleChange(userId, roleId);
                }}
              />
            ) : resolvedSection === "settings" ? (
              <SettingsPanel
                locale={locale}
                verbose={verbose}
                loading={workspaceLoading}
                error={workspaceError}
                onLocaleChange={(nextLocale) => {
                  void setUserLocale(nextLocale);
                }}
                onToggleVerbose={(nextVerbose) => {
                  void setVerbose(nextVerbose);
                }}
              />
            ) : (
              <DashboardListPanel
                section={resolvedSection === "views" ? "viewer" : "authoring"}
                workspaceId={workspaceId}
                actionMessage={actionMessage}
                activeCollection={
                  activeCollection ?? { dashboards: [], status: "idle", message: "" }
                }
                collections={collections}
                users={users}
                searchValue={
                  searchByMode[resolvedSection === "views" ? "viewer" : "authoring"]
                }
                filteredDashboards={filteredDashboards}
                onSearchChange={(value) => {
                  const mode = resolvedSection === "views" ? "viewer" : "authoring";
                  setSearchByMode((current) => ({
                    ...current,
                    [mode]: value,
                  }));
                }}
                canEditDashboards={capabilities.canEditDashboards}
                canPublishDashboards={capabilities.canPublishDashboards}
                onCreate={() => void handleCreate()}
                onDeleteDashboard={(dashboardId) =>
                  void (resolvedSection === "views"
                    ? handleUnpublish(dashboardId)
                    : handleDelete(dashboardId))
                }
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
