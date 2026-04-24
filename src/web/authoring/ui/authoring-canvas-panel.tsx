"use client";

import { useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  createMockValueForSlot,
  getBindingMode,
  isLiveBinding,
  isMockBinding,
} from "../../../domain/dashboard/bindings";
import {
  getPrimarySlotId,
  getViewOptionTemplate,
  getViewSlots,
} from "../../../domain/dashboard/contract-kernel";
import type { PreviewState } from "../state/preview-state";
import { useI18n } from "../../i18n/i18n-context";
import { estimateValueCount } from "../../../renderers/core/slot-path";
import {
  summarizeRendererValidationChecks,
  type RendererChecksByView,
} from "../../../renderers/core/validation-result";
import { cssGridAutoRowsForAuthoring } from "../../utils/layout-presentation";
import {
  getTemplatePreviewOption,
} from "../../../renderers/echarts/preview/sample-option";
import { injectBindingResultIntoEChartsOptionTemplate } from "../../../renderers/echarts/browser/materialize-option";
import type {
  Binding,
  BindingResults,
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardView,
  QueryDef,
} from "../../../contracts";
import type { AuthoringBreakpoint } from "../state/authoring-state";
import { AuthoringViewPreviewSections } from "./authoring-view-preview-sections";
import { TemplatePreview } from "./template-preview";

type ViewBadge = "Draft" | "No Binding" | "Mock" | "Bound" | "Preview OK" | "Error";
type InteractionMode = "move" | "resize";
type ViewConnectionState = "connected" | "mock" | "unbound";

interface AuthoringCanvasPanelProps {
  breakpointLabel: string;
  breakpoint: AuthoringBreakpoint;
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  activeLayout: DashboardBreakpointLayout;
  viewMap: Map<string, DashboardView>;
  bindings: Binding[];
  queryDefs: QueryDef[];
  previewResults: BindingResults;
  previewRendererChecks: RendererChecksByView;
  previewState: PreviewState;
  hasDataDraft: boolean;
  selectedViewId: string | null;
  onSelectView: (viewId: string) => void;
  onClearSelection: () => void;
  onEditView: (viewId: string) => void;
  onDeleteView: (viewId: string, viewTitle: string) => void;
  onStartInteraction: (
    event: ReactPointerEvent<HTMLElement>,
    item: DashboardLayoutItem,
    mode: InteractionMode,
  ) => void;
  canvasRef: RefObject<HTMLDivElement | null>;
  styles: Record<string, string>;
  children?: ReactNode;
}

