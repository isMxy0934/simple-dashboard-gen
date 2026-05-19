"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  createMockValueForSlot,
  getBindingMode,
} from "../../../domain/dashboard/bindings";
import {
  getViewOptionTemplate,
  getViewSlots,
} from "../../../domain/dashboard/contract-kernel";
import { reconcileDashboardDocumentLayouts } from "../../../domain/dashboard/document";
import {
  resolveViewPresentationContext,
  type DashboardChartPresentationContext,
} from "../../../domain/dashboard/presentation-context";
import type {
  Binding,
  BindingResults,
  DashboardLayoutItem,
  DashboardDocument,
  DashboardView,
  JsonValue,
} from "../../../contracts";
import { getTemplatePreviewOption } from "../../../renderers/echarts/preview/sample-option";
import { deriveRenderedViews, type RenderedView, type ViewRenderStatus } from "../state/rendered-views";
import { ViewerChart } from "./viewer-chart";
import styles from "./viewer.module.css";
import {
  buildCardStyle,
  buildGridStyle,
  buildDefaultViewerFilterValues,
  FILTERS,
  getTimeRangeFilterValue,
  getVisibleViews,
  labelForRange,
  labelForViewMode,
  type ViewMode,
  viewerStatusLabel,
  hasAnyBindingForView,
  formatViewerTimestamp,
} from "../state/viewer-state";
import { executePreviewRequest, executeViewerBatch } from "../api/viewer-api";
import { buildDashboardChartLabels } from "../../i18n/chart-labels";
import { useI18n } from "../../i18n/i18n-context";
import { formatReportDisplayName } from "../../i18n/report-display-name";
import { resolveDashboardLayout } from "../../dashboard/render-input";
import { cssGridAutoRowsForAuthoring } from "../../utils/layout-presentation";
import { estimateValueCount } from "../../../renderers/core/slot-path";
import { materializeEChartsOptionTemplate } from "../../../renderers/echarts/browser/materialize-option";
import {
  summarizeRendererValidationChecks,
  type RendererChecksByView,
} from "../../../renderers/core/validation-result";
import {
  buildDashboardRenderModel,
  type DashboardRenderMode,
} from "../../dashboard/render";

type EditingPreviewState = "idle" | "loading" | "ready" | "error";
type InteractionMode = "move" | "resize";

interface ViewerDashboardEditingOptions {
  viewMode: ViewMode;
  previewResults: BindingResults;
  previewRendererChecks: RendererChecksByView;
  previewState: EditingPreviewState;
  hasDataDraft: boolean;
  selectedViewId: string | null;
  bindings: Binding[];
  canvasRef: RefObject<HTMLDivElement | null>;
  onViewModeChange: (mode: ViewMode) => void;
  onDashboardNameChange?: (value: string) => void;
  onSelectView: (viewId: string) => void;
  onClearSelection: () => void;
  onStartInteraction: (
    event: ReactPointerEvent<HTMLElement>,
    item: DashboardLayoutItem,
    mode: InteractionMode,
  ) => void;
  renderCardOverlay: (input: {
    view: DashboardView;
    item: DashboardLayoutItem;
    renderedView: RenderedView | null;
  }) => ReactNode;
}

interface ViewerDashboardProps {
  dashboardId: string;
  workspaceId?: string | null;
  version: number;
  dashboard: DashboardDocument;
  updatedAt: string;
  previewMode?: boolean;
  mode?: DashboardRenderMode;
  initialViewMode?: ViewMode;
  editing?: ViewerDashboardEditingOptions;
}

const VIEW_MODES: ViewMode[] = ["desktop", "mobile"];
const SELECTION_MOVE_TOLERANCE_PX = 8;

