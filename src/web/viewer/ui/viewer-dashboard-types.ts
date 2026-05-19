import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import type {
  Binding,
  BindingResults,
  DashboardLayoutItem,
  DashboardView,
} from "../../../contracts";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";
import type { RenderedView } from "../state/rendered-views";
import type { ViewMode } from "../state/viewer-state";

export type EditingPreviewState = "idle" | "loading" | "ready" | "error";
export type InteractionMode = "move" | "resize";

export interface ViewerDashboardEditingOptions {
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
