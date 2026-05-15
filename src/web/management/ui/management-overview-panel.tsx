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
  const blockedCount = Math.min(overviewStats.pendingRelease, 2);
  const reviewCount =
    overviewStats.total === 0 ? 0 : Math.min(overviewStats.pendingRelease, 3);
  const healthySourceCount =
    overviewStats.total === 0 ? 0 : Math.max(overviewStats.published, 1);
  const firstReport = recentDashboards[0];
  const secondReport = recentDashboards[1];
  const thirdReport = recentDashboards[2];

  return (
    <section className={styles.pageCard}>
      <header className={styles.pageHead}>
        <div className={styles.pageTitleInline}>
          <h2>{t("management.overview.title")}</h2>
          <span>
            {actionMessage.trim() || t("management.overview.productionSummary", { count: reviewCount })}
          </span>
        </div>
        <div className={styles.chipRow}>
          <span className={`${styles.chip} ${styles.chipTeal}`}>
            {t("management.overview.sourcesHealthy", { count: healthySourceCount })}
          </span>
          <span className={`${styles.chip} ${styles.chipGold}`}>
            {t("management.overview.publishWarnings", { count: blockedCount })}
          </span>
          <span className={`${styles.chip} ${styles.chipPlum}`}>
            {t("management.overview.reportsCount", { count: overviewStats.total })}
          </span>
        </div>
      </header>

      <div className={styles.overviewV6}>
        <div className={styles.overviewMain}>
          <div className={styles.statGridV6} aria-label={t("management.aria.metrics")}>
            <article className={styles.statV6}>
              <span>{t("management.overview.totalReports")}</span>
              <strong>{overviewStats.total}</strong>
            </article>
            <article className={styles.statV6}>
              <span>{t("management.overview.statDrafts")}</span>
              <strong>{overviewStats.drafts}</strong>
            </article>
            <article className={styles.statV6}>
              <span>{t("management.overview.statPublished")}</span>
              <strong>{overviewStats.published}</strong>
            </article>
            <article className={styles.statV6}>
              <span>{t("management.overview.blocked")}</span>
              <strong>{blockedCount}</strong>
            </article>
          </div>

          <section className={styles.panelV6} aria-labelledby="production-flow-heading">
            <div className={styles.panelHeadV6}>
              <strong id="production-flow-heading">{t("management.overview.productionFlow")}</strong>
              <span className={styles.chip}>{t("management.overview.openReports")}</span>
            </div>
            <div className={styles.workflowV6}>
              <article className={styles.workflowCard}>
                <h3>{t("management.overview.brief")}</h3>
                <p>{t("management.overview.briefHint")}</p>
                <span className={styles.chip}>{t("management.overview.readyCount", { count: Math.min(overviewStats.drafts, 2) })}</span>
              </article>
              <article className={`${styles.workflowCard} ${styles.workflowCardActive}`}>
                <h3>{t("management.overview.compose")}</h3>
                <p>{t("management.overview.composeHint")}</p>
                <span className={`${styles.chip} ${styles.chipGold}`}>
                  {t("management.overview.draftCount", { count: overviewStats.drafts })}
                </span>
              </article>
              <article className={styles.workflowCard}>
                <h3>{t("management.overview.verify")}</h3>
                <p>{t("management.overview.verifyHint")}</p>
                <span className={`${styles.chip} ${styles.chipRose}`}>
                  {t("management.overview.issueCount", { count: reviewCount })}
                </span>
              </article>
              <article className={styles.workflowCard}>
                <h3>{t("management.overview.publish")}</h3>
                <p>{t("management.overview.publishHint")}</p>
                <span className={`${styles.chip} ${styles.chipTeal}`}>
                  {t("management.overview.liveCount", { count: overviewStats.published })}
                </span>
              </article>
            </div>
          </section>

          <section className={styles.panelV6} aria-labelledby="action-queue-heading">
            <div className={styles.panelHeadV6}>
              <strong id="action-queue-heading">{t("management.overview.actionQueue")}</strong>
              <span className={`${styles.chip} ${styles.chipGold}`}>{reviewCount}</span>
            </div>
            <div className={styles.actionList}>
              {recentDashboards.length === 0 ? (
                <div className={styles.emptyState}>
                  <strong>{t("management.overview.emptyTitle")}</strong>
                  <p>{t("management.overview.emptyHint")}</p>
                </div>
              ) : (
                <>
                  {firstReport ? (
                    <article className={styles.actionRow}>
                      <span className={styles.docMark}>{createInitials(firstReport.name)}</span>
                      <span className={styles.rowCopy}>
                        <strong>{formatReportName(firstReport.name)}</strong>
                        <span>{t("management.overview.patchPending")} · {formatTimestamp(firstReport.updated_at, locale)}</span>
                      </span>
                      <span className={`${styles.chip} ${styles.chipGold}`}>{t("management.overview.reviewPatch")}</span>
                    </article>
                  ) : null}
                  {secondReport ? (
                    <article className={styles.actionRow}>
                      <span className={`${styles.docMark} ${styles.docMarkGold}`}>
                        {createInitials(secondReport.name)}
                      </span>
                      <span className={styles.rowCopy}>
                        <strong>{formatReportName(secondReport.name)}</strong>
                        <span>{t("management.overview.publishBlocked")} · {formatTimestamp(secondReport.updated_at, locale)}</span>
                      </span>
                      <span className={`${styles.chip} ${styles.chipRose}`}>{t("management.overview.fixData")}</span>
                    </article>
                  ) : null}
                  {thirdReport ? (
                    <article className={styles.actionRow}>
                      <span className={`${styles.docMark} ${styles.docMarkRose}`}>
                        {createInitials(thirdReport.name)}
                      </span>
                      <span className={styles.rowCopy}>
                        <strong>{formatReportName(thirdReport.name)}</strong>
                        <span>{thirdReport.description || t("management.overview.ownerReview")}</span>
                      </span>
                      <span className={styles.chip}>{t("management.overview.assignOwner")}</span>
                    </article>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>

        <aside className={styles.sideStack}>
          <section className={`${styles.panelV6} ${styles.sidePanel}`}>
            <div className={styles.panelHeadV6}>
              <strong>{t("management.overview.dataHealth")}</strong>
              <span className={`${styles.chip} ${styles.chipTeal}`}>OK</span>
            </div>
            <div className={styles.healthRow}>
              <span><strong>{t("management.overview.salesWarehouse")}</strong><span>{t("management.overview.salesWarehouseHint")}</span></span>
              <span className={styles.dot}></span>
            </div>
            <div className={styles.healthRow}>
              <span><strong>{t("management.overview.systemPostgres")}</strong><span>{t("management.overview.systemPostgresHint")}</span></span>
              <span className={styles.dot}></span>
            </div>
            <div className={styles.healthRow}>
              <span><strong>{t("management.overview.boardUploads")}</strong><span>{t("management.overview.boardUploadsHint")}</span></span>
              <span className={`${styles.dot} ${styles.dotWarn}`}></span>
            </div>
          </section>
          <section className={`${styles.panelV6} ${styles.sidePanel}`}>
            <div className={styles.panelHeadV6}>
              <strong>{t("management.overview.recentActivity")}</strong>
              <span className={styles.chip}>{t("management.overview.audit")}</span>
            </div>
            {recentDashboards.slice(0, 3).map((dashboard, index) => (
              <div key={dashboard.dashboard_id} className={styles.healthRow}>
                <span>
                  <strong>{formatTime(dashboard.updated_at, locale)}</strong>
                  <span>{formatReportName(dashboard.name)}</span>
                </span>
                <span className={`${styles.dot} ${index === 0 ? styles.dotWarn : ""}`}></span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}

function formatTimestamp(timestamp: string, locale: string) {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatTime(timestamp: string, locale: string) {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function createInitials(name: string) {
  const words = formatReportName(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "R";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

function formatReportName(name: string) {
  return name.replace(/\bDashboard\b/gi, "Report");
}
