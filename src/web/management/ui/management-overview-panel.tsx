"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DashboardSummary } from "../../../contracts";
import { useI18n } from "../../i18n/i18n-context";
import { fetchManagementDatasources } from "../api/datasource-api";
import styles from "./management.module.css";
import type { OverviewStats } from "../state";

interface ManagementOverviewPanelProps {
  actionMessage: string;
  overviewStats: OverviewStats;
  recentDashboards: DashboardSummary[];
  userCount: number;
}

export function ManagementOverviewPanel({
  actionMessage,
  overviewStats,
  recentDashboards,
  userCount,
}: ManagementOverviewPanelProps) {
  const { t, locale } = useI18n();
  const unpublishedCount = overviewStats.pendingRelease;
  const [datasourceStatus, setDatasourceStatus] = useState<
    "loading" | "idle" | "error"
  >("loading");
  const [datasourceCount, setDatasourceCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDatasourceStatus("loading");

    void fetchManagementDatasources()
      .then((datasources) => {
        if (!cancelled) {
          setDatasourceCount(datasources.length);
          setDatasourceStatus("idle");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDatasourceCount(0);
          setDatasourceStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const summaryCards = useMemo(
    () => [
      {
        label: t("management.overview.draftReports"),
        value: overviewStats.drafts,
        note: t("management.navHint.reports"),
      },
      {
        label: t("management.overview.publishedViews"),
        value: overviewStats.published,
        note: t("management.navHint.views"),
      },
      {
        label: t("management.overview.dataSources"),
        value:
          datasourceStatus === "loading"
            ? t("common.loading")
            : datasourceStatus === "error"
              ? t("management.common.notConnected")
              : datasourceCount,
        note: t("management.navHint.datasources"),
      },
      {
        label: t("management.overview.members"),
        value: userCount,
        note: t("management.navHint.users"),
      },
      {
        label: t("management.overview.pendingRelease"),
        value: unpublishedCount,
        note: t("management.overview.unpublishedHint"),
      },
    ],
    [datasourceCount, datasourceStatus, overviewStats.drafts, overviewStats.published, t, unpublishedCount, userCount],
  );

  const hasDatasourceAction =
    datasourceStatus === "idle" && datasourceCount === 0;
  const hasNextActions = unpublishedCount > 0 || hasDatasourceAction;

  return (
    <section className={styles.pageCard}>
      <header className={styles.pageHead}>
        <div className={styles.pageTitleInline}>
          <h2>{t("management.overview.title")}</h2>
          <span>
            {actionMessage.trim() || t("management.overview.hint")}
          </span>
        </div>
      </header>

      <div className={styles.overviewV6}>
        <section className={styles.panelV6} aria-labelledby="overview-status-heading">
          <div className={styles.panelHeadV6}>
            <strong id="overview-status-heading">
              {t("management.overview.statusSummary")}
            </strong>
            <span className={styles.chip}>{t("management.common.realData")}</span>
          </div>
          <div className={styles.overviewMetricGrid}>
            {summaryCards.map((card) => (
              <article key={card.label} className={styles.overviewMetricCard}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.note}</small>
              </article>
            ))}
          </div>
        </section>

        <div className={styles.overviewMain}>
          <section className={styles.panelV6} aria-labelledby="attention-heading">
            <div className={styles.panelHeadV6}>
              <strong id="attention-heading">{t("management.overview.nextActions")}</strong>
              <span className={`${styles.chip} ${hasNextActions ? styles.chipGold : styles.chipTeal}`}>
                {hasNextActions
                  ? t("management.overview.actionCount", {
                      count: (unpublishedCount > 0 ? 1 : 0) + (hasDatasourceAction ? 1 : 0),
                    })
                  : t("management.overview.noKnownIssues")}
              </span>
            </div>
            <div className={`${styles.actionList} ${styles.actionListPrimary}`}>
              {hasNextActions ? (
                <>
                  {unpublishedCount > 0 ? (
                    <article className={styles.actionRow}>
                      <span className={`${styles.docMark} ${styles.docMarkGold}`}>DR</span>
                      <span className={styles.rowCopy}>
                        <strong>{t("management.overview.unpublishedTitle")}</strong>
                        <span>{t("management.overview.unpublishedHint")}</span>
                      </span>
                      <Link
                        className={`${styles.secondaryAction} ${styles.actionLink}`}
                        href="/?section=reports"
                      >
                        {t("management.overview.openReports")}
                      </Link>
                    </article>
                  ) : null}
                  {hasDatasourceAction ? (
                    <article className={styles.actionRow}>
                      <span className={`${styles.docMark} ${styles.docMarkTeal}`}>DS</span>
                      <span className={styles.rowCopy}>
                        <strong>{t("management.overview.connectDatasourceTitle")}</strong>
                        <span>{t("management.overview.connectDatasourceHint")}</span>
                      </span>
                      <Link
                        className={`${styles.secondaryAction} ${styles.actionLink}`}
                        href="/?section=datasources"
                      >
                        {t("management.overview.openDataSources")}
                      </Link>
                    </article>
                  ) : null}
                </>
              ) : (
                <div className={styles.emptyState}>
                  <strong>{t("management.overview.noKnownIssues")}</strong>
                  <p>{t("management.overview.noKnownIssuesHint")}</p>
                </div>
              )}
            </div>
          </section>

          <section className={styles.panelV6} aria-labelledby="recent-activity-heading">
            <div className={styles.panelHeadV6}>
              <strong id="recent-activity-heading">
                {t("management.overview.recentActivity")}
              </strong>
              <Link className={styles.secondaryAction} href="/?section=reports">
                {t("management.overview.openReports")}
              </Link>
            </div>
            <div className={styles.recentList}>
              {recentDashboards.length === 0 ? (
                <div className={styles.emptyState}>
                  <strong>{t("management.overview.emptyTitle")}</strong>
                  <p>{t("management.overview.emptyHint")}</p>
                </div>
              ) : (
                recentDashboards.slice(0, 5).map((dashboard) => (
                  <article key={dashboard.dashboard_id} className={styles.recentRow}>
                    <span className={styles.rowCopy}>
                      <strong>{formatReportName(dashboard.name)}</strong>
                      <span>
                        {formatSnapshotSource(dashboard.snapshot_source, t)} · v{dashboard.latest_version}
                      </span>
                    </span>
                    <time dateTime={dashboard.updated_at}>
                      {formatTime(dashboard.updated_at, locale)}
                    </time>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function formatTime(timestamp: string, locale: string) {
  const tag = locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(tag, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatReportName(name: string) {
  return name.replace(/\bDashboard\b/gi, "Report");
}

function formatSnapshotSource(
  source: DashboardSummary["snapshot_source"],
  t: ReturnType<typeof useI18n>["t"],
) {
  return source === "published"
    ? t("management.list.snapshotPublished")
    : source === "draft"
      ? t("management.list.snapshotDraft")
      : t("management.list.snapshotUnpublished");
}
