"use client";

import { useState } from "react";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  getBindingMode,
  isLiveBinding,
  isMockBinding,
} from "../../../domain/dashboard/bindings";
import {
  getPrimarySlotId,
  getViewOptionTemplate,
  getViewSlots,
} from "../../../domain/dashboard/contract-kernel";
import { getTemplatePreviewOption } from "../../../domain/rendering/template-preview";
import type { PreviewState } from "../state/preview-state";
import { cssGridAutoRowsForLayout } from "../../../domain/dashboard/layout";
import { injectBindingResultIntoOptionTemplate } from "../../../domain/rendering/option-template";
import { estimateValueCount } from "../../../domain/rendering/slot-injection";
import type {
  Binding,
  BindingResults,
  DashboardBreakpointLayout,
  DashboardLayoutItem,
  DashboardView,
  QueryDef,
} from "../../../contracts";
import { TemplatePreview } from "./template-preview";

type ViewBadge = "Draft" | "No Binding" | "Mock" | "Bound" | "Preview OK" | "Error";
type InteractionMode = "move" | "resize";
type ViewConnectionState = "connected" | "mock" | "unbound";

interface AuthoringCanvasPanelProps {
  breakpointLabel: string;
  activeLayout: DashboardBreakpointLayout;
  viewMap: Map<string, DashboardView>;
  bindings: Binding[];
  queryDefs: QueryDef[];
  previewResults: BindingResults;
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
  canvasRef: React.RefObject<HTMLDivElement | null>;
  styles: Record<string, string>;
  children?: ReactNode;
}

export function AuthoringCanvasPanel({
  breakpointLabel,
  activeLayout,
  viewMap,
  bindings,
  queryDefs,
  previewResults,
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
  const queryIdSet = new Set(queryDefs.map((query) => query.id));
  const [expandedToolsViewId, setExpandedToolsViewId] = useState<string | null>(null);
  return (
    <main className={styles.canvasPanel}>
      <div
        ref={canvasRef}
        className={`${styles.canvasGrid} ${styles.canvasGridBlank}`}
        style={buildGridStyle(activeLayout)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClearSelection();
          }
        }}
      >
        {activeLayout.items.map((item) => {
          const view = viewMap.get(item.view_id);
          if (!view) {
            return null;
          }

          const viewBindings = findBindingsForView(bindings, view);
          const binding = viewBindings[0];
          const bindingResult = binding ? previewResults[binding.id] : undefined;
          const bindingMode = getBindingMode(binding);
          const hasLiveBinding = Boolean(
            isLiveBinding(binding) && queryIdSet.has(binding.query_id),
          );
          const connectionState = getViewConnectionState(binding, queryIdSet);
          const badge = getViewBadge(
            hasLiveBinding,
            connectionState,
            bindingResult,
            previewState,
            hasDataDraft,
          );
          const isSelected = view.id === selectedViewId;
          const toolsExpanded = expandedToolsViewId === view.id;

          return (
            <article
              key={`${breakpointLabel}-${view.id}`}
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
                  {badge}
                </button>

                {toolsExpanded ? (
                  <div
                    className={styles.cardOverlayPanel}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className={badgeClassName(styles, badge)}>{badge}</div>
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
                        ? "SQL + Binding"
                        : connectionState === "mock"
                          ? "Mock"
                          : "Unbound"}
                    </div>
                    <div className={styles.cardOverlayActions}>
                      <button
                        type="button"
                        className={styles.cardEditButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditView(view.id);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.cardDeleteButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteView(view.id, view.title);
                        }}
                      >
                        Delete
                      </button>
                    </div>
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
                  hasDataDraft,
                  styles,
                })}
              </div>

              <button
                type="button"
                className={styles.resizeHandle}
                aria-label={`Resize ${view.title}`}
                onPointerDown={(event) => onStartInteraction(event, item, "resize")}
              />
            </article>
          );
        })}
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
    gridAutoRows: cssGridAutoRowsForLayout(layout.row_height),
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
  previewState: PreviewState,
  hasDataDraft: boolean,
): ViewBadge {
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

function renderCanvasBody({
  previewState,
  view,
  bindings,
  previewResults,
  hasDataDraft,
  styles,
}: {
  previewState: PreviewState;
  view: DashboardView;
  bindings: Binding[];
  previewResults: BindingResults;
  hasDataDraft: boolean;
  styles: Record<string, string>;
}) {
  const binding = bindings[0];
  const bindingResult = binding ? previewResults[binding.id] : undefined;
  const slotsById = new Map(getViewSlots(view).map((slot) => [slot.id, slot]));

  if (isMockBinding(binding)) {
    const mockRows = binding.mock_data.rows;
    const mockBindingResult: BindingResults[string] = {
      view_id: view.id,
      slot_id: binding.slot_id,
      query_id: "__mock__",
      status: mockRows.length === 0 ? "empty" : "ok",
      data: {
        value: mockRows,
        rows: mockRows,
      },
    };

    return (
      <TemplatePreview
        optionTemplate={injectBindingResultIntoOptionTemplate(
          getViewOptionTemplate(view),
          {
            id: binding.slot_id,
            path: slotsById.get(binding.slot_id)?.path ?? "",
            value_kind: "rows",
          },
          mockBindingResult,
        )}
        rowsCount={mockRows.length}
      />
    );
  }

  if (!binding && !hasDataDraft) {
    const preview = getTemplatePreviewOption(getViewOptionTemplate(view));
    return (
      <TemplatePreview optionTemplate={preview.option} rowsCount={preview.rowsCount} />
    );
  }

  if (!binding) {
    return (
      <div className={styles.cardState}>
        Mock preview only. Let AI generate SQL + binding or open advanced fallback mode.
      </div>
    );
  }

  if (previewState === "loading") {
    return <div className={styles.cardState}>Preview is running for bound views...</div>;
  }

  if (!bindingResult) {
    return <div className={styles.cardState}>Bound. Apply an AI data draft or run Preview.</div>;
  }

  if (bindingResult.status === "error") {
    return (
      <div className={styles.cardErrorState}>
        <strong>{bindingResult.code ?? "PREVIEW_ERROR"}</strong>
        <span>{bindingResult.message ?? "Unknown preview error."}</span>
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

    return injectBindingResultIntoOptionTemplate(currentOption, slot, currentResult);
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
        Preview OK, but no data matched the current filter.
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
