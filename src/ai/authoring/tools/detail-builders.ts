import type {
  Binding,
  DashboardDocument,
  DashboardView,
  QueryDef,
} from "@/contracts";
import type {
  QueryDetail,
  ViewCheckSnapshot,
  ViewDetail,
} from "@/ai/authoring/contracts/tool-io";
import {
  buildBindingDetail,
  collectViewQueryIds,
} from "@/ai/authoring/contracts/tool-io";
import { getLayoutItemsForView } from "@/domain/dashboard/document";
import { summarizeEChartsRenderer } from "@/renderers/echarts/summary";
import type { RendererChecksByView } from "@/renderers/core/validation-result";

export function buildViewDetail(input: {
  document: DashboardDocument;
  view: DashboardView;
  latestCheck?: ViewCheckSnapshot | null;
}): ViewDetail {
  const rendererSummary = summarizeEChartsRenderer(input.view.renderer);
  const layout = getLayoutItemsForView(input.document, input.view.id);

  return {
    view: input.view,
    renderer_kind: input.view.renderer.kind,
    slot_summaries: rendererSummary.slot_summaries,
    renderer_summary: rendererSummary,
    layout: {
      desktop: layout.desktop ?? null,
      mobile: layout.mobile ?? null,
    },
    bindings: input.document.bindings
      .filter((binding) => binding.view_id === input.view.id)
      .map((binding) =>
        buildBindingDetail({
          binding,
          view: input.view,
          query: input.document.query_defs.find(
            (query) => query.id === binding.query_id,
          ),
        }),
      ),
    query_ids: collectViewQueryIds(input.view.id, input.document.bindings),
    latest_check: input.latestCheck ?? null,
  };
}

export function buildQueryDetail(
  document: DashboardDocument,
  query: QueryDef,
): QueryDetail {
  return {
    query,
    used_by: document.bindings
      .filter((binding) => binding.query_id === query.id)
      .map((binding) => ({
        binding_id: binding.id,
        view_id: binding.view_id,
        slot_id: binding.slot_id,
      })),
  };
}

export function resolveRequiredView(document: DashboardDocument, viewId: string) {
  const trimmedViewId = viewId.trim();
  if (!trimmedViewId) {
    throw new Error("A view_id is required for this operation.");
  }

  const view = document.dashboard_spec.views.find(
    (candidate) => candidate.id === trimmedViewId,
  );

  if (!view) {
    const candidates = document.dashboard_spec.views
      .map((candidate) => `${candidate.id} (${candidate.title})`)
      .join(", ");
    throw new Error(
      candidates
        ? `Requested view "${trimmedViewId}" was not found. Available views: ${candidates}.`
        : `Requested view "${trimmedViewId}" was not found. No views are currently staged or saved.`,
    );
  }

  return view;
}

export function findCheckSnapshot(
  checks: ViewCheckSnapshot[] | null | undefined,
  viewId: string,
) {
  return checks?.find((check) => check.view_id === viewId) ?? null;
}

export function mergeRendererChecksByView(
  serverChecks: RendererChecksByView,
  existingChecks: ViewCheckSnapshot[] | null | undefined,
  visibleViewIds: string[],
): RendererChecksByView {
  const existingByViewId = new Map(
    (existingChecks ?? []).map((check) => [check.view_id, check.renderer_checks ?? {}]),
  );

  return Object.fromEntries(
    visibleViewIds.map((viewId) => [
      viewId,
      {
        ...(existingByViewId.get(viewId) ?? {}),
        ...(serverChecks[viewId] ?? {}),
      },
    ]),
  );
}

export function collectVisibleViewIds(document: DashboardDocument) {
  const layoutViewIds = new Set<string>();

  for (const breakpoint of Object.values(document.dashboard_spec.layout)) {
    for (const item of breakpoint?.items ?? []) {
      layoutViewIds.add(item.view_id);
    }
  }

  return layoutViewIds.size > 0
    ? Array.from(layoutViewIds)
    : document.dashboard_spec.views.map((view) => view.id);
}

export function resolveFocusedViewIdFromPatch(input: {
  patch: {
    operations: Array<{
      op: "add" | "update" | "upsert" | "remove";
      path: string;
    }>;
  };
  currentDashboard: DashboardDocument;
  nextDashboard: DashboardDocument;
}) {
  const currentBindings = new Map(
    input.currentDashboard.bindings.map((binding) => [binding.id, binding]),
  );
  const nextBindings = new Map(
    input.nextDashboard.bindings.map((binding) => [binding.id, binding]),
  );
  const nextViewIds = new Set(input.nextDashboard.dashboard_spec.views.map((view) => view.id));

  for (const operation of input.patch.operations) {
    const viewId = resolveViewIdFromPatchOperation(
      operation,
      currentBindings,
      nextBindings,
    );
    if (viewId && nextViewIds.has(viewId)) {
      return viewId;
    }
  }

  return null;
}

function resolveViewIdFromPatchOperation(
  operation: { op: "add" | "update" | "upsert" | "remove"; path: string },
  currentBindings: Map<string, Binding>,
  nextBindings: Map<string, Binding>,
): string | null {
  if (operation.path.startsWith("dashboard_spec.views.")) {
    return operation.path.slice("dashboard_spec.views.".length) || null;
  }

  if (!operation.path.startsWith("bindings.")) {
    return null;
  }

  const bindingId = operation.path.slice("bindings.".length);
  if (!bindingId) {
    return null;
  }

  if (operation.op === "remove") {
    return currentBindings.get(bindingId)?.view_id ?? null;
  }

  return nextBindings.get(bindingId)?.view_id ?? null;
}
