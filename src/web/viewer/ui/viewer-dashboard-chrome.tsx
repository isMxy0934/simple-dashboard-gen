"use client";

import type { ReactNode } from "react";
import type { DashboardDocument, JsonValue } from "../../../contracts";
import type { TemplateRuntimeDefinition } from "../../../presentation/dashboard/runtime";
import type { TranslateFn } from "../../i18n";
import {
  formatViewerTimestamp,
  labelForRange,
  labelForViewMode,
  viewerStatusLabel,
  type FILTERS,
  type ViewMode,
} from "../state/viewer-state";
import { groupFiltersForViewer } from "../template-runtime/filter-placement";
import { ViewModeControls, ViewerFilterControls } from "./viewer-filter-controls";
import styles from "./viewer.module.css";

export function ViewerDashboardChrome({
  runtime,
  dashboard,
  dashboardTitle,
  version,
  updatedAt,
  isEditingMode,
  isPreviewMode,
  isReportSurface,
  showPreviewChrome,
  showPreviewStatusLine,
  showReportControls,
  showPublishedControls,
  effectiveRequestState,
  effectiveRequestMessage,
  selectedFilterValues,
  selectedRange,
  viewMode,
  visibleBoundViewCount,
  onFilterValuesChange,
  onViewModeChange,
  onReload,
  t,
}: {
  runtime: TemplateRuntimeDefinition;
  dashboard: DashboardDocument;
  dashboardTitle: ReactNode;
  version: number;
  updatedAt: string;
  isEditingMode: boolean;
  isPreviewMode: boolean;
  isReportSurface: boolean;
  showPreviewChrome: boolean;
  showPreviewStatusLine: boolean;
  showReportControls: boolean;
  showPublishedControls: boolean;
  effectiveRequestState: "loading" | "ready" | "error";
  effectiveRequestMessage: string;
  selectedFilterValues: Record<string, JsonValue>;
  selectedRange: (typeof FILTERS)[number];
  viewMode: ViewMode;
  visibleBoundViewCount: number;
  onFilterValuesChange: (values: Record<string, JsonValue>) => void;
  onViewModeChange: (viewMode: ViewMode) => void;
  onReload: () => void;
  t: TranslateFn;
}) {
  const { templateShared } = groupFiltersForViewer(dashboard);

  return (
    <>
      <ViewerDashboardHero
        runtime={runtime}
        dashboard={dashboard}
        dashboardTitle={dashboardTitle}
        version={version}
        updatedAt={updatedAt}
        isEditingMode={isEditingMode}
        isPreviewMode={isPreviewMode}
        isReportSurface={isReportSurface}
        hasReportToolbar={showReportControls}
        showPreviewChrome={showPreviewChrome}
        showPreviewStatusLine={showPreviewStatusLine}
        effectiveRequestState={effectiveRequestState}
        effectiveRequestMessage={effectiveRequestMessage}
        selectedFilterValues={selectedFilterValues}
        templateSharedFilters={templateShared}
        viewMode={viewMode}
        visibleBoundViewCount={visibleBoundViewCount}
        onFilterValuesChange={onFilterValuesChange}
        onViewModeChange={onViewModeChange}
        onReload={onReload}
        t={t}
      />
      {showReportControls ? (
        <ViewerReportToolbar
          runtime={runtime}
          isEditingMode={isEditingMode}
          selectedFilterValues={selectedFilterValues}
          templateSharedFilters={templateShared}
          viewMode={viewMode}
          visibleBoundViewCount={visibleBoundViewCount}
          onFilterValuesChange={onFilterValuesChange}
          onViewModeChange={onViewModeChange}
          onReload={onReload}
          t={t}
        />
      ) : null}
      {showPublishedControls ? (
        <ViewerPublishedContext
          effectiveRequestState={effectiveRequestState}
          effectiveRequestMessage={effectiveRequestMessage}
          selectedFilterValues={selectedFilterValues}
          selectedRange={selectedRange}
          templateSharedFilters={templateShared}
          viewMode={viewMode}
          onFilterValuesChange={onFilterValuesChange}
          onViewModeChange={onViewModeChange}
          onReload={onReload}
          t={t}
        />
      ) : null}
    </>
  );
}

