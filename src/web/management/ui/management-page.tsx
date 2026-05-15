"use client";

import styles from "./management.module.css";
import { DashboardListPanel } from "./dashboard-list-panel";
import { LocaleSwitcher } from "./locale-switcher";
import { ManagementOverviewPanel } from "./management-overview-panel";
import { DatasourcePanel } from "./datasource-panel";
import { SettingsPanel } from "./settings-panel";
import { useManagementController } from "../hooks/use-management-controller";
import type { ManagementSection, ReportListTab } from "../state";
import { useI18n } from "../../i18n/i18n-context";
import { useWorkspaceContext } from "../../workspace";

const NAV_KEYS: Record<ManagementSection, string> = {
  overview: "management.nav.overview",
  reports: "management.nav.reports",
  datasources: "management.nav.datasources",
  settings: "management.nav.settings",
};

const NAV_INITIALS: Record<ManagementSection, string> = {
  overview: "O",
  reports: "R",
  datasources: "D",
  settings: "S",
};

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
    reportTab,
    setReportTab,
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
            {(["overview", "reports", "datasources", "settings"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={`${styles.modeButton} ${
                  section === entry ? styles.modeButtonActive : ""
                }`}
                onClick={() => handleSectionChange(entry)}
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
              </button>
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
              />
            ) : section === "datasources" ? (
              <DatasourcePanel actionMessage={actionMessage} />
            ) : section === "settings" ? (
              <SettingsPanel
                workspaceName={workspaceName}
                users={users}
                selectedUserId={selectedUserId}
                verbose={verbose}
                loading={workspaceLoading}
                error={workspaceError}
                onSelectUser={setSelectedUserId}
                onToggleVerbose={(nextVerbose) => {
                  void setVerbose(nextVerbose);
                }}
              />
            ) : (
              <DashboardListPanel
                section={reportTab}
                workspaceId={workspaceId}
                actionMessage={actionMessage}
                activeCollection={
                  activeCollection ?? { dashboards: [], status: "idle", message: "" }
                }
                activeCollectionMeta={activeCollectionMeta}
                collections={collections}
                users={users}
                searchValue={searchByMode[reportTab]}
                filteredDashboards={filteredDashboards}
                onReportTabChange={setReportTab}
                onSearchChange={(value) => {
                  setSearchByMode((current) => ({
                    ...current,
                    [reportTab]: value,
                  }));
                }}
                createInFlight={createInFlight}
                onCreate={() => void handleCreate()}
                onDeleteDashboard={(dashboardId) =>
                  void (reportTab === "viewer"
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
