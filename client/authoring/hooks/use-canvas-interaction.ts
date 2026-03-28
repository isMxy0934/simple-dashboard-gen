"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  type AuthoringBreakpoint,
  type MobileLayoutMode,
} from "../state/authoring-state";
import { cloneDashboardDocument } from "../../../domain/dashboard/document";
import {
  generateMobileLayout,
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
}

/** Must match `.canvasGrid` gap in authoring.module.css */
const CANVAS_GAP = 14;
const MIN_CARD_WIDTH = 2;
const MIN_CARD_HEIGHT = 5;

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
    interactionRef.current = {
      mode,
      breakpoint,
      viewId: item.view_id,
      startX: event.clientX,
      startY: event.clientY,
      startItem: { ...item },
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
      const cellHeight = currentLayout.row_height;
      const deltaCols = Math.round(
        (event.clientX - interaction.startX) / (cellWidth + CANVAS_GAP),
      );
      const deltaRows = Math.round(
        (event.clientY - interaction.startY) / (cellHeight + CANVAS_GAP),
      );

      applyDashboardMutation((current) => {
        const next = cloneDashboardDocument(current);
        const layout = getAuthoringLayout(next, interaction.breakpoint);
        const item = layout.items.find(
          (candidate) => candidate.view_id === interaction.viewId,
        );

        if (!item) {
          return current;
        }

        if (interaction.mode === "move") {
          item.x = clamp(
            interaction.startItem.x + deltaCols,
            0,
            layout.cols - item.w,
          );
          item.y = Math.max(0, interaction.startItem.y + deltaRows);
        } else {
          item.w = clamp(
            interaction.startItem.w + deltaCols,
            MIN_CARD_WIDTH,
            layout.cols - item.x,
          );
          item.h = Math.max(MIN_CARD_HEIGHT, interaction.startItem.h + deltaRows);
        }

        next.dashboard_spec.layout[interaction.breakpoint] = reconcileLayout(
          layout,
          interaction.viewId,
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
      pendingMove = event;
      if (moveRafId != null) {
        return;
      }
      moveRafId = window.requestAnimationFrame(flushPendingMove);
    }

    function handlePointerUp() {
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
      if (interaction && onInteractionCommit) {
        onInteractionCommit({
          breakpoint: interaction.breakpoint,
          mode: interaction.mode,
          viewId: interaction.viewId,
        });
      }
      interactionRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      if (moveRafId != null) {
        window.cancelAnimationFrame(moveRafId);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
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
