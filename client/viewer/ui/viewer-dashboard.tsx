"use client";

import { useEffect, useMemo, useState } from "react";
import { getBindingMode } from "../../../domain/dashboard/bindings";
import { getTemplatePreviewOption } from "../../../domain/rendering/template-preview";
import type {
  BindingResults,
  DashboardDocument,
} from "../../../contracts";
import { deriveRenderedViews, type ViewRenderStatus } from "../../../domain/rendering/dashboard-render";
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

interface ViewerDashboardProps {
  dashboardId: string;
  version: number;
  dashboard: DashboardDocument;
  updatedAt: string;
  previewMode?: boolean;
}

const VIEW_MODES: ViewMode[] = ["desktop", "mobile"];

export function ViewerDashboard({
  dashboardId,
  version,
  dashboard,
  updatedAt,
  previewMode = false,
}: ViewerDashboardProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("desktop");
  const [selectedRange, setSelectedRange] = useState<(typeof FILTERS)[number]>(
    getDefaultTimeRange(dashboard),
  );
  const [reloadTick, setReloadTick] = useState(0);
  const [bindingResults, setBindingResults] = useState<BindingResults>({});
  const [requestState, setRequestState] = useState<"loading" | "ready" | "error">("loading");
  const [requestMessage, setRequestMessage] = useState<string>(() =>
    previewMode ? "加载预览…" : "Refreshing dashboard data...",
  );

  const layout = useMemo(() => getLayout(dashboard, viewMode), [dashboard, viewMode]);
  const visibleViews = useMemo(() => {
    const viewIds = layout.items.map((item) => item.view_id);
    return getVisibleViews(dashboard, viewIds);
  }, [dashboard, layout]);
  const visibleBoundViews = useMemo(
    () =>
      visibleViews.filter((view) => hasAnyBindingForView(dashboard.bindings, view.id)),
    [dashboard.bindings, visibleViews],
  );

  useEffect(() => {
    let active = true;

    async function loadResults() {
      setRequestState("loading");
      setRequestMessage(previewMode ? "加载中…" : "Refreshing dashboard data...");

      try {
        if (previewMode && visibleBoundViews.length === 0) {
          if (!active) {
            return;
          }

          setBindingResults({});
          setRequestState("ready");
          setRequestMessage("仅模板预览。");
          return;
        }

        const nextBindingResults = previewMode
          ? await executePreviewRequest({
              dashboard,
              visibleViewIds: visibleBoundViews.map((view) => view.id),
              selectedRange,
            })
          : await executeViewerBatch({
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
          previewMode ? "预览就绪" : "Dashboard data is ready for the selected range.",
        );
      } catch (error) {
        if (!active) {
          return;
        }

        setBindingResults({});
        setRequestState("error");
        setRequestMessage(error instanceof Error ? error.message : "Unknown batch error");
      }
    }

    void loadResults();

    return () => {
      active = false;
    };
  }, [
    dashboard,
    dashboardId,
    previewMode,
    reloadTick,
    selectedRange,
    version,
    visibleBoundViews,
    visibleViews,
  ]);

  const statusMap = buildStatusMap(visibleViews, bindingResults, requestState);
  const renderedViews = deriveRenderedViews(visibleViews, bindingResults, statusMap);
  const renderedViewById = new Map(
    renderedViews.map((renderedView) => [renderedView.view.id, renderedView]),
  );

  const showPreviewStatusLine =
    previewMode &&
    (requestState !== "ready" ||
      !["仅模板预览。", "预览就绪"].includes(requestMessage));

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
                  <span className={styles.heroEyebrow}>预览</span>
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
                <div className={styles.heroEyebrow}>Viewer</div>
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
                  <span className={styles.heroMetaPill}>草稿</span>
                  <div className={styles.heroInlineFilters} role="group" aria-label="布局">
                    {VIEW_MODES.map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`${styles.filterButton} ${styles.filterButtonCompact} ${
                          viewMode === mode ? styles.filterButtonActive : ""
                        }`}
                        onClick={() => setViewMode(mode)}
                      >
                        {labelForViewMode(mode)}
                      </button>
                    ))}
                  </div>
                  {visibleBoundViews.length > 0 ? (
                    <div className={styles.heroInlineFilters} role="group" aria-label="时间范围">
                      {FILTERS.map((range) => (
                        <button
                          key={range}
                          type="button"
                          className={`${styles.filterButton} ${styles.filterButtonCompact} ${
                            selectedRange === range ? styles.filterButtonActive : ""
                          }`}
                          onClick={() => setSelectedRange(range)}
                        >
                          {labelForRange(range)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className={`${styles.refreshButton} ${styles.refreshButtonCompact}`}
                    onClick={() => setReloadTick((value) => value + 1)}
                  >
                    刷新
                  </button>
                  <span className={styles.heroPreviewUpdated}>
                    更新 {formatViewerTimestamp(updatedAt)}
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
                  Updated {formatViewerTimestamp(updatedAt)}
                </div>
              </>
            )}
          </div>
        </header>

        {!previewMode ? (
          <section className={styles.contextStrip}>
            <div className={styles.contextMetric}>
              <span className={styles.contextLabel}>Status</span>
              <strong>{viewerStatusLabel(requestState)}</strong>
            </div>
            <div className={styles.contextMetric}>
              <span className={styles.contextLabel}>Range</span>
              <strong>{labelForRange(selectedRange)}</strong>
            </div>
            <div className={styles.contextMetric}>
              <span className={styles.contextLabel}>Layout</span>
              <strong>{labelForViewMode(viewMode)}</strong>
            </div>
            <div className={styles.contextMetricWide}>
              <span className={styles.contextLabel}>Session</span>
              <strong>{requestMessage}</strong>
            </div>
          </section>
        ) : null}

        {!previewMode ? (
          <section className={styles.toolbar}>
            <div className={styles.filterDeck}>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Layout</span>
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
                      {labelForViewMode(mode)}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.filterGroup}>
                <span className={styles.filterLabel}>Range</span>
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
                      {labelForRange(range)}
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
                Refresh
              </button>
            </div>
          </section>
        ) : null}

        <section className={styles.grid} style={buildGridStyle(layout)}>
          {layout.items.map((item) => {
            const renderedView = renderedViewById.get(item.view_id);
            if (!renderedView) {
              return null;
            }
            const bindingMode = getBindingMode(
              dashboard.bindings.find((binding) => binding.view_id === renderedView.view.id),
            );
            const templatePreview =
              previewMode && bindingMode === "unbound"
                ? getTemplatePreviewOption(renderedView.view.option_template)
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
                  />
                </header>

                <div className={styles.body}>
                  {templatePreview ? (
                    <ViewerChart
                      optionTemplate={templatePreview.option}
                      rowsCount={templatePreview.rowsCount}
                    />
                  ) : renderedView.status === "loading" ? (
                    <LoadingState />
                  ) : renderedView.status === "error" ? (
                    <ErrorState message={renderedView.message ?? "Batch request failed."} />
                  ) : renderedView.status === "empty" ? (
                    <EmptyState
                      message={renderedView.message ?? "No data for the selected time range."}
                    />
                  ) : (
                    <ViewerChart
                      optionTemplate={renderedView.optionTemplate}
                      rowsCount={renderedView.rows.length}
                    />
                  )}
                </div>
              </article>
            );
          })}
        </section>

      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ViewRenderStatus | "template" }) {
  const label =
    status === "loading"
      ? "Loading"
      : status === "ok"
        ? "Live"
        : status === "empty"
          ? "No Data"
          : status === "template"
            ? "模板"
            : "Review";
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

function LoadingState() {
  return (
    <div className={styles.loadingState}>
      <div className={styles.loadingBars} aria-hidden="true">
        <div className={styles.loadingBar} />
        <div className={styles.loadingBar} />
        <div className={styles.loadingBar} />
      </div>
      <div className={styles.stateTitle}>Refreshing the report</div>
      <p className={styles.stateBody}>Fetching the latest rows for the selected time range.</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.stateTitle}>Nothing to show in this range</div>
      <p className={styles.stateBody}>{message}</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className={styles.errorState}>
      <div className={styles.stateTitle}>This view needs attention</div>
      <p className={styles.stateBody}>{message}</p>
    </div>
  );
}
