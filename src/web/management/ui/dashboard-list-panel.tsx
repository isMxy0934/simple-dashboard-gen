"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DashboardListMode, DashboardSnapshotSource, DashboardSummary } from "../../../contracts";
import type { WorkspaceMember } from "@/contracts";
import { useI18n } from "../../i18n/i18n-context";
import { formatReportDisplayName } from "../../i18n/report-display-name";
import styles from "./management.module.css";
import type { DashboardCollectionState, DashboardCollections } from "../state";

interface DashboardListPanelProps {
  section: DashboardListMode;
  workspaceId: string;
  actionMessage: string;
  activeCollection: DashboardCollectionState;
  collections: DashboardCollections;
  users: WorkspaceMember[];
  searchValue: string;
  filteredDashboards: DashboardSummary[];
  onSearchChange: (value: string) => void;
  onCreate: () => void;
  createInFlight?: boolean;
  onDeleteDashboard: (dashboardId: string) => void;
}

export function DashboardListPanel({
  section,
  workspaceId,
  actionMessage,
  activeCollection,
  collections,
  users,
  searchValue,
  filteredDashboards,
  onSearchChange,
  onCreate,
  createInFlight = false,
  onDeleteDashboard,
}: DashboardListPanelProps) {
  const { t, locale } = useI18n();
  const [pendingConfirmId, setPendingConfirmId] = useState<string | null>(null);
  const showToolbarNote =
    Boolean(actionMessage.trim()) || activeCollection.status === "error";
  const isViewsSection = section === "viewer";
  const draftCount = collections.authoring.dashboards.length;
  const publishedCount = collections.viewer.dashboards.filter(
    (dashboard) => dashboard.snapshot_source === "published",
  ).length;
  const userNameById = useMemo(
    () => new Map(users.map((user) => [user.user_id, user.name])),
    [users],
  );

  return (
    <section className={styles.pageCard}>
      {showToolbarNote ? (
        <div className={styles.listHeaderBanner} role="status">
          <span className={styles.listMetaNote}>
            {actionMessage || activeCollection.message}
          </span>
        </div>
      ) : null}

      <header className={styles.pageHead}>
        <div className={styles.pageTitleInline}>
          <h2>
            {isViewsSection
              ? t("management.views.title")
              : t("management.list.reportsTitle")}
          </h2>
          <span>
            {isViewsSection
              ? t("management.views.description")
              : t("management.list.reportsDescription")}
          </span>
        </div>
        <div className={styles.chipRow}>
          {!isViewsSection ? (
            <span className={`${styles.chip} ${styles.chipGold}`}>
              {t("management.overview.draftCount", { count: draftCount })}
            </span>
          ) : null}
          <span className={`${styles.chip} ${styles.chipTeal}`}>
            {t("management.overview.liveCount", { count: publishedCount })}
          </span>
          {!isViewsSection ? (
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
      </header>

      <div className={styles.tableSection}>
        <div className={styles.reportToolbar}>
          <input
            type="search"
            name={isViewsSection ? "published-view-search" : "draft-report-search"}
            aria-label={
              isViewsSection
                ? t("management.views.searchAria")
                : t("management.list.searchAuthoring")
            }
            autoComplete="off"
            className={styles.searchInput}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={
              isViewsSection
                ? t("management.views.searchPlaceholder")
                : t("management.list.searchReports")
            }
          />
        </div>

        <div className={`${styles.listViewport} ${styles.reportsTable}`}>
          <div className={styles.listHeaderRow}>
            <span>{t("management.list.colReport")}</span>
            <span>{t("management.list.colOwner")}</span>
            <span>{t("management.list.colStage")}</span>
            <span>{t("management.list.colData")}</span>
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
                  <div className={styles.rowTitle}>
                    <span className={styles.docMark}>{createInitials(dashboard.name)}</span>
                    <span>
                      <strong>{formatReportDisplayName(dashboard.name)}</strong>
                      <span>
                        {dashboard.description || t("common.noDescription")} · v{dashboard.latest_version}
                      </span>
                    </span>
                  </div>
                  <span>
                    {dashboard.last_saved_by
                      ? userNameById.get(dashboard.last_saved_by) || dashboard.last_saved_by
                      : t("management.list.workspaceOwner")}
                  </span>
                  <span
                    className={`${styles.chip} ${
                      dashboard.snapshot_source === "published"
                        ? styles.chipTeal
                        : section === "viewer"
                          ? styles.chipRose
                          : styles.chipGold
                    }`}
                  >
                    {labelSnapshotSource(section, dashboard.snapshot_source, t)}
                  </span>
                  <span className={styles.tableMuted}>
                    {formatTimestamp(dashboard.updated_at, locale)}
                  </span>
                  <div className={styles.actions}>
                    {pendingConfirmId === dashboard.dashboard_id ? (
                      <>
                        <span className={styles.confirmLabel}>
                          {section === "viewer"
                            ? t("management.action.unpublishConfirm")
                            : t("management.action.deleteConfirm")}
                        </span>
                        <button
                          type="button"
                          className={styles.secondaryAction}
                          onClick={() => setPendingConfirmId(null)}
                        >
                          {t("management.action.cancelDelete")}
                        </button>
                        <button
                          type="button"
                          className={styles.dangerAction}
                          onClick={() => {
                            setPendingConfirmId(null);
                            onDeleteDashboard(dashboard.dashboard_id);
                          }}
                        >
                          {section === "viewer"
                            ? t("management.action.confirmUnpublish")
                            : t("management.action.confirmDelete")}
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          href={`/authoring/${dashboard.dashboard_id}`}
                          className={styles.secondaryAction}
                        >
                          {t("management.list.edit")}
                        </Link>
                        {section === "viewer" ? (
                          <Link
                            href={`/viewer/${dashboard.dashboard_id}?workspaceId=${encodeURIComponent(workspaceId)}`}
                            className={styles.secondaryAction}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("management.list.view")}
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className={styles.dangerAction}
                          onClick={() => setPendingConfirmId(dashboard.dashboard_id)}
                        >
                          {section === "viewer"
                            ? t("management.list.unpublish")
                            : t("management.list.delete")}
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
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

function createInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "R";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}
