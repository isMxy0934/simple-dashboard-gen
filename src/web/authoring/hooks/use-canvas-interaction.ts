"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  type AuthoringBreakpoint,
  type MobileLayoutMode,
} from "../state/authoring-state";
import { cloneDashboardDocument } from "../../../domain/dashboard/document";
import {
  effectiveLayoutRowHeight,
  generateMobileLayout,
  MAX_LAYOUT_ROW_SPAN,
  reconcileLayout,
} from "../../../domain/dashboard/layout";
import type {
  DashboardDocument,
  DashboardLayoutItem,
} from "../../../contracts";
import { getAuthoringLayout } from "./use-authoring-controller";

type InteractionMode = "move" | "resize";

interface ActiveInteraction {
  mode: InteractionMode;
  breakpoint: AuthoringBreakpoint;
  viewId: string;
  startX: number;
  startY: number;
  startItem: DashboardLayoutItem;
  lastAppliedItem: DashboardLayoutItem;
  hasEffectiveDelta: boolean;
  /** Resize/move target for Pointer Capture API */
  captureTarget: HTMLElement | null;
  capturePointerId: number | null;
}

/** Must match `.canvasGrid` gap in authoring.module.css */
const CANVAS_GAP = 14;
const MIN_CARD_WIDTH = 2;
const MIN_CARD_HEIGHT = 5;
/** Lower = more rows/cols per mouse pixel when resizing (only pointer math; stored h/w stay integers). */
const RESIZE_PIXEL_SENSITIVITY = 0.72;

interface UseCanvasInteractionInput {
  breakpoint: AuthoringBreakpoint;
  onSelectedViewIdChange: (viewId: string | null) => void;
  onMobileLayoutModeChange: (mode: MobileLayoutMode) => void;
  dashboardRef: React.RefObject<DashboardDocument>;
  mobileLayoutModeRef: React.RefObject<MobileLayoutMode>;
  applyDashboardMutation: (
    mutator: (current: DashboardDocument) => DashboardDocument,
  ) => void;
  onInteractionCommit?: (input: {
    breakpoint: AuthoringBreakpoint;
    mode: InteractionMode;
    viewId: string;
  }) => void;
}

