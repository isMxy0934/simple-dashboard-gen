"use client";

import { useEffect, useMemo, useState } from "react";
import { getBindingMode } from "../../../domain/dashboard/bindings";
import { getViewOptionTemplate } from "../../../domain/dashboard/contract-kernel";
import { reconcileDashboardDocumentLayouts } from "../../../domain/dashboard/document";
import type {
  BindingResults,
  DashboardDocument,
} from "../../../contracts";
import { getTemplatePreviewOption } from "../../../renderers/echarts/preview/sample-option";
import { deriveRenderedViews, type ViewRenderStatus } from "../state/rendered-views";
import { ViewerChart } from "./viewer-chart";
import styles from "./viewer.module.css";
import {
  buildCardStyle,
  buildGridStyle,
  buildStatusMap,
  FILTERS,
  getDefaultTimeRange,
  getLayout,
  getVisibleViews,
  labelForRange,
  labelForViewMode,
  type ViewMode,
  viewerStatusLabel,
  hasAnyBindingForView,
  formatViewerTimestamp,
} from "../state/viewer-state";
import { executePreviewRequest, executeViewerBatch } from "../api/viewer-api";
import { useI18n } from "../../i18n/i18n-context";

interface ViewerDashboardProps {
  dashboardId: string;
  workspaceId?: string | null;
  version: number;
  dashboard: DashboardDocument;
  updatedAt: string;
  previewMode?: boolean;
}

const VIEW_MODES: ViewMode[] = ["desktop", "mobile"];