export function AuthoringCanvasPanel({
  breakpointLabel,
  breakpoint,
  dashboard,
  dashboardId,
  activeLayout,
  viewMap,
  bindings,
  queryDefs,
  previewResults,
  previewRendererChecks,
  previewState,
  hasDataDraft,
  selectedViewId,
  onSelectView,
  onClearSelection,
  onEditView,
  onDeleteView,
  onStartInteraction,
  canvasRef,
  styles,
  children,
}: AuthoringCanvasPanelProps) {
  const { t } = useI18n();
  const isEmptyCanvas = activeLayout.items.length === 0;
  const queryIdSet = new Set(queryDefs.map((query) => query.id));
  const [expandedToolsViewId, setExpandedToolsViewId] = useState<string | null>(null);
  const [confirmingDeleteViewId, setConfirmingDeleteViewId] = useState<string | null>(null);
  return (
    <main className={styles.canvasPanel}>
      <div
        ref={canvasRef}
        className={`${styles.canvasGrid} ${isEmptyCanvas ? styles.canvasGridBlank : ""}`}
        style={buildGridStyle(activeLayout)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClearSelection();
          }
        }}
      >
        {isEmptyCanvas
          ? (
            <section className={styles.emptyCanvasState}>
              <span className={styles.emptyCanvasEyebrow}>
                {t("authoring.canvas.emptyEyebrow")}
              </span>
              <h3>{t("authoring.canvas.emptyTitle")}</h3>
              <p>{t("authoring.canvas.emptyBody")}</p>
            </section>
          )
          : activeLayout.items.map((item) => {
            const view = viewMap.get(item.view_id);
            if (!view) {
              return null;
            }

            const viewBindings = findBindingsForView(bindings, view);
            const binding = viewBindings[0];
            const bindingResult = binding ? previewResults[binding.id] : undefined;
            const rendererCheck = previewRendererChecks[view.id];
            const hasLiveBinding = Boolean(
              isLiveBinding(binding) && queryIdSet.has(binding.query_id),
            );
            const connectionState = getViewConnectionState(binding, queryIdSet);
            const badge = getViewBadge(
              hasLiveBinding,
              connectionState,
              bindingResult,
              rendererCheck,
              previewState,
              hasDataDraft,
            );
            const isSelected = view.id === selectedViewId;
            const toolsExpanded = expandedToolsViewId === view.id;
            const confirmingDelete = confirmingDeleteViewId === view.id;

            return (
              <article
                key={`${breakpointLabel}-${view.id}`}
                data-canvas-card="true"
                className={`${styles.canvasCard} ${
                  isSelected ? styles.canvasCardSelected : ""
                }`}
                style={buildCardStyle(item)}
                onClick={() => onSelectView(view.id)}
              >
              <div className={styles.cardOverlay}>
                <button
                  type="button"
                  className={styles.cardOverlayToggle}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedToolsViewId((current) =>
                      current === view.id ? null : view.id,
                    );
                  }}
                >
                  {formatViewBadgeLabel(t, badge)}
                </button>

                {toolsExpanded ? (
                  <div
                    className={styles.cardOverlayPanel}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className={badgeClassName(styles, badge)}>
                      {formatViewBadgeLabel(t, badge)}
                    </div>
                    <div
                      className={`${styles.connectionChip} ${
                        connectionState === "connected"
                          ? styles.connectionChipConnected
                          : connectionState === "mock"
                            ? styles.connectionChipMock
                            : styles.connectionChipUnbound
                      }`}
                    >
                      <span className={styles.connectionDot} aria-hidden="true" />
                      {connectionState === "connected"
                        ? t("authoring.canvas.connectionConnected")
                        : connectionState === "mock"
                          ? t("authoring.canvas.connectionMock")
                          : t("authoring.canvas.connectionUnbound")}
                    </div>
                    <AuthoringViewPreviewSections
                      view={view}
                      dashboard={dashboard}
                      breakpoint={breakpoint}
                      dashboardId={dashboardId}
                      bindings={bindings}
                      queryDefs={queryDefs}
                      previewResults={previewResults}
                      styles={styles}
                    />
                    {confirmingDelete ? (
                      <>
                        <p className={styles.cardConfirmMessage}>
                          {t("authoring.topbar.deleteViewConfirm", { title: view.title })}
                        </p>
                        <div className={styles.cardOverlayActions}>
                          <button
                            type="button"
                            className={styles.cardDeleteButton}
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmingDeleteViewId(null);
                              setExpandedToolsViewId(null);
                              onDeleteView(view.id, view.title);
                            }}
                          >
                            {t("authoring.canvas.confirmDelete")}
                          </button>
                          <button
                            type="button"
                            className={styles.cardEditButton}
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmingDeleteViewId(null);
                            }}
                          >
                            {t("authoring.canvas.cancelDelete")}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className={styles.cardOverlayActions}>
                        <button
                          type="button"
                          className={styles.cardEditButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            onEditView(view.id);
                          }}
                        >
                          {t("authoring.canvas.edit")}
                        </button>
                        <button
                          type="button"
                          className={styles.cardDeleteButton}
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirmingDeleteViewId(view.id);
                          }}
                        >
                          {t("authoring.canvas.delete")}
                        </button>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              <header
                className={`${styles.canvasCardHeader} ${styles.canvasCardHeaderAdjustable}`}
                onPointerDown={(event) => onStartInteraction(event, item, "move")}
              >
                <div>
                  <h3>{view.title}</h3>
                </div>
              </header>

              <p className={styles.canvasCardDescription}>{view.description}</p>

              <div className={styles.canvasCardChartSlot}>
                {renderCanvasBody({
                  previewState,
                  view,
                  bindings: viewBindings,
                  previewResults,
                  rendererCheck,
                  hasDataDraft,
                  styles,
                  t,
                })}
              </div>

              <button
                type="button"
                className={styles.resizeHandle}
                aria-label={t("authoring.canvas.resizeHandleAria", { title: view.title })}
                onPointerDown={(event) => onStartInteraction(event, item, "resize")}
              />
              </article>
            );
          })
        }
      </div>

      {children}
    </main>
  );
}

