import type {
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardLayoutItem,
} from "@/contracts";
import { reconcileDashboardDocumentContract } from "@/domain/dashboard/document";
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneQuery,
} from "@/ai/authoring/tools/draft-state";

export function buildCandidateDocument(
  dashboard: DashboardDocument,
  workingDraft: WorkingDraftState,
): DashboardDocument {
  const nextDocument = JSON.parse(JSON.stringify(dashboard)) as DashboardDocument;
  const pruneUnusedQueries =
    Boolean(workingDraft.dashboardSpec) && !workingDraft.queryDefs;

  if (workingDraft.dashboardSpec) {
    nextDocument.dashboard_spec = cloneDashboardSpec(workingDraft.dashboardSpec);
  }

  if (workingDraft.queryDefs) {
    nextDocument.query_defs = workingDraft.queryDefs.map(cloneQuery);
  }

  if (workingDraft.bindings) {
    nextDocument.bindings = workingDraft.bindings.map(cloneBinding);
  }

  return reconcileDashboardDocumentContract(preserveBaseLayoutForExistingViews({
    base: dashboard,
    candidate: nextDocument,
  }), {
    pruneUnusedQueries,
  });
}

export function buildDocumentFingerprint(document: DashboardDocument) {
  return dashboardDocumentPersistenceFingerprint(document);
}

function preserveBaseLayoutForExistingViews(input: {
  base: DashboardDocument;
  candidate: DashboardDocument;
}): DashboardDocument {
  const next = JSON.parse(JSON.stringify(input.candidate)) as DashboardDocument;
  const candidateViewIds = new Set(
    next.dashboard_spec.views.map((view) => view.id),
  );

  for (const breakpoint of ["desktop", "mobile"] as const) {
    const baseLayout = input.base.dashboard_spec.layout[breakpoint];
    const candidateLayout = next.dashboard_spec.layout[breakpoint];
    if (!baseLayout || !candidateLayout) {
      continue;
    }

    next.dashboard_spec.layout[breakpoint] = buildAppendOnlyLayout({
      baseLayout,
      candidateLayout,
      candidateViewIds,
      candidateViewOrder: next.dashboard_spec.views.map((view) => view.id),
    });
  }

  return next;
}

function buildAppendOnlyLayout(input: {
  baseLayout: DashboardBreakpointLayout;
  candidateLayout: DashboardBreakpointLayout;
  candidateViewIds: Set<string>;
  candidateViewOrder: string[];
}): DashboardBreakpointLayout {
  const candidateItemsByViewId = new Map(
    input.candidateLayout.items.map((item) => [item.view_id, item]),
  );
  const placedItems = input.baseLayout.items
    .filter((item) => input.candidateViewIds.has(item.view_id))
    .map((item) => ({ ...item }));
  const placedViewIds = new Set(placedItems.map((item) => item.view_id));
  const candidateOrder = [
    ...input.candidateLayout.items.map((item) => item.view_id),
    ...input.candidateViewOrder,
  ];

  for (const viewId of candidateOrder) {
    if (placedViewIds.has(viewId) || !input.candidateViewIds.has(viewId)) {
      continue;
    }

    placedItems.push(createAppendedItemFromTemplate({
      layout: input.baseLayout,
      placedItems,
      viewId,
      template: candidateItemsByViewId.get(viewId),
    }));
    placedViewIds.add(viewId);
  }

  return {
    ...input.candidateLayout,
    cols: input.baseLayout.cols,
    row_height: input.baseLayout.row_height,
    items: placedItems,
  };
}

function createAppendedItemFromTemplate(input: {
  layout: DashboardBreakpointLayout;
  placedItems: DashboardLayoutItem[];
  viewId: string;
  template?: DashboardLayoutItem;
}): DashboardLayoutItem {
  const cols = Math.max(1, Math.floor(input.layout.cols));
  const width = clampInteger(
    input.template?.w ?? (cols >= 12 ? 6 : cols),
    1,
    cols,
  );
  const fallbackHeight = cols >= 12 ? 7 : 6;

  return {
    view_id: input.viewId,
    x: clampInteger(input.template?.x ?? 0, 0, cols - width),
    y: input.placedItems.reduce(
      (maxY, item) => Math.max(maxY, item.y + item.h),
      0,
    ),
    w: width,
    h: Math.max(1, Math.floor(input.template?.h ?? fallbackHeight)),
  };
}

function clampInteger(value: number, min: number, max: number): number {
  const next = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, next));
}