export function ViewerDashboard({
  dashboardId,
  workspaceId,
  version,
  dashboard,
  updatedAt,
  previewMode = false,
  mode,
  initialViewMode,
  editing,
}: ViewerDashboardProps) {
  const { t } = useI18n();
  const renderMode: DashboardRenderMode =
    mode ?? (previewMode ? "preview" : "published");
  const isPreviewMode = renderMode === "preview";
  const isEditingMode = renderMode === "editing";
  const selectionIntentRef = useRef<{
    viewId: string;
    pointerId: number;
    startX: number;
    startY: number;
    canceled: boolean;
  } | null>(null);
  const normalizedDashboard = useMemo(
    () => reconcileDashboardDocumentLayouts(dashboard, "custom"),
    [dashboard],
  );
  const [uncontrolledViewMode, setUncontrolledViewMode] = useState<ViewMode>(
    initialViewMode ?? "desktop",
  );
  const viewMode = editing?.viewMode ?? uncontrolledViewMode;
  const setViewMode = editing?.onViewModeChange ?? setUncontrolledViewMode;
  const [selectedFilterValues, setSelectedFilterValues] = useState<Record<string, JsonValue>>(
    () => buildDefaultViewerFilterValues(normalizedDashboard),
  );
  const selectedRange = getTimeRangeFilterValue(normalizedDashboard, selectedFilterValues);
  const [reloadTick, setReloadTick] = useState(0);
  const [bindingResults, setBindingResults] = useState<BindingResults>({});
  const [rendererChecks, setRendererChecks] = useState<RendererChecksByView>({});
  const [requestState, setRequestState] = useState<"loading" | "ready" | "error">("loading");
  const [requestMessage, setRequestMessage] = useState<string>(() =>
    isPreviewMode
      ? t("viewer.dashboard.loadingPreview")
      : t("viewer.dashboard.loadingDashboardData"),
  );
  const effectiveBindingResults = editing?.previewResults ?? bindingResults;
  const effectiveRendererChecks = editing?.previewRendererChecks ?? rendererChecks;
  const effectiveRequestState: "loading" | "ready" | "error" = editing
    ? editing.previewState === "loading"
      ? "loading"
      : editing.previewState === "error"
        ? "error"
        : "ready"
    : requestState;
  const effectiveRequestMessage = editing
    ? t("viewer.dashboard.previewReady")
    : requestMessage;

  useEffect(() => {
    if (initialViewMode) {
      setUncontrolledViewMode(initialViewMode);
    }
  }, [initialViewMode]);

  const layoutResolution = useMemo(() => {
    try {
      return {
        layout: resolveDashboardLayout(normalizedDashboard, viewMode),
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
    setSelectedFilterValues(buildDefaultViewerFilterValues(normalizedDashboard));
  }, [normalizedDashboard]);

  useEffect(() => {
    if (isEditingMode) {
      return;
    }

    let active = true;

    async function loadResults() {
      setRequestState("loading");
      setRequestMessage(
        isPreviewMode
          ? t("viewer.dashboard.loadingData")
          : t("viewer.dashboard.loadingDashboardData"),
      );

      try {
        const resolvedWorkspaceId = workspaceId?.trim();
        if (!isPreviewMode && !resolvedWorkspaceId) {
          throw new Error("Workspace id is required.");
        }

        if (isPreviewMode && visibleBoundViews.length === 0) {
          if (!active) {
            return;
          }

          setBindingResults({});
          setRendererChecks({});
          setRequestState("ready");
          setRequestMessage(t("viewer.dashboard.templateOnlyPreview"));
          return;
        }

        const nextResult = isPreviewMode
          ? await executePreviewRequest({
              dashboard,
              visibleViewIds: visibleBoundViews.map((view) => view.id),
              selectedFilterValues,
            })
          : await executeViewerBatch({
              workspaceId: resolvedWorkspaceId ?? "",
              dashboardId,
              version,
              dashboard: normalizedDashboard,
              visibleViewIds: visibleViews.map((view) => view.id),
              selectedFilterValues,
            });
        if (!active) {
          return;
        }

        setBindingResults(nextResult.bindingResults);
        setRendererChecks(nextResult.rendererChecks);
        setRequestState("ready");
        setRequestMessage(
          isPreviewMode
            ? t("viewer.dashboard.previewReady")
            : t("viewer.dashboard.dataReady"),
        );
      } catch (error) {
        if (!active) {
          return;
        }

        setBindingResults({});
        setRendererChecks({});
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
    isPreviewMode,
    isEditingMode,
    reloadTick,
    selectedFilterValues,
    version,
    visibleBoundViews,
    visibleViews,
    t,
  ]);

  const renderModel = useMemo(
    () =>
      layout
        ? buildDashboardRenderModel({
            dashboard: normalizedDashboard,
            mode: renderMode,
            viewMode,
            bindingResults: effectiveBindingResults,
            requestState: effectiveRequestState,
            rendererChecks: effectiveRendererChecks,
          })
        : null,
    [
      effectiveBindingResults,
      effectiveRendererChecks,
      effectiveRequestState,
      layout,
      normalizedDashboard,
      renderMode,
      viewMode,
    ],
  );
  const statusMap = renderModel?.statusMap ?? {};
  const chartLabels = useMemo(() => buildDashboardChartLabels(t), [t]);
  const presentationContext = useMemo(
    () => resolveViewPresentationContext(normalizedDashboard, { chartLabels }),
    [normalizedDashboard, chartLabels],
  );
  const { chartPresentation, isReportSurface } = presentationContext;
  const reportThemeStyle = presentationContext.cssVariables as CSSProperties | undefined;
  const renderedViews = deriveRenderedViews(
    visibleViews,
    effectiveBindingResults,
    statusMap,
    chartPresentation,
  );
  const renderedViewById = new Map(
    renderedViews.map((renderedView) => [renderedView.view.id, renderedView]),
  );
  const showDashboardFallback =
    !layoutResolution.layout ||
    (effectiveRequestState === "ready" && visibleViews.length === 0);

  const themeClassName = isReportSurface ? styles.themeReportSurface : "";
  const showPreviewChrome = !isReportSurface && (isPreviewMode || isEditingMode);
  const showPreviewStatusLine =
    showPreviewChrome &&
    isPreviewMode &&
    (effectiveRequestState !== "ready" ||
      ![
        t("viewer.dashboard.templateOnlyPreview"),
        t("viewer.dashboard.previewReady"),
      ].includes(effectiveRequestMessage));
  const showPublishedControls = !isReportSurface && !isPreviewMode && !isEditingMode;
  const showStatusPill = !isReportSurface;
  const showChartMeta = !isReportSurface;
  const showReportControls =
    isReportSurface &&
    !isEditingMode &&
    (isPreviewMode || visibleBoundViews.length > 0);
  const reportTitle = formatReportDisplayName(dashboard.dashboard_spec.dashboard.name);
  const renderDashboardTitle = () =>
    isEditingMode && editing?.onDashboardNameChange ? (
      <input
        className={styles.titleInput}
        value={dashboard.dashboard_spec.dashboard.name}
        onChange={(event) => editing.onDashboardNameChange?.(event.target.value)}
        aria-label={t("authoring.topbar.dashboardNameAria")}
      />
    ) : (
      reportTitle
    );

  useEffect(() => {
    if (!isReportSurface || isEditingMode || editing || initialViewMode) {
      return;
    }
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(max-width: 720px)");
    const syncViewMode = () => {
      setUncontrolledViewMode(media.matches ? "mobile" : "desktop");
    };

    syncViewMode();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncViewMode);
      return () => media.removeEventListener("change", syncViewMode);
    }

    media.addListener(syncViewMode);
    return () => media.removeListener(syncViewMode);
  }, [editing, initialViewMode, isEditingMode, isReportSurface]);

  return (
    <div
      className={`${styles.shell} ${themeClassName} ${isEditingMode ? styles.shellEditing : ""}`}
      style={reportThemeStyle}
    >
      <div className={`${styles.page} ${isEditingMode ? styles.pageEditing : ""} ${
        isReportSurface ? styles.pageReport : ""
      }`}>
        <header
          className={`${styles.hero} ${showPreviewChrome ? styles.heroPreview : ""} ${
            isReportSurface ? styles.heroReport : ""
          }`}
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
                  <h1 className={styles.title}>
                    {renderDashboardTitle()}
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
                  {renderDashboardTitle()}
                </h1>
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
                  {!isEditingMode && visibleBoundViews.length > 0 ? (
                    <div
                      className={styles.heroInlineFilters}
                      role="group"
                      aria-label={t("viewer.dashboard.labelRange")}
                    >
                      <ViewerFilterControls
                        dashboard={normalizedDashboard}
                        filterValues={selectedFilterValues}
                        compact
                        onChange={setSelectedFilterValues}
                        t={t}
                      />
                    </div>
                  ) : null}
                  {!isEditingMode ? (
                    <button
                      type="button"
                      className={`${styles.refreshButton} ${styles.refreshButtonCompact}`}
                      onClick={() => setReloadTick((value) => value + 1)}
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
                <div className={styles.heroMeta}>
                  {t("viewer.dashboard.updatedAt", {
                    timestamp: formatViewerTimestamp(updatedAt),
                  })}
                </div>
              </>
            )}
          </div>
        </header>

        {showReportControls ? (
          <section className={styles.reportToolbar}>
            <div
              className={styles.reportToolbarGroup}
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
              <>
                <div
                  className={styles.reportToolbarGroup}
                  role="group"
                  aria-label={t("viewer.dashboard.labelRange")}
                >
                  <ViewerFilterControls
                    dashboard={normalizedDashboard}
                    filterValues={selectedFilterValues}
                    compact
                    onChange={setSelectedFilterValues}
                    t={t}
                  />
                </div>
                <button
                  type="button"
                  className={`${styles.refreshButton} ${styles.refreshButtonCompact}`}
                  onClick={() => setReloadTick((value) => value + 1)}
                >
                  {t("viewer.dashboard.refresh")}
                </button>
              </>
            ) : null}
          </section>
        ) : null}

        {showPublishedControls ? (
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
        ) : null}

        {showPublishedControls ? (
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
                  <ViewerFilterControls
                    dashboard={normalizedDashboard}
                    filterValues={selectedFilterValues}
                    onChange={setSelectedFilterValues}
                    t={t}
                  />
                </div>
              </div>
            </div>
            <div className={styles.toolbarMeta}>
              <span>{effectiveRequestMessage}</span>
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
        <section
          ref={editing?.canvasRef}
          className={`${styles.grid} ${isEditingMode ? styles.gridEditing : ""} ${
            isReportSurface ? styles.gridReport : ""
          }`}
          style={buildDashboardGridStyle(layout!)}
          onClick={(event) => {
            if (isEditingMode && event.target === event.currentTarget) {
              editing?.onClearSelection();
            }
          }}
        >
          {layout!.items.map((item) => {
            const renderedView = renderedViewById.get(item.view_id);
            if (!renderedView) {
              return null;
            }
            const view = renderedView.view;
            const bindingMode = getBindingMode(
              dashboard.bindings.find((binding) => binding.view_id === view.id),
            );
            const templatePreview =
              (isPreviewMode || isEditingMode) && bindingMode === "unbound"
                ? getTemplatePreviewOption({
                    optionTemplate: getViewOptionTemplate(view),
                    slots: view.renderer.slots,
                    transforms: view.renderer.transforms,
                    presentation: chartPresentation,
                  })
                : null;
            const isSelected = editing?.selectedViewId === view.id;

            return (
              <article
                key={view.id}
                data-canvas-card={isEditingMode ? "true" : undefined}
                className={`${styles.card} ${isEditingMode ? styles.cardEditing : ""} ${
                  isSelected ? styles.cardEditingSelected : ""
                } ${isReportSurface ? styles.cardReport : ""}`}
                style={buildCardStyle(item)}
                onPointerDown={(event) => {
                  if (!isEditingMode || !shouldStartSelectionIntent(event)) {
                    return;
                  }
                  selectionIntentRef.current = {
                    viewId: view.id,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    canceled: false,
                  };
                }}
                onPointerMove={(event) => {
                  const intent = selectionIntentRef.current;
                  if (!intent || intent.pointerId !== event.pointerId) {
                    return;
                  }
                  if (
                    Math.abs(event.clientX - intent.startX) > SELECTION_MOVE_TOLERANCE_PX ||
                    Math.abs(event.clientY - intent.startY) > SELECTION_MOVE_TOLERANCE_PX
                  ) {
                    intent.canceled = true;
                  }
                }}
                onPointerUp={(event) => {
                  const intent = selectionIntentRef.current;
                  selectionIntentRef.current = null;
                  if (
                    !intent ||
                    intent.pointerId !== event.pointerId ||
                    intent.canceled
                  ) {
                    return;
                  }
                  editing?.onSelectView(intent.viewId);
                }}
                onPointerCancel={() => {
                  selectionIntentRef.current = null;
                }}
              >
                {isEditingMode ? (
                  <div className={styles.editingOverlay}>
                    {editing?.renderCardOverlay({ view, item, renderedView })}
                  </div>
                ) : null}
                <header
                  className={styles.cardHeader}
                  onPointerDown={(event) =>
                    isEditingMode
                      ? editing?.onStartInteraction(event, item, "move")
                      : undefined
                  }
                >
                  <div>
                    <h2 className={styles.cardTitle}>{view.title}</h2>
                    <p className={styles.cardDescription}>{view.description}</p>
                  </div>
                  {showStatusPill ? (
                    <StatusPill
                      status={templatePreview ? "template" : renderedView.status}
                      t={t}
                    />
                  ) : null}
                </header>

                <div className={`${styles.body} ${isReportSurface ? styles.bodyReport : ""}`}>
                  {isEditingMode && editing ? (
                    renderEditingCardBody({
                      view,
                      bindings: editing.bindings.filter((binding) => binding.view_id === view.id),
                      previewResults: editing.previewResults,
                      rendererCheck: editing.previewRendererChecks[view.id],
                      previewState: editing.previewState,
                      hasDataDraft: editing.hasDataDraft,
                      renderedView,
                      t,
                      showChartMeta,
                      chartPresentation,
                    })
                  ) : templatePreview ? (
                    <ViewerChart
                      optionTemplate={templatePreview.option}
                      rowsCount={templatePreview.rowsCount}
                      showMeta={showChartMeta}
                      presentation={chartPresentation}
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
                      showMeta={showChartMeta}
                      presentation={chartPresentation}
                    />
                  )}
                </div>
                {isEditingMode ? (
                  <>
                    <button
                      type="button"
                      data-canvas-resize-handle="true"
                      className={styles.resizeHandle}
                      aria-label={`Resize ${view.title}`}
                      onPointerDown={(event) => editing?.onStartInteraction(event, item, "resize")}
                    />
                  </>
                ) : null}
              </article>
            );
          })}
        </section>
        )}

      </div>
    </div>
  );
}