function getViewConnectionState(
  binding: Binding | undefined,
  queryIdSet: Set<string>,
): ViewConnectionState {
  const bindingMode = getBindingMode(binding);
  if (bindingMode === "unbound") {
    return "unbound";
  }

  if (isLiveBinding(binding) && queryIdSet.has(binding.query_id)) {
    return "connected";
  }

  return "mock";
}

function buildGridStyle(layout: DashboardBreakpointLayout): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
    gridAutoRows: cssGridAutoRowsForAuthoring(layout.row_height),
  };
}

function buildCardStyle(item: DashboardLayoutItem): CSSProperties {
  return {
    gridColumn: `${item.x + 1} / span ${item.w}`,
    gridRow: `${item.y + 1} / span ${item.h}`,
  };
}

function findBindingsForView(bindings: Binding[], view: DashboardView): Binding[] {
  const primarySlotId = getPrimarySlotId(view);
  return bindings
    .filter((binding) => binding.view_id === view.id)
    .sort((left, right) => {
      const leftPriority = left.slot_id === primarySlotId ? 0 : 1;
      const rightPriority = right.slot_id === primarySlotId ? 0 : 1;
      return leftPriority - rightPriority;
    });
}

function getViewBadge(
  hasLiveBinding: boolean,
  connectionState: ViewConnectionState,
  bindingResult: BindingResults[string] | undefined,
  rendererCheck: RendererChecksByView[string] | undefined,
  previewState: PreviewState,
  hasDataDraft: boolean,
): ViewBadge {
  if (summarizeRendererValidationChecks(rendererCheck).status === "error") {
    return "Error";
  }

  if (bindingResult?.status === "error") {
    return "Error";
  }

  if (bindingResult && (bindingResult.status === "ok" || bindingResult.status === "empty")) {
    return "Preview OK";
  }

  if (connectionState === "mock") {
    return "Mock";
  }

  if (hasLiveBinding) {
    return "Bound";
  }

  if (previewState === "loading" || hasDataDraft) {
    return "No Binding";
  }

  return "Draft";
}

function badgeClassName(
  css: Record<string, string>,
  badge: ViewBadge,
): string {
  const tone =
    badge === "Draft"
      ? css.cardBadgeDraft
      : badge === "No Binding"
        ? css.cardBadgeNeutral
        : badge === "Mock"
          ? css.cardBadgeMock
        : badge === "Bound"
          ? css.cardBadgeBound
          : badge === "Preview OK"
            ? css.cardBadgeOk
            : css.cardBadgeError;

  return `${css.cardBadge} ${tone}`;
}

function formatViewBadgeLabel(
  t: (key: string, values?: Record<string, string | number>) => string,
  badge: ViewBadge,
): string {
  switch (badge) {
    case "Draft":
      return t("authoring.canvas.badgeDraft");
    case "No Binding":
      return t("authoring.canvas.badgeNoBinding");
    case "Mock":
      return t("authoring.canvas.badgeMock");
    case "Bound":
      return t("authoring.canvas.badgeBound");
    case "Preview OK":
      return t("authoring.canvas.badgePreviewOk");
    case "Error":
      return t("authoring.canvas.badgeError");
  }
}

