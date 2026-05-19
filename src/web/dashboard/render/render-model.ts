import type {
  BindingResults,
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardView,
} from "@/contracts";
import { summarizeRendererValidationChecks, type RendererChecksByView } from "@/renderers/core/validation-result";
import { resolveDashboardTemplate } from "@/domain/dashboard/templates";
import { resolveDashboardPresentation } from "@/domain/dashboard/presentation-context";

export type DashboardRenderMode = "editing" | "preview" | "published";
export type DashboardRenderRequestState = "loading" | "ready" | "error";
export type DashboardRenderViewMode = "desktop" | "mobile";
export type DashboardRenderCardStatus = "loading" | "ok" | "empty" | "error";

export interface DashboardRenderCard {
  view: DashboardView;
  item: DashboardLayoutItem;
  status: DashboardRenderCardStatus;
  editingOverlay: boolean;
}

export interface DashboardRenderModel {
  mode: DashboardRenderMode;
  template: {
    id: string;
    version: string;
    resolvedId: string;
    resolvedVersion: string;
  };
  presentation: NonNullable<DashboardDocument["dashboard_spec"]["presentation"]>;
  layout: DashboardBreakpointLayout;
  visibleViews: DashboardView[];
  statusMap: Record<string, DashboardRenderCardStatus>;
  cards: DashboardRenderCard[];
}

export function resolveDashboardRenderLayout(
  dashboard: DashboardDocument,
  viewMode: DashboardRenderViewMode,
): DashboardBreakpointLayout {
  const layout =
    dashboard.dashboard_spec.layout[viewMode] ??
    dashboard.dashboard_spec.layout.desktop ??
    dashboard.dashboard_spec.layout.mobile;

  if (!layout) {
    throw new Error("Report layout is missing.");
  }

  return layout;
}

export function buildDashboardRenderModel(input: {
  dashboard: DashboardDocument;
  mode: DashboardRenderMode;
  viewMode: DashboardRenderViewMode;
  bindingResults: BindingResults;
  requestState: DashboardRenderRequestState;
  rendererChecks?: RendererChecksByView;
}): DashboardRenderModel {
  const template = resolveDashboardTemplate(input.dashboard.dashboard_spec.template);
  const templateRef = input.dashboard.dashboard_spec.template ?? {
    id: template.id,
    version: template.version,
  };
  const layout = resolveDashboardRenderLayout(input.dashboard, input.viewMode);
  const viewById = new Map(
    input.dashboard.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const visibleViews = layout.items
    .map((item) => viewById.get(item.view_id))
    .filter((view): view is DashboardView => Boolean(view));
  const statusMap = buildRenderStatusMap({
    views: visibleViews,
    bindingResults: input.bindingResults,
    requestState: input.requestState,
    rendererChecks: input.rendererChecks,
  });

  return {
    mode: input.mode,
    template: {
      id: templateRef.id,
      version: templateRef.version,
      resolvedId: template.id,
      resolvedVersion: template.version,
    },
    presentation: resolveDashboardPresentation(input.dashboard),
    layout,
    visibleViews,
    statusMap,
    cards: layout.items.flatMap((item) => {
      const view = viewById.get(item.view_id);
      if (!view) {
        return [];
      }
      return [{
        view,
        item,
        status: statusMap[view.id] ?? "loading",
        editingOverlay: input.mode === "editing",
      }];
    }),
  };
}

function buildRenderStatusMap(input: {
  views: DashboardView[];
  bindingResults: BindingResults;
  requestState: DashboardRenderRequestState;
  rendererChecks?: RendererChecksByView;
}): Record<string, DashboardRenderCardStatus> {
  if (input.requestState === "loading") {
    return Object.fromEntries(input.views.map((view) => [view.id, "loading"]));
  }

  if (input.requestState === "error") {
    return Object.fromEntries(input.views.map((view) => [view.id, "error"]));
  }

  const resultsByViewId = new Map<string, BindingResults[string][]>();
  for (const result of Object.values(input.bindingResults)) {
    const current = resultsByViewId.get(result.view_id) ?? [];
    current.push(result);
    resultsByViewId.set(result.view_id, current);
  }

  return Object.fromEntries(input.views.map((view) => {
    const rendererSummary = summarizeRendererValidationChecks(
      input.rendererChecks?.[view.id],
    );
    if (rendererSummary.status === "error") {
      return [view.id, "error"];
    }

    const results = resultsByViewId.get(view.id) ?? [];
    if (results.length === 0) {
      return [view.id, "error"];
    }

    if (results.some((result) => result.status === "error")) {
      return [view.id, "error"];
    }

    const resultsBySlotId = new Map(
      results.map((result) => [result.slot_id, result] as const),
    );
    const requiredSlots = view.renderer.slots.filter(
      (slot) => slot.required !== false,
    );
    const requiredResults = requiredSlots.map((slot) =>
      resultsBySlotId.get(slot.id),
    );
    if (requiredResults.some((result) => !result)) {
      return [view.id, "error"];
    }

    const statusResults =
      requiredResults.length > 0
        ? requiredResults
        : results;

    if (statusResults.some((result) => result?.status === "empty")) {
      return [view.id, "empty"];
    }

    return [view.id, "ok"];
  }));
}