function buildDashboardGridStyle(
  layout: NonNullable<ReturnType<typeof resolveDashboardLayout>>,
) {
  const style = buildGridStyle(layout);
  return {
    ...style,
    gridAutoRows: cssGridAutoRowsForAuthoring(layout.row_height),
  };
}

function shouldStartSelectionIntent(
  event: ReactPointerEvent<HTMLElement>,
): boolean {
  if (event.pointerType === "mouse" && event.button !== 0) {
    return false;
  }
  if (isInteractiveDashboardTarget(event.target)) {
    return false;
  }
  return true;
}

function isInteractiveDashboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      "button, a, input, select, textarea, [role='button'], [data-canvas-resize-handle]",
    ),
  );
}

function renderEditingCardBody({
  view,
  bindings,
  previewResults,
  rendererCheck,
  previewState,
  hasDataDraft,
  renderedView,
  t,
  showChartMeta,
  chartPresentation,
}: {
  view: DashboardView;
  bindings: Binding[];
  previewResults: BindingResults;
  rendererCheck: RendererChecksByView[string] | undefined;
  previewState: EditingPreviewState;
  hasDataDraft: boolean;
  renderedView: RenderedView;
  t: ReturnType<typeof useI18n>["t"];
  showChartMeta: boolean;
  chartPresentation: DashboardChartPresentationContext;
}) {
  const slots = getViewSlots(view);
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  const rendererSummary = summarizeRendererValidationChecks(rendererCheck);
  const mockBindings = bindings.filter((binding) => getBindingMode(binding) === "mock");
  const liveBindings = bindings.filter((binding) => getBindingMode(binding) !== "mock");
  const bindingResultEntries = bindings.flatMap((binding) => {
    const result = previewResults[binding.id];
    return result ? [{ binding, result }] : [];
  });
  const bindingErrorEntry = bindingResultEntries.find(
    (entry) => entry.result.status === "error",
  );

  if (rendererSummary.status === "error") {
    return <ErrorState message={rendererSummary.reason} t={t} />;
  }

  if (bindingErrorEntry?.result.status === "error") {
    return (
      <ErrorState
        message={
          bindingErrorEntry.result.message ??
          bindingErrorEntry.result.code ??
          t("authoring.canvas.unknownPreviewError")
        }
        t={t}
      />
    );
  }

  if (bindings.length === 0 && !hasDataDraft) {
    const preview = getTemplatePreviewOption({
      optionTemplate: getViewOptionTemplate(view),
      slots: view.renderer.slots,
      transforms: view.renderer.transforms,
      presentation: chartPresentation,
    });
    return (
      <ViewerChart
        optionTemplate={preview.option}
        rowsCount={preview.rowsCount}
        showMeta={showChartMeta}
        presentation={chartPresentation}
      />
    );
  }

  if (bindings.length === 0) {
    return <EmptyState message={t("authoring.canvas.mockOnlyState")} t={t} />;
  }

  if (previewState === "loading" && liveBindings.length > 0) {
    return <LoadingState t={t} />;
  }

  const missingLiveBindingResult = liveBindings.find(
    (binding) => !previewResults[binding.id],
  );
  if (missingLiveBindingResult) {
    return <EmptyState message={t("authoring.canvas.boundNeedsCheckState")} t={t} />;
  }

  if (mockBindings.length > 0) {
    const liveResultEntries = liveBindings.flatMap((binding) => {
      const result = previewResults[binding.id];
      return result && result.status !== "error"
        ? [{ slot_id: result.slot_id, result }]
        : [];
    });
    const mockResultEntries = mockBindings.flatMap((binding) => {
      const slot = slotsById.get(binding.slot_id) ?? slots[0];
      if (!slot) {
        return [];
      }
      const mockRows = binding.mock_data?.rows ?? [];
      const mockValue =
        binding.mock_value ?? createMockValueForSlot(slot.value_kind, mockRows);
      const mockValueCount = estimateValueCount(mockValue);
      const mockBindingResult: BindingResults[string] = {
        view_id: view.id,
        slot_id: slot.id,
        query_id: "__mock__",
        status: mockValueCount === 0 ? "empty" : "ok",
        data: {
          value: mockValue,
          rows: mockRows,
        },
      };

      return [{
        slot_id: slot.id,
        result: mockBindingResult,
        valueCount: mockValueCount,
      }];
    });
    const materializedBindingResults = [
      ...liveResultEntries,
      ...mockResultEntries.map(({ slot_id, result }) => ({ slot_id, result })),
    ];
    const rowsCount = Math.max(
      0,
      ...liveResultEntries.map((entry) =>
        estimateValueCount(entry.result.data.value),
      ),
      ...mockResultEntries.map((entry) => entry.valueCount),
    );

    return (
      <ViewerChart
        optionTemplate={materializeEChartsOptionTemplate({
          template: getViewOptionTemplate(view),
          slots: view.renderer.slots,
          transforms: view.renderer.transforms,
          presentation: chartPresentation,
          bindingResults: materializedBindingResults,
        })}
        rowsCount={rowsCount}
        showMeta={showChartMeta}
        presentation={chartPresentation}
      />
    );
  }

  if (renderedView.status === "error") {
    return (
      <ErrorState
        message={renderedView.message ?? t("viewer.dashboard.batchRequestFailed")}
        t={t}
      />
    );
  }

  if (renderedView.status === "empty" || renderedView.dataCount === 0) {
    return <EmptyState message={t("authoring.canvas.noDataState")} t={t} />;
  }

  return (
    <ViewerChart
      optionTemplate={renderedView.optionTemplate}
      rowsCount={renderedView.dataCount}
      showMeta={showChartMeta}
      presentation={chartPresentation}
    />
  );
}

function ViewerFilterControls({
  dashboard,
  filterValues,
  compact = false,
  onChange,
  t,
}: {
  dashboard: DashboardDocument;
  filterValues: Record<string, JsonValue>;
  compact?: boolean;
  onChange: (nextValues: Record<string, JsonValue>) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <>
      {dashboard.dashboard_spec.filters.flatMap((filter) => {
        const currentValue = filterValues[filter.id] ?? filter.default_value;
        const options =
          filter.kind === "time_range"
            ? FILTERS.map((range) => ({
                label: labelForRange(range, t),
                value: range,
              }))
            : filter.options;

        return options.map((option) => (
          <button
            key={`${filter.id}:${option.value}`}
            type="button"
            className={`${styles.filterButton} ${
              compact ? styles.filterButtonCompact : ""
            } ${currentValue === option.value ? styles.filterButtonActive : ""}`}
            onClick={() =>
              onChange({
                ...filterValues,
                [filter.id]: option.value,
              })
            }
          >
            {filter.kind === "single_select" ? `${filter.label}: ${option.label}` : option.label}
          </button>
        ));
      })}
    </>
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
