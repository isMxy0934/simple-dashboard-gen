"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
} from "react";
import { getBindingMode } from "../../../domain/dashboard/bindings";
import { getViewOptionTemplate } from "../../../domain/dashboard/contract-kernel";
import { reconcileDashboardDocumentLayouts } from "../../../domain/dashboard/document";
import { resolveViewPresentationContext } from "../../../presentation/dashboard/presentation-context";
import { resolveDashboardTemplateRuntime } from "../../../presentation/dashboard/runtime";
import type {
  BindingResults,
  DashboardDocument,
  JsonValue,
} from "../../../contracts";
import type { TemplateViewKindVisualContract } from "../../../contracts/dashboard-template-capability-registry";
import { getTemplatePreviewOption } from "../../../renderers/echarts/preview/sample-option";
import { deriveRenderedViews } from "../state/rendered-views";
import { ViewerChart } from "./viewer-chart";
import styles from "./viewer.module.css";
import {
  buildCardStyle,
  buildGridStyle,
  buildDefaultViewerFilterValues,
  getTimeRangeFilterValue,
  getVisibleViews,
  type ViewMode,
  hasAnyBindingForView,
} from "../state/viewer-state";
import { executePreviewRequest, executeViewerBatch } from "../api/viewer-api";
import {
  summarizeRendererValidationChecks,
  type RendererChecksByView,
} from "../../../renderers/core/validation-result";
import { buildDashboardChartLabels } from "../../i18n/chart-labels";
import { useI18n } from "../../i18n/i18n-context";
import { formatReportDisplayName } from "../../i18n/report-display-name";
import { resolveDashboardLayout } from "../../dashboard/render-input";
import { cssGridAutoRowsForAuthoring } from "../../utils/layout-presentation";
import {
  buildDashboardRenderModel,
  type DashboardRenderMode,
} from "../../dashboard/render";
import { groupFiltersForViewer } from "../template-runtime/filter-placement";
import { ViewerDashboardChrome } from "./viewer-dashboard-chrome";
import { EditingCardBody } from "./viewer-editing-card-body";
import { ViewerRendererWarningStack } from "./viewer-renderer-warning";
import { ViewLocalFilterControls } from "./view-local-filter-controls";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  StatusPill,
} from "./viewer-dashboard-states";
import type { ViewerDashboardEditingOptions } from "./viewer-dashboard-types";

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
  const templateRuntime = useMemo(
    () => resolveDashboardTemplateRuntime(normalizedDashboard),
    [normalizedDashboard],
  );
  const { chartPresentation, isReportSurface } = presentationContext;
  const reportThemeStyle = presentationContext.cssVariables as CSSProperties | undefined;
  const renderedViews = deriveRenderedViews(
    visibleViews,
    effectiveBindingResults,
    statusMap,
    (view) =>
      resolveViewPresentationContext(normalizedDashboard, {
        viewId: view.id,
        chartLabels,
      }).chartPresentation,
  );
  const renderedViewById = new Map(
    renderedViews.map((renderedView) => [renderedView.view.id, renderedView]),
  );
  const { viewLocalByViewId } = useMemo(
    () => groupFiltersForViewer(normalizedDashboard),
    [normalizedDashboard],
  );
  const showDashboardFallback =
    !layoutResolution.layout ||
    (effectiveRequestState === "ready" && visibleViews.length === 0 && !isReportSurface);
  const showZeroViewCanvas =
    isReportSurface &&
    templateRuntime.zeroView.mode === "full_shell" &&
    visibleViews.length === 0;

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
    templateRuntime.zeroView.showControlBand &&
    templateRuntime.controlBand.placement === "below_header";
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
      className={`${styles.shell} ${isEditingMode ? styles.shellEditing : ""}`}
      data-dashboard-surface={isReportSurface ? "report" : undefined}
      style={reportThemeStyle}
    >
      <div className={`${styles.page} ${isEditingMode ? styles.pageEditing : ""} ${
        isReportSurface ? styles.pageReport : ""
      }`}>
        <div className={isReportSurface ? styles.reportShell : undefined}>
          <ViewerDashboardChrome
            runtime={templateRuntime}
            dashboard={normalizedDashboard}
            dashboardTitle={renderDashboardTitle()}
            version={version}
            updatedAt={updatedAt}
            isEditingMode={isEditingMode}
            isPreviewMode={isPreviewMode}
            isReportSurface={isReportSurface}
            showPreviewChrome={showPreviewChrome}
            showPreviewStatusLine={showPreviewStatusLine}
            showReportControls={showReportControls}
            showPublishedControls={showPublishedControls}
            effectiveRequestState={effectiveRequestState}
            effectiveRequestMessage={effectiveRequestMessage}
            selectedFilterValues={selectedFilterValues}
            selectedRange={selectedRange}
            viewMode={viewMode}
            visibleBoundViewCount={visibleBoundViews.length}
            onFilterValuesChange={setSelectedFilterValues}
            onViewModeChange={setViewMode}
            onReload={() => setReloadTick((value) => value + 1)}
            t={t}
          />

          <div className={isReportSurface ? styles.reportCanvas : undefined}>
            {showDashboardFallback ? (
              layoutResolution.error ? (
                <ErrorState message={layoutResolution.error} t={t} />
              ) : (
                <EmptyState
                  message={t("viewer.dashboard.noRenderableViews")}
                  t={t}
                />
              )
            ) : showZeroViewCanvas ? (
              <section className={styles.zeroViewCanvas}>
                <EmptyState
                  message={t("viewer.dashboard.noRenderableViews")}
                  t={t}
                />
              </section>
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
                  const viewPresentationContext = resolveViewPresentationContext(
                    normalizedDashboard,
                    {
                      viewId: view.id,
                      chartLabels,
                    },
                  );
                  const viewFamily = viewPresentationContext.viewFamily;
                  const viewVisual = viewPresentationContext.viewVisual;
                  const localFilterPlacement =
                    viewVisual?.localFilterPlacement ?? viewFamily?.localFilterPlacement;
                  const templatePreview =
                    (isPreviewMode || isEditingMode) && bindingMode === "unbound"
                      ? getTemplatePreviewOption({
                          optionTemplate: getViewOptionTemplate(view),
                          slots: view.renderer.slots,
                          transforms: view.renderer.transforms,
                          presentation: viewPresentationContext.chartPresentation,
                        })
                      : null;
                  const isSelected = editing?.selectedViewId === view.id;
                  const rendererSummary = summarizeRendererValidationChecks(
                    effectiveRendererChecks[view.id],
                  );
                  const rendererWarning =
                    rendererSummary.status === "warning" ? rendererSummary.reason : null;
                  const viewLocalFilters = viewLocalByViewId.get(view.id) ?? [];
                  const inlineLocalFilters =
                    localFilterPlacement === "inline" ? viewLocalFilters : [];
                  const toolbarLocalFilters =
                    localFilterPlacement === "toolbar" ? viewLocalFilters : [];

                  return (
                    <article
                      key={view.id}
                      data-canvas-card={isEditingMode ? "true" : undefined}
                      data-view-family={viewFamily?.id}
                      data-view-card-chrome={viewVisual?.cardChrome ?? viewFamily?.cardChrome}
                      data-view-body-style={viewVisual?.bodyStyle ?? viewFamily?.bodyStyle}
                      data-view-body-composition={viewVisual?.bodyComposition}
                      className={`${styles.card} ${isEditingMode ? styles.cardEditing : ""} ${
                        isSelected ? styles.cardEditingSelected : ""
                      } ${isReportSurface ? styles.cardReport : ""}`}
                      style={buildVisualCardStyle(item, viewVisual)}
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
                          Math.abs(event.clientX - intent.startX) >
                            SELECTION_MOVE_TOLERANCE_PX ||
                          Math.abs(event.clientY - intent.startY) >
                            SELECTION_MOVE_TOLERANCE_PX
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
                        data-view-header-layout={viewVisual?.headerLayout ?? viewFamily?.headerLayout}
                        data-status-placement={viewVisual?.statusPlacement ?? viewFamily?.statusPlacement}
                        onPointerDown={(event) =>
                          isEditingMode
                            ? editing?.onStartInteraction(event, item, "move")
                            : undefined
                        }
                      >
                        <div className={styles.cardHeaderText}>
                          <h2 className={styles.cardTitle}>{view.title}</h2>
                          <p className={styles.cardDescription}>{view.description}</p>
                          {inlineLocalFilters.length > 0 ? (
                            <div
                              className={styles.inlineLocalFilterBand}
                              data-local-filter-placement={localFilterPlacement}
                            >
                              <ViewLocalFilterControls
                                filters={inlineLocalFilters}
                                filterValues={selectedFilterValues}
                                disabled={isEditingMode}
                                onChange={setSelectedFilterValues}
                                t={t}
                              />
                            </div>
                          ) : null}
                        </div>
                        {showStatusPill ? (
                          <StatusPill
                            status={templatePreview ? "template" : renderedView.status}
                            t={t}
                          />
                        ) : null}
                      </header>

                      {toolbarLocalFilters.length > 0 ? (
                        <div
                          className={styles.viewLocalFilterBand}
                          data-local-filter-placement={localFilterPlacement}
                        >
                          <ViewLocalFilterControls
                            filters={toolbarLocalFilters}
                            filterValues={selectedFilterValues}
                            disabled={isEditingMode}
                            onChange={setSelectedFilterValues}
                            t={t}
                          />
                        </div>
                      ) : null}

                      <div
                        className={`${styles.body} ${isReportSurface ? styles.bodyReport : ""}`}
                        data-view-body-style={viewVisual?.bodyStyle ?? viewFamily?.bodyStyle}
                        data-view-body-composition={viewVisual?.bodyComposition}
                      >
                        {isEditingMode && editing ? (
                          <EditingCardBody
                            view={view}
                            bindings={editing.bindings.filter(
                              (binding) => binding.view_id === view.id,
                            )}
                            previewResults={editing.previewResults}
                            rendererCheck={editing.previewRendererChecks[view.id]}
                            previewState={editing.previewState}
                            hasDataDraft={editing.hasDataDraft}
                            renderedView={renderedView}
                            t={t}
                            showChartMeta={showChartMeta}
                            chartPresentation={viewPresentationContext.chartPresentation}
                          />
                        ) : templatePreview ? (
                          <ViewerRendererWarningStack warning={rendererWarning}>
                            <ViewerChart
                              option={templatePreview.option}
                              rowsCount={templatePreview.rowsCount}
                              showMeta={showChartMeta}
                            />
                          </ViewerRendererWarningStack>
                        ) : renderedView.status === "loading" ? (
                          <ViewerRendererWarningStack warning={rendererWarning}>
                            <LoadingState t={t} />
                          </ViewerRendererWarningStack>
                        ) : renderedView.status === "error" ? (
                          <ErrorState
                            message={
                              renderedView.message ?? t("viewer.dashboard.batchRequestFailed")
                            }
                            t={t}
                          />
                        ) : renderedView.status === "empty" ? (
                          <ViewerRendererWarningStack warning={rendererWarning}>
                            <EmptyState
                              message={
                                renderedView.message ??
                                t("viewer.dashboard.noDataForSelectedTimeRange")
                              }
                              t={t}
                            />
                          </ViewerRendererWarningStack>
                        ) : (
                          <ViewerRendererWarningStack warning={rendererWarning}>
                            <ViewerChart
                              option={renderedView.option}
                              rowsCount={renderedView.dataCount}
                              showMeta={showChartMeta}
                            />
                          </ViewerRendererWarningStack>
                        )}
                      </div>
                      {isEditingMode ? (
                        <button
                          type="button"
                          data-canvas-resize-handle="true"
                          className={styles.resizeHandle}
                          aria-label={`Resize ${view.title}`}
                          onPointerDown={(event) =>
                            editing?.onStartInteraction(event, item, "resize")
                          }
                        />
                      ) : null}
                    </article>
                  );
                })}
              </section>
            )}
          </div>
        </div>

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

