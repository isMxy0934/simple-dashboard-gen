"use client";

import { useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  getBindingMode,
  isLiveBinding,
} from "../../../domain/dashboard/bindings";
import {
  getPrimarySlotId,
} from "../../../domain/dashboard/contract-kernel";
import type { PreviewState } from "../state/preview-state";
import { useI18n } from "../../i18n/i18n-context";
import {
  summarizeRendererValidationChecks,
  type RendererChecksByView,
} from "../../../renderers/core/validation-result";
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
import { ViewerDashboard } from "../../viewer/ui/viewer-dashboard";

type ViewBadge = "Draft" | "No Binding" | "Mock" | "Bound" | "Preview OK" | "Error";
type InteractionMode = "move" | "resize";
type ViewConnectionState = "connected" | "mock" | "unbound";

interface AuthoringCanvasPanelProps {
  breakpoint: AuthoringBreakpoint;
  onBreakpointChange: (breakpoint: AuthoringBreakpoint) => void;
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  activeLayout: DashboardBreakpointLayout;
  bindings: Binding[];
  queryDefs: QueryDef[];
  previewResults: BindingResults;
  previewRendererChecks: RendererChecksByView;
  previewState: PreviewState;
  hasDataDraft: boolean;
  selectedViewId: string | null;
  onSelectView: (viewId: string) => void;
  onClearSelection: () => void;
  onDashboardNameChange: (value: string) => void;
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
  breakpoint,
  onBreakpointChange,
  dashboard,
  dashboardId,
  activeLayout,
  bindings,
  queryDefs,
  previewResults,
  previewRendererChecks,
  previewState,
  hasDataDraft,
  selectedViewId,
  onSelectView,
  onClearSelection,
  onDashboardNameChange,
  onEditView,
  onDeleteView,
  onStartInteraction,
  canvasRef,
  styles,
  children,
}: AuthoringCanvasPanelProps) {
  const { t } = useI18n();
  const queryIdSet = new Set(queryDefs.map((query) => query.id));
  const [expandedToolsViewId, setExpandedToolsViewId] = useState<string | null>(null);
  const [confirmingDeleteViewId, setConfirmingDeleteViewId] = useState<string | null>(null);
  return (
    <main className={styles.canvasPanel}>
      <ViewerDashboard
        dashboardId={dashboardId ?? "draft"}
        version={0}
        dashboard={dashboard}
        updatedAt={new Date().toISOString()}
        mode="editing"
        editing={{
          viewMode: breakpoint,
          previewResults,
          previewRendererChecks,
          previewState,
          hasDataDraft,
          selectedViewId,
          bindings,
          canvasRef,
          onViewModeChange: onBreakpointChange,
          onDashboardNameChange,
          onSelectView,
          onClearSelection,
          onStartInteraction,
          renderCardOverlay: ({ view }) => {
            const viewBindings = findBindingsForView(bindings, view);
            const binding = viewBindings[0];
            const bindingResultsForView = viewBindings.flatMap((viewBinding) => {
              const result = previewResults[viewBinding.id];
              return result ? [result] : [];
            });
            const rendererCheck = previewRendererChecks[view.id];
            const hasLiveBinding = Boolean(
              viewBindings.some(
                (viewBinding) =>
                  isLiveBinding(viewBinding) &&
                  queryIdSet.has(viewBinding.query_id),
              ),
            );
            const connectionState = getViewConnectionState(binding, queryIdSet);
            const badge = getViewBadge(
              hasLiveBinding,
              connectionState,
              bindingResultsForView,
              rendererCheck,
              previewState,
              hasDataDraft,
            );
            const toolsExpanded = expandedToolsViewId === view.id;
            const confirmingDelete = confirmingDeleteViewId === view.id;

            return (
              <>
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
              </>
            );
          },
        }}
      />

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
  bindingResults: BindingResults[string][],
  rendererCheck: RendererChecksByView[string] | undefined,
  previewState: PreviewState,
  hasDataDraft: boolean,
): ViewBadge {
  if (summarizeRendererValidationChecks(rendererCheck).status === "error") {
    return "Error";
  }

  if (bindingResults.some((bindingResult) => bindingResult.status === "error")) {
    return "Error";
  }

  if (
    bindingResults.some(
      (bindingResult) =>
        bindingResult.status === "ok" || bindingResult.status === "empty",
    )
  ) {
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