function ViewerDashboardHero({
  runtime,
  dashboard,
  dashboardTitle,
  version,
  updatedAt,
  isEditingMode,
  isPreviewMode,
  isReportSurface,
  hasReportToolbar,
  showPreviewChrome,
  showPreviewStatusLine,
  effectiveRequestState,
  effectiveRequestMessage,
  selectedFilterValues,
  templateSharedFilters,
  viewMode,
  visibleBoundViewCount,
  onFilterValuesChange,
  onViewModeChange,
  onReload,
  t,
}: {
  runtime: TemplateRuntimeDefinition;
  dashboard: DashboardDocument;
  dashboardTitle: ReactNode;
  version: number;
  updatedAt: string;
  isEditingMode: boolean;
  isPreviewMode: boolean;
  isReportSurface: boolean;
  hasReportToolbar: boolean;
  showPreviewChrome: boolean;
  showPreviewStatusLine: boolean;
  effectiveRequestState: "loading" | "ready" | "error";
  effectiveRequestMessage: string;
  selectedFilterValues: Record<string, JsonValue>;
  templateSharedFilters: DashboardDocument["dashboard_spec"]["filters"];
  viewMode: ViewMode;
  visibleBoundViewCount: number;
  onFilterValuesChange: (values: Record<string, JsonValue>) => void;
  onViewModeChange: (viewMode: ViewMode) => void;
  onReload: () => void;
  t: TranslateFn;
}) {
  return (
    <header
      className={`${styles.hero} ${showPreviewChrome ? styles.heroPreview : ""} ${
        isReportSurface ? styles.heroReport : ""
      }`}
      data-report-toolbar={isReportSurface ? String(hasReportToolbar) : undefined}
    >
      <div className={styles.heroCopy}>
        {showPreviewChrome ? (
          <>
            <div className={styles.heroPreviewTitleRow}>
              <span className={styles.heroEyebrow}>
                {isEditingMode
                  ? t("viewer.dashboard.editingEyebrow")
                  : t("viewer.dashboard.previewEyebrow")}
              </span>
              <h1 className={styles.title}>{dashboardTitle}</h1>
            </div>
            {dashboard.dashboard_spec.dashboard.description ? (
              <p className={styles.description}>
                {dashboard.dashboard_spec.dashboard.description}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className={styles.heroEyebrow}>{t("viewer.dashboard.eyebrow")}</div>
            <h1 className={styles.title}>{dashboardTitle}</h1>
            {dashboard.dashboard_spec.dashboard.description ? (
              <p className={styles.description}>
                {dashboard.dashboard_spec.dashboard.description}
              </p>
            ) : null}
          </>
        )}
      </div>
      <div
        className={`${showPreviewChrome ? styles.heroMetaStackPreview : styles.heroMetaStack} ${
          isReportSurface ? styles.heroMetaStackReport : ""
        }`}
      >
        {showPreviewChrome ? (
          <>
            <div className={styles.heroPreviewControls}>
              <span className={styles.heroMetaPill}>
                {isEditingMode
                  ? t("viewer.dashboard.editingPill")
                  : t("viewer.dashboard.draftPill")}
              </span>
              {runtime.controlBand.layoutControl === "segmented" ? (
                <div
                  className={styles.heroInlineFilters}
                  role="group"
                  aria-label={t("viewer.dashboard.labelLayout")}
                >
                  <ViewModeControls
                    viewMode={viewMode}
                    compact
                    onChange={onViewModeChange}
                    t={t}
                  />
                </div>
              ) : null}
              {!isEditingMode &&
              visibleBoundViewCount > 0 &&
              runtime.controlBand.sharedFilterPlacement === "toolbar" &&
              templateSharedFilters.length > 0 ? (
                <div
                  className={styles.heroInlineFilters}
                  role="group"
                  aria-label={t("viewer.dashboard.labelRange")}
                >
                  <ViewerFilterControls
                    filters={templateSharedFilters}
                    filterValues={selectedFilterValues}
                    compact
                    onChange={onFilterValuesChange}
                    t={t}
                  />
                </div>
              ) : null}
              {!isEditingMode && runtime.controlBand.refreshAction === "trailing_button" ? (
                <button
                  type="button"
                  className={`${styles.refreshButton} ${styles.refreshButtonCompact}`}
                  onClick={onReload}
                >
                  {t("viewer.dashboard.refresh")}
                </button>
              ) : null}
              <span className={styles.heroPreviewUpdated}>
                {t("viewer.dashboard.updatedAt", {
                  timestamp: formatViewerTimestamp(updatedAt),
                })}
              </span>
            </div>
            {showPreviewStatusLine ? (
              <div className={styles.heroPreviewStatus}>{effectiveRequestMessage}</div>
            ) : null}
          </>
        ) : (
          <>
            <span className={styles.heroMetaPill}>{`v${version}`}</span>
            {isReportSurface ? (
              <span className={styles.heroReportStatus}>
                <span className={styles.heroReportStatusDot} aria-hidden="true" />
                {isEditingMode
                  ? t("viewer.dashboard.editingPill")
                  : effectiveRequestState === "ready"
                    ? t("viewer.dashboard.statusDataReady")
                    : viewerStatusLabel(effectiveRequestState, t)}
              </span>
            ) : null}
            <div className={styles.heroMeta}>
              {t("viewer.dashboard.updatedAt", {
                timestamp: formatViewerTimestamp(updatedAt),
              })}
            </div>
          </>
        )}
      </div>
    </header>
  );
}

function ViewerReportToolbar({
  runtime,
  isEditingMode,
  selectedFilterValues,
  templateSharedFilters,
  viewMode,
  visibleBoundViewCount,
  onFilterValuesChange,
  onViewModeChange,
  onReload,
  t,
}: {
  runtime: TemplateRuntimeDefinition;
  isEditingMode: boolean;
  selectedFilterValues: Record<string, JsonValue>;
  templateSharedFilters: DashboardDocument["dashboard_spec"]["filters"];
  viewMode: ViewMode;
  visibleBoundViewCount: number;
  onFilterValuesChange: (values: Record<string, JsonValue>) => void;
  onViewModeChange: (viewMode: ViewMode) => void;
  onReload: () => void;
  t: TranslateFn;
}) {
  const hasFilterControls =
    runtime.controlBand.sharedFilterPlacement === "toolbar" &&
    templateSharedFilters.length > 0;

  return (
    <section className={styles.reportToolbar}>
      {runtime.controlBand.layoutControl === "segmented" ? (
        <div
          className={styles.reportToolbarGroup}
          role="group"
          aria-label={t("viewer.dashboard.labelLayout")}
        >
          <span className={styles.reportToolbarLabel}>
            {t("viewer.dashboard.labelLayout")}
          </span>
          <ViewModeControls viewMode={viewMode} compact onChange={onViewModeChange} t={t} />
        </div>
      ) : null}
      {hasFilterControls ? (
        <div
          className={styles.reportToolbarGroup}
          role="group"
          aria-label={t("viewer.dashboard.labelRange")}
        >
          <ViewerFilterControls
            filters={templateSharedFilters}
            filterValues={selectedFilterValues}
            compact
            disabled={isEditingMode}
            onChange={onFilterValuesChange}
            t={t}
          />
        </div>
      ) : null}
      {visibleBoundViewCount > 0 && runtime.controlBand.refreshAction === "trailing_button" ? (
        <button
          type="button"
          className={`${styles.refreshButton} ${styles.refreshButtonCompact}`}
          disabled={isEditingMode}
          onClick={onReload}
        >
          {t("viewer.dashboard.refresh")}
        </button>
      ) : null}
    </section>
  );
}

function ViewerPublishedContext({
  effectiveRequestState,
  effectiveRequestMessage,
  selectedFilterValues,
  selectedRange,
  templateSharedFilters,
  viewMode,
  onFilterValuesChange,
  onViewModeChange,
  onReload,
  t,
}: {
  effectiveRequestState: "loading" | "ready" | "error";
  effectiveRequestMessage: string;
  selectedFilterValues: Record<string, JsonValue>;
  selectedRange: (typeof FILTERS)[number];
  templateSharedFilters: DashboardDocument["dashboard_spec"]["filters"];
  viewMode: ViewMode;
  onFilterValuesChange: (values: Record<string, JsonValue>) => void;
  onViewModeChange: (viewMode: ViewMode) => void;
  onReload: () => void;
  t: TranslateFn;
}) {
  return (
    <>
      <section className={styles.contextStrip}>
        <div className={styles.contextMetric}>
          <span className={styles.contextLabel}>{t("viewer.dashboard.labelStatus")}</span>
          <strong>{viewerStatusLabel(effectiveRequestState, t)}</strong>
        </div>
        <div className={styles.contextMetric}>
          <span className={styles.contextLabel}>{t("viewer.dashboard.labelRange")}</span>
          <strong>{labelForRange(selectedRange, t)}</strong>
        </div>
        <div className={styles.contextMetric}>
          <span className={styles.contextLabel}>{t("viewer.dashboard.labelLayout")}</span>
          <strong>{labelForViewMode(viewMode, t)}</strong>
        </div>
        <div className={styles.contextMetricWide}>
          <span className={styles.contextLabel}>{t("viewer.dashboard.labelSession")}</span>
          <strong>{effectiveRequestMessage}</strong>
        </div>
      </section>
      <section className={styles.toolbar}>
        <div className={styles.filterDeck}>
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>{t("viewer.dashboard.labelLayout")}</span>
            <div className={styles.filters}>
              <ViewModeControls viewMode={viewMode} onChange={onViewModeChange} t={t} />
            </div>
          </div>
          {templateSharedFilters.length > 0 ? (
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>{t("viewer.dashboard.labelRange")}</span>
              <div className={styles.filters}>
                <ViewerFilterControls
                  filters={templateSharedFilters}
                  filterValues={selectedFilterValues}
                  onChange={onFilterValuesChange}
                  t={t}
                />
              </div>
            </div>
          ) : null}
        </div>
        <div className={styles.toolbarMeta}>
          <span>{effectiveRequestMessage}</span>
          <button type="button" className={styles.refreshButton} onClick={onReload}>
            {t("viewer.dashboard.refresh")}
          </button>
        </div>
      </section>
    </>
  );
}
