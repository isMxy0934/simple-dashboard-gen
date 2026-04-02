"use client";

import Link from "next/link";
import type { DashboardListMode, DashboardSnapshotSource, DashboardSummary } from "../../../contracts";
import { useI18n } from "../../shared/i18n/i18n-context";
import { formatCollectionMeta } from "../format-collection-meta";
import styles from "./management.module.css";
import type { CollectionMeta, DashboardCollectionState } from "../state";

interface DashboardListPanelProps {
  section: DashboardListMode;
  actionMessage: string;
  activeCollection: DashboardCollectionState;
  activeCollectionMeta: CollectionMeta | null;
  searchValue: string;
  filteredDashboards: DashboardSummary[];
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  createInFlight?: boolean;
  onDeleteDashboard: (dashboardId: string) => void;
}

export function DashboardListPanel({
  section,
  actionMessage,
  activeCollection,
  activeCollectionMeta,
  searchValue,
  filteredDashboards,
  onSearchChange,
  onCreate,
  createInFlight = false,
  onDeleteDashboard,
}: DashboardListPanelProps) {
  const { t, locale } = useI18n();
  const metaLine = formatCollectionMeta(activeCollectionMeta, t);
  const showToolbarNote =
    Boolean(actionMessage.trim()) || activeCollection.status === "error";

  return (
    <section className={styles.listPanel}>
      {showToolbarNote ? (
        <div className={styles.listHeaderBanner} role="status">
          <span className={styles.listMetaNote}>
            {actionMessage || metaLine || activeCollection.message}
          </span>
        </div>
      ) : null}

      <div className={styles.listHeader}>
        <h2 className={styles.listTitle}>
          {section === "authoring"
            ? t("management.list.dashboardsTitle")
            : t("management.list.snapshotsTitle")}
        </h2>

        <div className={styles.listToolbar}>
          <input
            type="search"
            className={styles.searchInput}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={
              section === "authoring"
                ? t("management.list.searchAuthoring")
                : t("management.list.searchViewer")
            }
          />
          {section === "authoring" ? (
            <button
              type="button"
              className={styles.primaryAction}
              disabled={createInFlight}
              onClick={onCreate}
            >
              {createInFlight ? t("management.action.creating") : t("management.list.new")}
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.listViewport}>
        <div className={styles.listHeaderRow}>
          <span>{t("management.list.colName")}</span>
          <span>{t("management.list.colStatus")}</span>
          <span>{t("management.list.colUpdated")}</span>
          <span className={styles.listHeaderRowActions}>{t("management.list.colActions")}</span>
        </div>

        <div className={styles.listRows}>
          {activeCollection.dashboards.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>
                {activeCollection.status === "loading"
                  ? t("management.list.loading")
                  : section === "authoring"
                    ? t("management.list.emptyAuthoring")
                    : t("management.list.emptyViewer")}
              </strong>
              <p>
                {section === "authoring"
                  ? t("management.list.hintAuthoring")
                  : t("management.list.hintViewer")}
              </p>
            </div>
          ) : filteredDashboards.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>{t("management.list.noMatchTitle")}</strong>
              <p>{t("management.list.noMatchHint")}</p>
            </div>
          ) : (
            filteredDashboards.map((dashboard) => (
              <article key={dashboard.dashboard_id} className={styles.listRow}>
                <div className={styles.listRowMain}>
                  <strong>{dashboard.name}</strong>
                  <span>
                    {dashboard.description || t("common.noDescription")}
                  </span>
                </div>
                <div className={styles.listRowStatus}>
                  <span className={styles.metaChip}>v{dashboard.latest_version}</span>
                  <span
                    className={`${styles.metaChip} ${
                      dashboard.snapshot_source === "published"
                        ? styles.metaChipSuccess
                        : section === "viewer"
                          ? styles.metaChipWarning
                          : ""
                    }`}
                  >
                    {labelSnapshotSource(section, dashboard.snapshot_source, t)}
                  </span>
                </div>
                <span className={styles.updatedAt}>
                  {formatTimestamp(dashboard.updated_at, locale)}
                </span>
                <div className={styles.actions}>
                  {section === "authoring" ? (
                    <Link
                      href={`/authoring/${dashboard.dashboard_id}`}
                      className={styles.secondaryAction}
                    >
                      {t("management.list.edit")}
                    </Link>
                  ) : (
                    <Link
                      href={`/${section}/${dashboard.dashboard_id}`}
                      className={styles.secondaryAction}
                    >
                      {t("management.list.view")}
                    </Link>
                  )}
                  <button
                    type="button"
                    className={styles.dangerAction}
                    onClick={() => {
                      if (!window.confirm(t("management.action.deleteConfirm"))) {
                        return;
                      }
                      onDeleteDashboard(dashboard.dashboard_id);
                    }}
                  >
                    {t("management.list.delete")}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function labelSnapshotSource(
  mode: DashboardListMode,
  source: DashboardSnapshotSource,
  t: (key: string) => string,
) {
  if (source === "published") {
    return t("management.list.snapshotPublished");
  }

  return mode === "viewer"
    ? t("management.list.snapshotUnpublished")
    : t("management.list.snapshotDraft");
}

function formatTimestamp(timestamp: string, locale: string) {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
