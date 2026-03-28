import {
  createAppendedLayoutItem,
  generateMobileLayout,
  reconcileLayout,
} from "../../../domain/dashboard/layout";
import { getBindingMode } from "../../../domain/dashboard/bindings";
import { getViewRenderer } from "../../../domain/dashboard/contract-kernel";
import { createBlankView } from "../../../domain/dashboard/views";
import { findBindingByViewId, reconcileBindingShape } from "./binding-editing";
import type {
  DashboardDocument,
  DashboardView,
  EChartsOptionTemplate,
} from "../../../contracts";

export function addViewToDashboard(
  document: DashboardDocument,
  mobileLayoutMode: "auto" | "custom",
): string {
  const seed = document.dashboard_spec.views.length + 1;
  const nextView = createBlankView(seed);

  document.dashboard_spec.views.push(nextView);
  const desktopLayout =
    document.dashboard_spec.layout.desktop ?? {
      cols: 12,
      row_height: 30,
      items: [],
    };
  desktopLayout.items.push(createAppendedLayoutItem(desktopLayout, nextView.id));
  document.dashboard_spec.layout.desktop = reconcileLayout({
    ...desktopLayout,
    items: desktopLayout.items,
  });

  if (mobileLayoutMode === "auto") {
    document.dashboard_spec.layout.mobile = generateMobileLayout(
      document.dashboard_spec.layout.desktop,
    );
  } else if (mobileLayoutMode === "custom") {
    const mobileLayout =
      document.dashboard_spec.layout.mobile ?? {
        cols: 4,
        row_height: desktopLayout.row_height,
        items: [],
      };
    mobileLayout.items.push({
      view_id: nextView.id,
      x: 0,
      y: mobileLayout.items.reduce(
        (maxY, item) => Math.max(maxY, item.y + item.h),
        0,
      ),
      w: 4,
      h: 6,
    });
    document.dashboard_spec.layout.mobile = reconcileLayout(mobileLayout, nextView.id);
  }

  return nextView.id;
}

export function deleteViewFromDashboard(
  document: DashboardDocument,
  viewId: string,
): void {
  document.dashboard_spec.views = document.dashboard_spec.views.filter(
    (view) => view.id !== viewId,
  );
  document.bindings = document.bindings.filter((binding) => binding.view_id !== viewId);

  if (document.dashboard_spec.layout.desktop) {
    document.dashboard_spec.layout.desktop = reconcileLayout({
      ...document.dashboard_spec.layout.desktop,
      items: document.dashboard_spec.layout.desktop.items.filter(
        (item) => item.view_id !== viewId,
      ),
    });
  }

  if (document.dashboard_spec.layout.mobile) {
    document.dashboard_spec.layout.mobile = reconcileLayout({
      ...document.dashboard_spec.layout.mobile,
      items: document.dashboard_spec.layout.mobile.items.filter(
        (item) => item.view_id !== viewId,
      ),
    });
  }
}

export function updateViewMeta(
  document: DashboardDocument,
  viewId: string,
  field: "title" | "description",
  value: string,
): void {
  const view = document.dashboard_spec.views.find((candidate) => candidate.id === viewId);
  if (view) {
    view[field] = value;
  }
}

export function applyTemplateToView(
  document: DashboardDocument,
  viewId: string,
  parsedTemplate: EChartsOptionTemplate,
): void {
  const view = document.dashboard_spec.views.find((candidate) => candidate.id === viewId);
  if (!view) {
    return;
  }

  view.option_template = parsedTemplate;
  view.renderer = {
    ...getViewRenderer(view),
    option_template: parsedTemplate,
  };
  const binding = findBindingByViewId(document.bindings, viewId);
  const query = binding
    ? document.query_defs.find(
        (candidate) => getBindingMode(binding) === "live" && candidate.id === binding.query_id,
      )
    : undefined;
  if (binding && query) {
    Object.assign(binding, reconcileBindingShape(binding, view, query));
  }
}

export function syncMobileLayoutFromDesktop(document: DashboardDocument): void {
  if (document.dashboard_spec.layout.desktop) {
    document.dashboard_spec.layout.mobile = generateMobileLayout(
      document.dashboard_spec.layout.desktop,
    );
  }
}

export function getRemainingViewIds(document: DashboardDocument): string[] {
  return document.dashboard_spec.views.map((view) => view.id);
}

export function findViewById(
  document: DashboardDocument,
  viewId: string,
): DashboardView | undefined {
  return document.dashboard_spec.views.find((view) => view.id === viewId);
}
