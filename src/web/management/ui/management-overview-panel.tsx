"use client";

import type { DashboardSummary } from "../../../contracts";
import { useI18n } from "../../i18n/i18n-context";
import styles from "./management.module.css";
import type { OverviewStats } from "../state";

interface ManagementOverviewPanelProps {
  actionMessage: string;
  overviewStats: OverviewStats;
  recentDashboards: DashboardSummary[];
}

export function ManagementOverviewPanel({
  actionMessage,
  overviewStats,
  recentDashboards,
}: ManagementOverviewPanelProps) {
  const { t, locale } = useI18n();

  return (
    <div className={styles.overviewGrid}>
      <header className={styles.sectionHeader}>
        <h2 className={styles.pageTitle}>{t("management.overview.title")}</h2>
        {actionMessage.trim() ? (
          <p className={styles.sectionHeaderNote}>{actionMessage}</p>
        ) : null}
      </header>

      <div className={styles.overviewBody}>
        <section className={styles.overviewFeed} aria-labelledby="recent-updated-heading">
          <div className={styles.overviewPanel}>
            <div className={styles.panelHeading}>
              <h3 id="recent-updated-heading">{t("management.overview.recentTitle")}</h3>
            </div>
            <div className={styles.list}>
              {recentDashboards.length === 0 ? (
                <div className={styles.emptyState}>
                  <strong>{t("management.overview.emptyTitle")}</strong>
                  <p>{t("management.overview.emptyHint")}</p>
                </div>
              ) : (
                recentDashboards.map((dashboard) => (
                  <article key={dashboard.dashboard_id} className={styles.cardCompact}>
                    <div className={styles.cardCompactMain}>
                      <h4>{dashboard.name}</h4>
                      <p>{dashboard.description || t("common.noDescription")}</p>
                    </div>
                    <span className={styles.updatedAt}>
                      {formatTimestamp(dashboard.updated_at, locale)}
                    </span>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <aside className={styles.overviewRail} aria-label={t("management.aria.metrics")}>
          <div className={styles.statGrid}>
            <article className={styles.statCard}>
              <div className={styles.statTop}>
                <span className={styles.statLabel}>{t("management.overview.statDashboards")}</span>
                <span className={styles.statMeta}>{t("management.overview.statMetaInventory")}</span>
              </div>
              <strong className={styles.statValue}>{overviewStats.total}</strong>
              <p className={styles.statNote}>{t("management.overview.statNoteTotal")}</p>
              <div className={styles.statFoot}>
                <span>{t("management.overview.statRecent")}</span>
                <strong>{overviewStats.recent}</strong>
              </div>
            </article>
            <article className={styles.statCard}>
              <div className={styles.statTop}>
                <span className={styles.statLabel}>{t("management.overview.statDrafts")}</span>
                <span className={styles.statMeta}>{t("management.overview.statMetaPipeline")}</span>
              </div>
              <strong className={styles.statValue}>{overviewStats.drafts}</strong>
              <p className={styles.statNote}>{t("management.overview.statNoteDrafts")}</p>
              <div className={styles.statFoot}>
                <span>{t("management.overview.statDraftShare")}</span>
                <strong>{overviewStats.draftCoverage}%</strong>
              </div>
            </article>
            <article className={styles.statCard}>
              <div className={styles.statTop}>
                <span className={styles.statLabel}>{t("management.overview.statPublished")}</span>
                <span className={styles.statMeta}>{t("management.overview.statMetaSnapshot")}</span>
              </div>
              <strong className={styles.statValue}>{overviewStats.published}</strong>
              <p className={styles.statNote}>{t("management.overview.statNotePublished")}</p>
              <div className={styles.statFoot}>
                <span>{t("management.overview.statPending")}</span>
                <strong>{overviewStats.pendingRelease}</strong>
              </div>
            </article>
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: string, locale: string) {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