export function ViewerDashboard({
  dashboardId,
  workspaceId,
  version,
  dashboard,
  updatedAt,
  previewMode = false,
}: ViewerDashboardProps) {
  const { t } = useI18n();
  const normalizedDashboard = useMemo(
    () => reconcileDashboardDocumentLayouts(dashboard, "auto"),
    [dashboard],
  );
  const [viewMode, setViewMode] = useState<ViewMode>("desktop");
  const [selectedRange, setSelectedRange] = useState<(typeof FILTERS)[number]>(
    getDefaultTimeRange(normalizedDashboard),
  );
  const [reloadTick, setReloadTick] = useState(0);
  const [bindingResults, setBindingResults] = useState<BindingResults>({});
  const [requestState, setRequestState] = useState<"loading" | "ready" | "error">("loading");
  const [requestMessage, setRequestMessage] = useState<string>(() =>
    previewMode
      ? t("viewer.dashboard.loadingPreview")
      : t("viewer.dashboard.loadingDashboardData"),
  );

  const layoutResolution = useMemo(() => {
    try {
      return {
        layout: getLayout(normalizedDashboard, viewMode),
        error: null,
      };
    } catch (error) {
      return {
        layout: null,
        error: error instanceof Error ? error.message : t("viewer.dashboard.layoutMissing"),
      };
    }
  }, [normalizedDashboard, viewMode, t]);
  const layout = layoutResolution.layout;
  const visibleViews = useMemo(() => {
    if (!layout) {
      return [];
    }
    const viewIds = layout.items.map((item) => item.view_id);
    return getVisibleViews(normalizedDashboard, viewIds);
  }, [normalizedDashboard, layout]);
  const visibleBoundViews = useMemo(
    () =>
      visibleViews.filter((view) => hasAnyBindingForView(dashboard.bindings, view.id)),
    [dashboard.bindings, visibleViews],
  );

  useEffect(() => {
    let active = true;

    async function loadResults() {
      setRequestState("loading");
      setRequestMessage(
        previewMode
          ? t("viewer.dashboard.loadingData")
          : t("viewer.dashboard.loadingDashboardData"),
      );

      try {
        if (previewMode && visibleBoundViews.length === 0) {
          if (!active) {
            return;
          }

          setBindingResults({});
          setRequestState("ready");
          setRequestMessage(t("viewer.dashboard.templateOnlyPreview"));
          return;
        }

        const nextBindingResults = previewMode
          ? await executePreviewRequest({
              dashboard,
              visibleViewIds: visibleBoundViews.map((view) => view.id),
              selectedRange,
            })
          : await executeViewerBatch({
              workspaceId,
              dashboardId,
              version,
              visibleViewIds: visibleViews.map((view) => view.id),
              selectedRange,
            });
        if (!active) {
          return;
        }

        setBindingResults(nextBindingResults);
        setRequestState("ready");
        setRequestMessage(
          previewMode
            ? t("viewer.dashboard.previewReady")
            : t("viewer.dashboard.dataReady"),
        );
      } catch (error) {
        if (!active) {
          return;
        }

        setBindingResults({});
        setRequestState("error");
        setRequestMessage(
          error instanceof Error
            ? normalizeViewerRequestError(error.message, t)
            : t("viewer.dashboard.unknownBatchError"),
        );
      }
    }

    void loadResults();

    return () => {
      active = false;
    };
  }, [
    dashboard,
    dashboardId,
    workspaceId,
    previewMode,
    reloadTick,
    selectedRange,
    version,
    visibleBoundViews,
    visibleViews,
    t,
  ]);

  const statusMap = buildStatusMap(visibleViews, bindingResults, requestState);
  const renderedViews = deriveRenderedViews(visibleViews, bindingResults, statusMap);
  const renderedViewById = new Map(
    renderedViews.map((renderedView) => [renderedView.view.id, renderedView]),
  );
  const showDashboardFallback =
    !layoutResolution.layout ||
    (requestState === "ready" && visibleViews.length === 0);

  const showPreviewStatusLine =
    previewMode &&
    (requestState !== "ready" ||
      ![
        t("viewer.dashboard.templateOnlyPreview"),
        t("viewer.dashboard.previewReady"),
      ].includes(requestMessage));

  return (
    <div className={styles.shell}>
      <div className={styles.page}>
        <header
          className={`${styles.hero} ${previewMode ? styles.heroPreview : ""}`}
        >
          <div className={styles.heroCopy}>
            {previewMode ? (
              <>
                  <div className={styles.heroPreviewTitleRow}>
                  <span className={styles.heroEyebrow}>{t("viewer.dashboard.previewEyebrow")}</span>
                  <h1 className={styles.title}>
                    {dashboard.dashboard_spec.dashboard.name}
                  </h1>
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
                <h1 className={styles.title}>
                  {dashboard.dashboard_spec.dashboard.name}
                </h1>
                <p className={styles.description}>
                  {dashboard.dashboard_spec.dashboard.description}
                </p>
              </>
            )}
          </div>
          <div
            className={previewMode ? styles.heroMetaStackPreview : styles.heroMetaStack}
          >
            {previewMode ? (
              <>
                <div className={styles.heroPreviewControls}>
                  <span className={styles.heroMetaPill}>{t("viewer.dashboard.draftPill")}</span>
                  <div
                    className={styles.heroInlineFilters}
                    role="group"
                    aria-label={t("viewer.dashboard.labelLayout")}
                  >
                    {VIEW_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`${styles.filterButton} ${styles.filterButtonCompact} ${
                          viewMode === mode ? styles.filterButtonActive : ""
                        }`}
                        onClick={() => setViewMode(mode)}
                      >
                          {labelForViewMode(mode, t)}
                      </button>
                    ))}
                  </div>
                  {visibleBoundViews.length > 0 ? (
                    <div
                      className={styles.heroInlineFilters}
                      role="group"
                      aria-label={t("viewer.dashboard.labelRange")}
                    >
                      {FILTERS.map((range) => (
                        <button
                          key={range}
                          type="button"
                          className={`${styles.filterButton} ${styles.filterButtonCompact} ${
                            selectedRange === range ? styles.filterButtonActive : ""
                          }`}
                          onClick={() => setSelectedRange(range)}
                        >
                          {labelForRange(range, t)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={`${styles.refreshButton} ${styles.refreshButtonCompact}`}
                    onClick={() => setReloadTick((value) => value + 1)}
                  >
                    {t("viewer.dashboard.refresh")}
                  </button>
                  <span className={styles.heroPreviewUpdated}>
                    {t("viewer.dashboard.updatedAt", {
                      timestamp: formatViewerTimestamp(updatedAt),
                    })}
                  </span>
                </div>
                {showPreviewStatusLine ? (
                  <div className={styles.heroPreviewStatus}>{requestMessage}</div>
                ) : null}
              </>
            ) : (
              <>
                <span className={styles.heroMetaPill}>{`v${version}`}</span>
                <div className={styles.heroMeta}>
                  {t("viewer.dashboard.updatedAt", {
                    timestamp: formatViewerTimestamp(updatedAt),
                  })}
                </div>
              </>
            )}
          </div>
        </header>

        {!previewMode ? (
          <section className={styles.contextStrip}>
            <div className={styles.contextMetric}>
              <span className={styles.contextLabel}>{t("viewer.dashboard.labelStatus")}</span>
              <strong>{viewerStatusLabel(requestState, t)}</strong>
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
              <strong>{requestMessage}</strong>
            </div>
          </section>
        ) : null}

        {!previewMode ? (
          <section className={styles.toolbar}>
            <div className={styles.filterDeck}>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>{t("viewer.dashboard.labelLayout")}</span>
                <div className={styles.filters}>
                  {VIEW_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`${styles.filterButton} ${
                        viewMode === mode ? styles.filterButtonActive : ""
                      }`}
                      onClick={() => setViewMode(mode)}
                    >
                      {labelForViewMode(mode, t)}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>{t("viewer.dashboard.labelRange")}</span>
                <div className={styles.filters}>
                  {FILTERS.map((range) => (
                    <button
                      key={range}
                      type="button"
                      className={`${styles.filterButton} ${
                        selectedRange === range ? styles.filterButtonActive : ""
                      }`}
                      onClick={() => setSelectedRange(range)}
                    >
                      {labelForRange(range, t)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.toolbarMeta}>
              <span>{requestMessage}</span>
              <button
                type="button"
                className={styles.refreshButton}
                onClick={() => setReloadTick((value) => value + 1)}
              >
                {t("viewer.dashboard.refresh")}
              </button>
            </div>
          </section>
        ) : null}

        {showDashboardFallback ? (
          layoutResolution.error ? (
            <ErrorState message={layoutResolution.error} t={t} />
          ) : (
            <EmptyState
              message={t("viewer.dashboard.noRenderableViews")}
              t={t}
            />
          )
        ) : (
        <section className={styles.grid} style={buildGridStyle(layout!)}>
          {layout!.items.map((item) => {
            const renderedView = renderedViewById.get(item.view_id);
            if (!renderedView) {
              return null;
            }
            const bindingMode = getBindingMode(
              dashboard.bindings.find((binding) => binding.view_id === renderedView.view.id),
            );
            const templatePreview =
              previewMode && bindingMode === "unbound"
                ? getTemplatePreviewOption({
                    optionTemplate: getViewOptionTemplate(renderedView.view),
                    slots: renderedView.view.renderer.slots,
                  })
                : null;

            return (
              <article
                key={renderedView.view.id}
                className={styles.card}
                style={buildCardStyle(item)}
              >
                <header className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>{renderedView.view.title}</h2>
                    <p className={styles.cardDescription}>{renderedView.view.description}</p>
                  </div>
                  <StatusPill
                    status={templatePreview ? "template" : renderedView.status}
                    t={t}
                  />
                </header>

                <div className={styles.body}>
                  {templatePreview ? (
                    <ViewerChart
                      optionTemplate={templatePreview.option}
                      rowsCount={templatePreview.rowsCount}
                    />
                  ) : renderedView.status === "loading" ? (
                    <LoadingState t={t} />
                  ) : renderedView.status === "error" ? (
                    <ErrorState
                      message={renderedView.message ?? t("viewer.dashboard.batchRequestFailed")}
                      t={t}
                    />
                  ) : renderedView.status === "empty" ? (
                    <EmptyState
                      message={
                        renderedView.message ?? t("viewer.dashboard.noDataForSelectedTimeRange")
                      }
                      t={t}
                    />
                  ) : (
                    <ViewerChart
                      optionTemplate={renderedView.optionTemplate}
                      rowsCount={renderedView.dataCount}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </section>
        )}

      </div>
    </div>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: ViewRenderStatus | "template";
  t: ReturnType<typeof useI18n>["t"];
}) {
  const label =
    status === "loading"
      ? t("viewer.dashboard.pillLoading")
      : status === "ok"
        ? t("viewer.dashboard.pillOk")
        : status === "empty"
          ? t("viewer.dashboard.pillEmpty")
          : status === "template"
            ? t("viewer.dashboard.pillTemplate")
            : t("viewer.dashboard.pillError");
  const className =
    status === "loading"
      ? styles.statusLoading
      : status === "ok"
        ? styles.statusOk
        : status === "empty"
          ? styles.statusEmpty
          : status === "template"
            ? styles.statusEmpty
            : styles.statusError;

  return <span className={`${styles.statusPill} ${className}`}>{label}</span>;
}

function LoadingState({ t }: { t: ReturnType<typeof useI18n>["t"] }) {
  return (
    <div className={styles.loadingState}>
      <div className={styles.loadingBars} aria-hidden="true">
        <div className={styles.loadingBar} />
        <div className={styles.loadingBar} />
        <div className={styles.loadingBar} />
      </div>
      <div className={styles.stateTitle}>{t("viewer.dashboard.loadingTitle")}</div>
      <p className={styles.stateBody}>{t("viewer.dashboard.loadingBody")}</p>
    </div>
  );
}

function EmptyState({
  message,
  t,
}: {
  message: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.stateTitle}>{t("viewer.dashboard.emptyTitle")}</div>
      <p className={styles.stateBody}>{message}</p>
    </div>
  );
}

function ErrorState({
  message,
  t,
}: {
  message: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className={styles.errorState}>
      <div className={styles.stateTitle}>{t("viewer.dashboard.errorTitle")}</div>
      <p className={styles.stateBody}>{message}</p>
    </div>
  );
}

function normalizeViewerRequestError(
  message: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (message === "Batch request failed") {
    return t("viewer.dashboard.batchRequestFailed");
  }

  if (message === "Batch request failed.") {
    return t("viewer.dashboard.batchRequestFailed");
  }

  if (message.startsWith("Preview failed with HTTP ")) {
    return t("viewer.dashboard.previewFailedWithHttp", {
      status: message.replace("Preview failed with HTTP ", ""),
    });
  }

  return message;
}