export function useCanvasInteraction({
  breakpoint,
  onSelectedViewIdChange,
  onMobileLayoutModeChange,
  dashboardRef,
  mobileLayoutModeRef,
  applyDashboardMutation,
  onInteractionCommit,
}: UseCanvasInteractionInput) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<ActiveInteraction | null>(null);

  const startInteraction = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    item: DashboardLayoutItem,
    mode: InteractionMode,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    let capturePointerId: number | null = null;
    if (target instanceof HTMLElement && typeof target.setPointerCapture === "function") {
      try {
        target.setPointerCapture(event.pointerId);
        capturePointerId = event.pointerId;
      } catch {
        capturePointerId = null;
      }
    }
    interactionRef.current = {
      mode,
      breakpoint,
      viewId: item.view_id,
      startX: event.clientX,
      startY: event.clientY,
      startItem: { ...item },
      lastAppliedItem: { ...item },
      hasEffectiveDelta: false,
      captureTarget: target instanceof HTMLElement ? target : null,
      capturePointerId,
    };
    onSelectedViewIdChange(item.view_id);

    if (breakpoint === "mobile") {
      onMobileLayoutModeChange("custom");
    }
  }, [breakpoint, onMobileLayoutModeChange, onSelectedViewIdChange]);

  useEffect(() => {
    let moveRafId: number | null = null;
    let pendingMove: PointerEvent | null = null;

    function applyPointerToLayout(event: PointerEvent) {
      const interaction = interactionRef.current;
      const canvas = canvasRef.current;

      if (!interaction || !canvas) {
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const currentLayout = getAuthoringLayout(
        dashboardRef.current,
        interaction.breakpoint,
      );
      const cellWidth =
        (rect.width - CANVAS_GAP * (currentLayout.cols - 1)) /
        currentLayout.cols;
      const cellHeight = effectiveLayoutRowHeight(currentLayout.row_height);
      const colStep = cellWidth + CANVAS_GAP;
      const rowStep = cellHeight + CANVAS_GAP;
      /** Resize needs fewer pixels per row/col so extending feels responsive (layout stays integer cells). */
      const resizeSensitivity =
        interaction.mode === "resize" ? RESIZE_PIXEL_SENSITIVITY : 1;
      const deltaCols = Math.round(
        (event.clientX - interaction.startX) / (colStep * resizeSensitivity),
      );
      const deltaRows = Math.round(
        (event.clientY - interaction.startY) / (rowStep * resizeSensitivity),
      );
      const nextItem =
        interaction.mode === "move"
          ? {
              ...interaction.startItem,
              x: clamp(
                interaction.startItem.x + deltaCols,
                0,
                currentLayout.cols - interaction.startItem.w,
              ),
              y: Math.max(0, interaction.startItem.y + deltaRows),
            }
          : {
              ...interaction.startItem,
              w: clamp(
                interaction.startItem.w + deltaCols,
                MIN_CARD_WIDTH,
                currentLayout.cols - interaction.startItem.x,
              ),
              h: Math.min(
                MAX_LAYOUT_ROW_SPAN,
                Math.max(MIN_CARD_HEIGHT, interaction.startItem.h + deltaRows),
              ),
            };

      if (
        nextItem.x === interaction.lastAppliedItem.x &&
        nextItem.y === interaction.lastAppliedItem.y &&
        nextItem.w === interaction.lastAppliedItem.w &&
        nextItem.h === interaction.lastAppliedItem.h
      ) {
        return;
      }

      interaction.hasEffectiveDelta =
        nextItem.x !== interaction.startItem.x ||
        nextItem.y !== interaction.startItem.y ||
        nextItem.w !== interaction.startItem.w ||
        nextItem.h !== interaction.startItem.h;

      applyDashboardMutation((current) => {
        const currentLayoutInDocument = getAuthoringLayout(
          current,
          interaction.breakpoint,
        );
        const currentItem = currentLayoutInDocument.items.find(
          (candidate) => candidate.view_id === interaction.viewId,
        );

        if (!currentItem) {
          return current;
        }

        if (
          currentItem.x === nextItem.x &&
          currentItem.y === nextItem.y &&
          currentItem.w === nextItem.w &&
          currentItem.h === nextItem.h
        ) {
          return current;
        }

        const next = cloneDashboardDocument(current);
        const layout = getAuthoringLayout(next, interaction.breakpoint);
        const item = layout.items.find(
          (candidate) => candidate.view_id === interaction.viewId,
        );

        if (!item) {
          return current;
        }

        item.x = nextItem.x;
        item.y = nextItem.y;
        item.w = nextItem.w;
        item.h = nextItem.h;

        next.dashboard_spec.layout[interaction.breakpoint] = reconcileLayout(
          layout,
          interaction.viewId,
          { compactVertical: false },
        );

        if (
          interaction.breakpoint === "desktop" &&
          mobileLayoutModeRef.current === "auto" &&
          next.dashboard_spec.layout.desktop
        ) {
          next.dashboard_spec.layout.mobile = generateMobileLayout(
            next.dashboard_spec.layout.desktop,
          );
        }

        return next;
      });
      interaction.lastAppliedItem = nextItem;
    }

    function flushPendingMove() {
      moveRafId = null;
      const event = pendingMove;
      pendingMove = null;
      if (!event) {
        return;
      }
      applyPointerToLayout(event);
    }

    function handlePointerMove(event: PointerEvent) {
      if (!interactionRef.current) {
        return;
      }
      if (interactionRef.current.mode === "resize") {
        event.preventDefault();
      }
      pendingMove = event;
      if (moveRafId != null) {
        return;
      }
      moveRafId = window.requestAnimationFrame(flushPendingMove);
    }

    function handlePointerEnd() {
      if (moveRafId != null) {
        window.cancelAnimationFrame(moveRafId);
        moveRafId = null;
      }
      if (pendingMove && interactionRef.current) {
        applyPointerToLayout(pendingMove);
        pendingMove = null;
      } else {
        pendingMove = null;
      }

      const interaction = interactionRef.current;
      if (
        interaction?.captureTarget &&
        interaction.capturePointerId != null &&
        typeof interaction.captureTarget.releasePointerCapture === "function"
      ) {
        try {
          interaction.captureTarget.releasePointerCapture(interaction.capturePointerId);
        } catch {
          /* ignore */
        }
      }
      if (interaction?.hasEffectiveDelta && onInteractionCommit) {
        onInteractionCommit({
          breakpoint: interaction.breakpoint,
          mode: interaction.mode,
          viewId: interaction.viewId,
        });
      }
      interactionRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd, { passive: true });
    window.addEventListener("pointercancel", handlePointerEnd, {
      passive: true,
    });

    return () => {
      if (moveRafId != null) {
        window.cancelAnimationFrame(moveRafId);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [applyDashboardMutation, dashboardRef, mobileLayoutModeRef, onInteractionCommit]);

  return {
    canvasRef,
    startInteraction,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