function renderCanvasBody({
  previewState,
  view,
  bindings,
  previewResults,
  rendererCheck,
  hasDataDraft,
  styles,
  t,
}: {
  previewState: PreviewState;
  view: DashboardView;
  bindings: Binding[];
  previewResults: BindingResults;
  rendererCheck: RendererChecksByView[string] | undefined;
  hasDataDraft: boolean;
  styles: Record<string, string>;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const binding = bindings[0];
  const bindingResult = binding ? previewResults[binding.id] : undefined;
  const slotsById = new Map(getViewSlots(view).map((slot) => [slot.id, slot]));
  const rendererSummary = summarizeRendererValidationChecks(rendererCheck);

  if (rendererSummary.status === "error") {
    return (
      <div className={styles.cardErrorState}>
        <strong>{t("authoring.canvas.rendererErrorLabel")}</strong>
        <span>{rendererSummary.reason}</span>
      </div>
    );
  }

  if (isMockBinding(binding)) {
    const mockRows = binding.mock_data.rows;
    const slot =
      slotsById.get(binding.slot_id) ?? getViewSlots(view)[0];
    const mockValue = createMockValueForSlot(slot?.value_kind, mockRows);
    const mockBindingResult: BindingResults[string] = {
      view_id: view.id,
      slot_id: binding.slot_id,
      query_id: "__mock__",
      status: mockRows.length === 0 ? "empty" : "ok",
      data: {
        value: mockValue,
        rows: mockRows,
      },
    };

    return (
      <TemplatePreview
        optionTemplate={
          slot
            ? injectBindingResultIntoEChartsOptionTemplate(
                getViewOptionTemplate(view),
                slot,
                mockBindingResult,
              )
            : getViewOptionTemplate(view)
        }
        rowsCount={estimateValueCount(mockValue)}
      />
    );
  }

  if (!binding && !hasDataDraft) {
    const preview = getTemplatePreviewOption({
      optionTemplate: getViewOptionTemplate(view),
      slots: view.renderer.slots,
    });
    return (
      <TemplatePreview optionTemplate={preview.option} rowsCount={preview.rowsCount} />
    );
  }

  if (!binding) {
    return (
      <div className={styles.cardState}>
        {t("authoring.canvas.mockOnlyState")}
      </div>
    );
  }

  if (previewState === "loading") {
    return <div className={styles.cardState}>{t("authoring.canvas.previewLoadingState")}</div>;
  }

  if (!bindingResult) {
    return <div className={styles.cardState}>{t("authoring.canvas.boundNeedsCheckState")}</div>;
  }

  if (bindingResult.status === "error") {
    return (
      <div className={styles.cardErrorState}>
        <strong>{bindingResult.code ?? "PREVIEW_ERROR"}</strong>
        <span>{bindingResult.message ?? t("authoring.canvas.unknownPreviewError")}</span>
      </div>
    );
  }

  const option = bindings.reduce((currentOption, currentBinding) => {
    const currentResult = previewResults[currentBinding.id];
    const slotId = currentBinding.slot_id;
    const slot = slotsById.get(slotId);

    if (!slot || !currentResult || currentResult.status === "error") {
      return currentOption;
    }

    return injectBindingResultIntoEChartsOptionTemplate(currentOption, slot, currentResult);
  }, getViewOptionTemplate(view));

  const totalCount = bindings.reduce((count, currentBinding) => {
    const currentResult = previewResults[currentBinding.id];
    if (!currentResult || currentResult.status === "error") {
      return count;
    }
    return count + estimateValueCount(currentResult.data.value);
  }, 0);

  if (totalCount === 0) {
    return (
      <div className={styles.cardState}>
        {t("authoring.canvas.noDataState")}
      </div>
    );
  }

  return (
    <TemplatePreview
      optionTemplate={option}
      rowsCount={totalCount}
    />
  );
}
