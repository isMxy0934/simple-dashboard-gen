"use client";

import Link from "next/link";
import styles from "./management.module.css";
import { DashboardListPanel } from "./dashboard-list-panel";
import { LocaleSwitcher } from "./locale-switcher";
import { ManagementOverviewPanel } from "./management-overview-panel";
import { DatasourcePanel } from "./datasource-panel";
import { SettingsPanel } from "./settings-panel";
import { UsersPanel } from "./users-panel";
import { useManagementController } from "../hooks/use-management-controller";
import type { ManagementSection, ReportListTab } from "../state";
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

const MANAGEMENT_NAV: ManagementSection[] = [
  "overview",
  "reports",
  "views",
  "datasources",
  "users",
  "settings",
];

export function ManagementPage({
  initialSection = "overview",
  initialReportTab = "authoring",
}: {
  initialSection?: ManagementSection;
  initialReportTab?: ReportListTab;
}) {
  const { t } = useI18n();
  const {
    loading: workspaceLoading,
    error: workspaceError,
    resolved: workspaceResolved,
    workspaceId,
    workspaceName,
    users,
    selectedUserId,
    setSelectedUserId,
    verbose,
    setVerbose,
  } = useWorkspaceContext();
  const workspaceReady = workspaceResolved && Boolean(workspaceId && selectedUserId);
  const {
    section,
    collections,
    overviewStats,
    recentDashboards,
    actionMessage,
    searchByMode,
    setSearchByMode,
    activeCollection,
    activeCollectionMeta,
    filteredDashboards,
    handleSectionChange,
    handleCreate,
    handleDelete,
    handleUnpublish,
    createInFlight,
  } = useManagementController({
    workspaceId,
    userId: selectedUserId,
    enabled: workspaceReady,
    initialSection,
    initialReportTab,
  });
  return (
    <div className={styles.shell}>
      <div className={styles.workspace}>
        <aside
          className={styles.sidebar}
          aria-label={t("management.aria.workspace")}
        >
          <div className={styles.sidebarBrand}>
            <div className={styles.brandLockup}>
              <div className={styles.brandMark} aria-hidden>
                R
              </div>
              <div>
                <h1 className={styles.sidebarTitle}>{t("management.sidebar.title")}</h1>
                <p className={styles.sidebarCopy}>{workspaceName || t("management.sidebar.copy")}</p>
              </div>
            </div>
          </div>

          <nav className={styles.modeList} aria-label={t("management.aria.primaryNav")}>
            <div className={styles.navGroupLabel}>{t("management.nav.group")}</div>
            {MANAGEMENT_NAV.map((entry) => (
              <Link
                key={entry}
                href={entry === "overview" ? "/" : `/?section=${entry}`}
                aria-current={section === entry ? "page" : undefined}
                className={`${styles.modeButton} ${
                  section === entry ? styles.modeButtonActive : ""
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
                  handleSectionChange(entry);
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

          <LocaleSwitcher />
        </aside>

        <div className={styles.mainColumn}>
          <main
            className={styles.content}
          >
            {section === "overview" ? (
              <ManagementOverviewPanel
                actionMessage={actionMessage}
                overviewStats={overviewStats}
                recentDashboards={recentDashboards}
                userCount={users.length}
              />
            ) : section === "datasources" ? (
              <DatasourcePanel actionMessage={actionMessage} />
            ) : section === "users" ? (
              <UsersPanel
                users={users}
                selectedUserId={selectedUserId}
                loading={workspaceLoading}
                error={workspaceError}
                onSelectUser={setSelectedUserId}
              />
            ) : section === "settings" ? (
              <SettingsPanel
                verbose={verbose}
                loading={workspaceLoading}
                error={workspaceError}
                onToggleVerbose={(nextVerbose) => {
                  void setVerbose(nextVerbose);
                }}
              />
            ) : (
              <DashboardListPanel
                section={section === "views" ? "viewer" : "authoring"}
                workspaceId={workspaceId}
                actionMessage={actionMessage}
                activeCollection={
                  activeCollection ?? { dashboards: [], status: "idle", message: "" }
                }
                activeCollectionMeta={activeCollectionMeta}
                collections={collections}
                users={users}
                searchValue={
                  searchByMode[section === "views" ? "viewer" : "authoring"]
                }
                filteredDashboards={filteredDashboards}
                onSearchChange={(value) => {
                  const mode = section === "views" ? "viewer" : "authoring";
                  setSearchByMode((current) => ({
                    ...current,
                    [mode]: value,
                  }));
                }}
                createInFlight={createInFlight}
                onCreate={() => void handleCreate()}
                onDeleteDashboard={(dashboardId) =>
                  void (section === "views"
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
