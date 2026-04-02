"use client";

import styles from "./management.module.css";
import { CreatorHost } from "./creator-host";
import { DashboardListPanel } from "./dashboard-list-panel";
import { LocaleSwitcher } from "./locale-switcher";
import { ManagementOverviewPanel } from "./management-overview-panel";
import { useManagementController } from "../hooks/use-management-controller";
import type { ManagementSection } from "../state";
import { useI18n } from "../../i18n/i18n-context";

const NAV_KEYS: Record<ManagementSection, string> = {
  overview: "management.nav.overview",
  authoring: "management.nav.authoring",
  viewer: "management.nav.viewer",
};

export function ManagementPage() {
  const { t } = useI18n();
  const {
    section,
    overviewStats,
    recentDashboards,
    actionMessage,
    activeAuthoringDashboardId,
    sidebarCollapsed,
    searchByMode,
    setSearchByMode,
    activeCollection,
    activeCollectionMeta,
    filteredDashboards,
    setSidebarCollapsed,
    handleSectionChange,
    handleCreate,
    handleDelete,
    reloadCollections,
    createInFlight,
  } = useManagementController();

  return (
    <div className={styles.shell}>
      <div
        className={`${styles.workspace} ${
          sidebarCollapsed ? styles.workspaceSidebarCollapsed : ""
        }`}
      >
        <aside
          className={`${styles.sidebar} ${
            sidebarCollapsed ? styles.sidebarCollapsed : ""
          }`}
          aria-label={t("management.aria.workspace")}
        >
          <div className={styles.sidebarBrand}>
            <div className={styles.brandMark} aria-hidden />
            <div className={styles.brandEyebrow}>{t("management.sidebar.eyebrow")}</div>
            <h1 className={styles.sidebarTitle}>{t("management.sidebar.title")}</h1>
            <p className={styles.sidebarCopy}>{t("management.sidebar.copy")}</p>
          </div>

          <nav className={styles.modeList} aria-label={t("management.aria.primaryNav")}>
            <div className={styles.navGroupLabel}>{t("management.nav.group")}</div>
            {(["overview", "authoring", "viewer"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={`${styles.modeButton} ${
                  section === entry ? styles.modeButtonActive : ""
                }`}
                onClick={() => handleSectionChange(entry)}
              >
                <span className={styles.modeButtonLabel}>{t(NAV_KEYS[entry])}</span>
              </button>
            ))}
          </nav>

          <LocaleSwitcher />
        </aside>

        <div className={styles.mainColumn}>
          <main
            className={`${styles.content} ${
              section === "authoring" && activeAuthoringDashboardId
                ? styles.contentCreatorMode
                : ""
            }`}
          >
            {section === "overview" ? (
              <ManagementOverviewPanel
                actionMessage={actionMessage}
                overviewStats={overviewStats}
                recentDashboards={recentDashboards}
              />
            ) : section === "authoring" && activeAuthoringDashboardId ? (
              <CreatorHost
                dashboardId={activeAuthoringDashboardId}
                sidebarCollapsed={sidebarCollapsed}
                onSaved={() => {
                  void reloadCollections();
                }}
                onToggleEmbeddedMenu={() => {
                  setSidebarCollapsed((current) => !current);
                }}
              />
            ) : (
              <DashboardListPanel
                section={section}
                actionMessage={actionMessage}
                activeCollection={
                  activeCollection ?? { dashboards: [], status: "idle", message: "" }
                }
                activeCollectionMeta={activeCollectionMeta}
                searchValue={searchByMode[section]}
                filteredDashboards={filteredDashboards}
                onSearchChange={(value) => {
                  setSearchByMode((current) => ({
                    ...current,
                    [section]: value,
                  }));
                }}
                createInFlight={createInFlight}
                onCreate={() => void handleCreate()}
                onDeleteDashboard={(dashboardId) => void handleDelete(dashboardId)}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