function buildVisualCardStyle(
  item: Parameters<typeof buildCardStyle>[0],
  visual: TemplateViewKindVisualContract | null,
): CSSProperties {
  const style = {
    ...buildCardStyle(item),
  } as CSSProperties & Record<`--${string}`, string>;
  const tokens = visual?.tokens;
  if (tokens?.cardAccentColor) {
    style["--dashboard-view-card-accent-color"] = tokens.cardAccentColor;
  }
  if (tokens?.cardAccentSoftColor) {
    style["--dashboard-view-card-accent-soft-color"] = tokens.cardAccentSoftColor;
  }
  if (tokens?.cardBorderColor) {
    style["--dashboard-view-card-border-color"] = tokens.cardBorderColor;
  }
  if (tokens?.cardRadius) {
    style["--dashboard-view-card-radius"] = tokens.cardRadius;
  }
  if (tokens?.cardShadow) {
    style["--dashboard-view-card-shadow"] = tokens.cardShadow;
  }
  if (tokens?.headerPadding) {
    style["--dashboard-view-header-padding"] = tokens.headerPadding;
  }
  if (tokens?.inlineFilterPaddingTop) {
    style["--dashboard-view-inline-filter-padding-top"] = tokens.inlineFilterPaddingTop;
  }
  if (tokens?.bodyPadding) {
    style["--dashboard-view-body-padding"] = tokens.bodyPadding;
  }
  if (tokens?.bodyBackground) {
    style["--dashboard-view-body-background"] = tokens.bodyBackground;
  }
  return style;
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
