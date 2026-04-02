import {
  createAppendedLayoutItem,
  generateMobileLayout,
  reconcileLayout,
} from "../../../domain/dashboard/layout";
import { isLiveBinding, reconcileBindingShape } from "../../../domain/dashboard/bindings";
import { DEFAULT_SLOT_ID, DEFAULT_SLOT_PATH, getViewRenderer } from "../../../domain/dashboard/contract-kernel";
import {
  getBindingsForView,
  getQueryById,
  getViewById,
  removeViewFromDocument,
  upsertBindingInDocument,
  upsertViewInDocument,
} from "../../../domain/dashboard/document";
import type {
  DashboardDocument,
  DashboardView,
} from "../../../contracts";
import type { EChartsOptionTemplate } from "../../../renderers/echarts/contract";

export function addViewToDashboard(
  document: DashboardDocument,
  mobileLayoutMode: "auto" | "custom",
): { document: DashboardDocument; viewId: string } {
  const seed = document.dashboard_spec.views.length + 1;
  const nextView = createBlankView(seed);
  const desktopLayout =
    document.dashboard_spec.layout.desktop ?? {
      cols: 12,
      row_height: 30,
      items: [],
    };
  const nextDocument = upsertViewInDocument(document, nextView, {
    mobileLayoutMode,
    desktopItem: createAppendedLayoutItem(desktopLayout, nextView.id),
  });

  return { document: nextDocument, viewId: nextView.id };
}

export function deleteViewFromDashboard(
  document: DashboardDocument,
  viewId: string,
  mobileLayoutMode: "auto" | "custom",
): DashboardDocument {
  return removeViewFromDocument(document, viewId, { mobileLayoutMode });
}

export function updateViewMeta(
  document: DashboardDocument,
  viewId: string,
  field: "title" | "description",
  value: string,
): DashboardDocument {
  const view = getViewById(document, viewId);
  if (!view) {
    return document;
  }

  return upsertViewInDocument(document, {
    ...view,
    [field]: value,
  });
}

export function applyTemplateToView(
  document: DashboardDocument,
  viewId: string,
  parsedTemplate: EChartsOptionTemplate,
): DashboardDocument {
  const view = getViewById(document, viewId);
  if (!view) {
    return document;
  }

  const nextView = {
    ...view,
    renderer: {
      ...getViewRenderer(view),
      option_template: parsedTemplate,
    },
  };
  let nextDocument = upsertViewInDocument(document, nextView);
  const binding = getBindingsForView(nextDocument, viewId)[0];
  const query = binding && isLiveBinding(binding)
    ? getQueryById(nextDocument, binding.query_id)
    : undefined;

  if (binding && query) {
    nextDocument = upsertBindingInDocument(
      nextDocument,
      reconcileBindingShape(binding, nextView, query),
    );
  }

  return nextDocument;
}

export function syncMobileLayoutFromDesktop(document: DashboardDocument): DashboardDocument {
  if (!document.dashboard_spec.layout.desktop) {
    return document;
  }

  const nextDesktop = reconcileLayout(document.dashboard_spec.layout.desktop);
  return {
    ...document,
    dashboard_spec: {
      ...document.dashboard_spec,
      layout: {
        ...document.dashboard_spec.layout,
        desktop: nextDesktop,
        mobile: generateMobileLayout(nextDesktop),
      },
    },
  };
}

function createBlankView(seed: number): DashboardView {
  return {
    id: `v_custom_${seed}`,
    title: `Untitled View ${seed}`,
    description: "Describe the metric or story this card should tell.",
    renderer: {
      kind: "echarts",
      option_template: {},
      slots: [
        {
          id: DEFAULT_SLOT_ID,
          path: DEFAULT_SLOT_PATH,
          value_kind: "rows",
          required: true,
        },
      ],
    },
  };
}
