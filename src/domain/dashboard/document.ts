import type {
  Binding,
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardTemplateRef,
  DashboardView,
  QueryDef,
} from "../../contracts";
import { normalizeBinding, normalizeQuery, normalizeView } from "./contract-kernel";
import { isLiveBinding } from "./bindings";
import {
  createAppendedLayoutItem,
  generateMobileLayout,
  reconcileLayout,
} from "./layout";
import {
  applyDashboardTemplateDefaults,
  createDashboardFromTemplate,
} from "./templates";
import { CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION } from "@/contracts/schema-version";

/** Matches client authoring mobile mode; kept as string union to avoid importing client. */
export type DashboardMobileLayoutMode = "auto" | "custom";

interface ReconcileDashboardDocumentContractOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
  pruneUnusedQueries?: boolean;
}

interface UpsertViewInDocumentOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
  desktopItem?: DashboardLayoutItem;
  mobileItem?: DashboardLayoutItem;
}

interface UpsertLayoutInDocumentOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
  desktopItem: DashboardLayoutItem;
  mobileItem: DashboardLayoutItem;
}

interface RemoveViewInDocumentOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
}

interface UpsertQueryInDocumentOptions {
  previousQueryId?: string;
  mobileLayoutMode?: DashboardMobileLayoutMode;
}

interface RemoveQueryInDocumentOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
}

interface UpsertBindingInDocumentOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
}

interface RemoveBindingInDocumentOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInitialAuthoringDocument(
  templateRef?: DashboardTemplateRef,
): DashboardDocument {
  return createDashboardFromTemplate(templateRef);
}

export function cloneDashboardDocument(document: DashboardDocument): DashboardDocument {
  return clone(document);
}

export function getViewById(
  document: DashboardDocument,
  viewId: string,
): DashboardView | undefined {
  return document.dashboard_spec.views.find((view) => view.id === viewId);
}

export function getQueryById(
  document: DashboardDocument,
  queryId: string,
): QueryDef | undefined {
  return document.query_defs.find((query) => query.id === queryId);
}

export function getBindingsForView(
  document: DashboardDocument,
  viewId: string,
  slotId?: string,
): Binding[] {
  return document.bindings.filter(
    (binding) =>
      binding.view_id === viewId && (!slotId || binding.slot_id === slotId),
  );
}

export function getLiveQueryIds(document: DashboardDocument): string[] {
  return document.bindings
    .filter((binding) => isLiveBinding(binding))
    .map((binding) => binding.query_id);
}

export function getLayoutItemsForView(
  document: DashboardDocument,
  viewId: string,
): {
  desktop?: DashboardLayoutItem;
  mobile?: DashboardLayoutItem;
} {
  return {
    desktop: document.dashboard_spec.layout.desktop?.items.find(
      (item) => item.view_id === viewId,
    ),
    mobile: document.dashboard_spec.layout.mobile?.items.find(
      (item) => item.view_id === viewId,
    ),
  };
}

export function ensureLayoutMap(document: DashboardDocument): DashboardDocument {
  const nextDocument = cloneDashboardDocument(
    applyDashboardTemplateDefaults(document),
  );
  const desktopLayout = nextDocument.dashboard_spec.layout.desktop ?? {
    cols: 12,
    row_height: 30,
    items: [],
  };

  nextDocument.dashboard_spec.layout.desktop = desktopLayout;
  nextDocument.dashboard_spec.layout.mobile =
    nextDocument.dashboard_spec.layout.mobile ?? generateMobileLayout(desktopLayout);
  nextDocument.schema_version = CURRENT_DASHBOARD_DOCUMENT_SCHEMA_VERSION;
  nextDocument.dashboard_spec.schema_version = "0.3";
  nextDocument.dashboard_spec.views = nextDocument.dashboard_spec.views.map((view) => normalizeView(view));
  nextDocument.query_defs = nextDocument.query_defs.map((query) => normalizeQuery(query));
  nextDocument.bindings = nextDocument.bindings.map((binding) => ({
    ...normalizeBinding(
      binding,
      nextDocument.dashboard_spec.views.find((view) => view.id === binding.view_id),
    ),
    mode: binding.mode ?? "live",
  }));

  return nextDocument;
}

export function reconcileDashboardDocumentContract(
  document: DashboardDocument,
  options: ReconcileDashboardDocumentContractOptions = {},
): DashboardDocument {
  const mobileLayoutMode = options.mobileLayoutMode ?? "custom";
  const next = reconcileDashboardDocumentLayouts(
    ensureLayoutMap(document),
    mobileLayoutMode,
  );
  const viewIds = new Set(next.dashboard_spec.views.map((view) => view.id));
  const viewById = new Map(next.dashboard_spec.views.map((view) => [view.id, view]));

  next.bindings = dedupeBindingsBySlot(next.bindings, viewById).filter((binding) => viewIds.has(binding.view_id));

  if (options.pruneUnusedQueries) {
    const activeQueryIds = new Set(
      next.bindings
        .filter((binding) => isLiveBinding(binding))
        .map((binding) => binding.query_id),
    );
    next.query_defs = next.query_defs.filter((query) => activeQueryIds.has(query.id));
  }

  return next;
}

export function upsertViewInDocument(
  document: DashboardDocument,
  view: DashboardView,
  options: UpsertViewInDocumentOptions = {},
): DashboardDocument {
  const mobileLayoutMode = options.mobileLayoutMode ?? "custom";
  const next = ensureLayoutMap(document);
  const normalizedView = normalizeView(view);
  const existingIndex = next.dashboard_spec.views.findIndex(
    (candidate) => candidate.id === normalizedView.id,
  );

  if (existingIndex >= 0) {
    next.dashboard_spec.views[existingIndex] = normalizedView;
  } else {
    next.dashboard_spec.views.push(normalizedView);
  }

  const desktopLayout = next.dashboard_spec.layout.desktop ?? {
    cols: 12,
    row_height: 30,
    items: [],
  };
  next.dashboard_spec.layout.desktop = desktopLayout;

  if (existingIndex < 0 || options.desktopItem) {
    const desktopItem =
      existingIndex < 0
        ? createAppendedLayoutItemFromTemplate(
            desktopLayout,
            normalizedView.id,
            options.desktopItem,
          )
        : { ...options.desktopItem!, view_id: normalizedView.id };
    desktopLayout.items = upsertLayoutItem(
      desktopLayout.items,
      desktopItem,
      normalizedView.id,
    );
    next.dashboard_spec.layout.desktop = reconcileLayout(desktopLayout, normalizedView.id, {
      compactVertical: false,
    });
  }

  if (mobileLayoutMode === "auto") {
    next.dashboard_spec.layout.mobile = generateMobileLayout(
      next.dashboard_spec.layout.desktop,
    );
  } else if (existingIndex < 0 || options.mobileItem) {
    const mobileLayout = next.dashboard_spec.layout.mobile ?? {
      cols: 4,
      row_height: next.dashboard_spec.layout.desktop.row_height,
      items: [],
    };
    const mobileItem =
      existingIndex < 0
        ? createAppendedMobileLayoutItemFromTemplate(
            mobileLayout,
            normalizedView.id,
            options.mobileItem,
          )
        : { ...options.mobileItem!, view_id: normalizedView.id };
    next.dashboard_spec.layout.mobile = reconcileLayout(
      {
        ...mobileLayout,
        items: upsertLayoutItem(
          mobileLayout.items,
          mobileItem,
          normalizedView.id,
        ),
      },
      normalizedView.id,
      { compactVertical: false },
    );
  }

  return reconcileDashboardDocumentContract(next, { mobileLayoutMode });
}

export function upsertLayoutForViewInDocument(
  document: DashboardDocument,
  viewId: string,
  options: UpsertLayoutInDocumentOptions,
): DashboardDocument {
  const mobileLayoutMode = options.mobileLayoutMode ?? "custom";
  const next = ensureLayoutMap(document);
  const view = getViewById(next, viewId);
  if (!view) {
    throw new Error(`View "${viewId}" was not found.`);
  }

  const desktopLayout = next.dashboard_spec.layout.desktop ?? {
    cols: 12,
    row_height: 30,
    items: [],
  };
  next.dashboard_spec.layout.desktop = reconcileLayout(
    {
      ...desktopLayout,
      items: upsertLayoutItem(
        desktopLayout.items,
        { ...options.desktopItem, view_id: view.id },
        view.id,
      ),
    },
    view.id,
    { compactVertical: false },
  );

  const mobileLayout = next.dashboard_spec.layout.mobile ?? {
    cols: 4,
    row_height: next.dashboard_spec.layout.desktop.row_height,
    items: [],
  };
  next.dashboard_spec.layout.mobile = reconcileLayout(
    {
      ...mobileLayout,
      items: upsertLayoutItem(
        mobileLayout.items,
        { ...options.mobileItem, view_id: view.id },
        view.id,
      ),
    },
    view.id,
    { compactVertical: false },
  );

  return reconcileDashboardDocumentContract(next, { mobileLayoutMode });
}

export function removeViewFromDocument(
  document: DashboardDocument,
  viewId: string,
  options: RemoveViewInDocumentOptions = {},
): DashboardDocument {
  const mobileLayoutMode = options.mobileLayoutMode ?? "custom";
  const next = ensureLayoutMap(document);

  next.dashboard_spec.views = next.dashboard_spec.views.filter((view) => view.id !== viewId);
  next.bindings = next.bindings.filter((binding) => binding.view_id !== viewId);

  if (next.dashboard_spec.layout.desktop) {
    next.dashboard_spec.layout.desktop = {
      ...next.dashboard_spec.layout.desktop,
      items: next.dashboard_spec.layout.desktop.items.filter(
        (item) => item.view_id !== viewId,
      ),
    };
  }

  if (next.dashboard_spec.layout.mobile) {
    next.dashboard_spec.layout.mobile = {
      ...next.dashboard_spec.layout.mobile,
      items: next.dashboard_spec.layout.mobile.items.filter(
        (item) => item.view_id !== viewId,
      ),
    };
  }

  return reconcileDashboardDocumentContract(next, { mobileLayoutMode });
}

export function upsertQueryInDocument(
  document: DashboardDocument,
  query: QueryDef,
  options: UpsertQueryInDocumentOptions = {},
): DashboardDocument {
  const next = cloneDashboardDocument(document);
  const normalizedQuery = normalizeQuery(query);
  if (options.previousQueryId && options.previousQueryId !== normalizedQuery.id) {
    next.query_defs = next.query_defs.filter(
      (candidate) => candidate.id !== options.previousQueryId,
    );
  }
  const existingIndex = next.query_defs.findIndex((candidate) => candidate.id === normalizedQuery.id);

  if (existingIndex >= 0) {
    next.query_defs[existingIndex] = normalizedQuery;
  } else {
    next.query_defs.push(normalizedQuery);
  }

  if (options.previousQueryId && options.previousQueryId !== normalizedQuery.id) {
    next.bindings = next.bindings.map((binding) =>
      isLiveBinding(binding) && binding.query_id === options.previousQueryId
        ? { ...binding, query_id: normalizedQuery.id }
        : binding,
    );
  }

  return reconcileDashboardDocumentContract(next, {
    mobileLayoutMode: options.mobileLayoutMode ?? "custom",
  });
}

export function removeQueryFromDocument(
  document: DashboardDocument,
  queryId: string,
  options: RemoveQueryInDocumentOptions = {},
): DashboardDocument {
  const next = cloneDashboardDocument(document);
  next.query_defs = next.query_defs.filter((query) => query.id !== queryId);
  next.bindings = next.bindings.filter(
    (binding) => !(isLiveBinding(binding) && binding.query_id === queryId),
  );

  return reconcileDashboardDocumentContract(next, {
    mobileLayoutMode: options.mobileLayoutMode ?? "custom",
  });
}

export function upsertBindingInDocument(
  document: DashboardDocument,
  binding: Binding,
  options: UpsertBindingInDocumentOptions = {},
): DashboardDocument {
  const next = cloneDashboardDocument(document);
  const normalizedBinding = normalizeBinding(
    binding,
    getViewById(document, binding.view_id),
  );
  const existingIndex = next.bindings.findIndex(
    (candidate) =>
      candidate.id === normalizedBinding.id ||
      (candidate.view_id === normalizedBinding.view_id &&
        candidate.slot_id === normalizedBinding.slot_id),
  );

  if (existingIndex >= 0) {
    next.bindings[existingIndex] = normalizedBinding;
  } else {
    next.bindings.push(normalizedBinding);
  }

  return reconcileDashboardDocumentContract(next, {
    mobileLayoutMode: options.mobileLayoutMode ?? "custom",
  });
}

export function removeBindingFromDocument(
  document: DashboardDocument,
  bindingId: string,
  options: RemoveBindingInDocumentOptions = {},
): DashboardDocument {
  const next = cloneDashboardDocument(document);
  next.bindings = next.bindings.filter((binding) => binding.id !== bindingId);

  return reconcileDashboardDocumentContract(next, {
    mobileLayoutMode: options.mobileLayoutMode ?? "custom",
  });
}

/**
 * Drop orphan layout entries, merge duplicate view slots, and resolve overlaps
 * without compacting away intentional whitespace from authored layouts.
 * Call after load from API/local draft and whenever a full document is applied
 * (e.g. AI patch).
 */
export function reconcileDashboardDocumentLayouts(
  document: DashboardDocument,
  mobileLayoutMode: DashboardMobileLayoutMode,
): DashboardDocument {
  const next = cloneDashboardDocument(document);
  const viewIds = new Set(next.dashboard_spec.views.map((view) => view.id));

  const desktop = next.dashboard_spec.layout.desktop;
  if (desktop && desktop.items.length > 0) {
    const filtered = {
      ...desktop,
      items: desktop.items.filter((item) => viewIds.has(item.view_id)),
    };
    next.dashboard_spec.layout.desktop =
      filtered.items.length > 0
        ? reconcileLayout(filtered, undefined, { compactVertical: false })
        : { ...desktop, items: [] };
  }

  if (
    mobileLayoutMode === "auto" &&
    next.dashboard_spec.layout.desktop &&
    next.dashboard_spec.layout.desktop.items.length > 0
  ) {
    next.dashboard_spec.layout.mobile = generateMobileLayout(
      next.dashboard_spec.layout.desktop,
    );
  } else {
    const mobile = next.dashboard_spec.layout.mobile;
    if (mobile && mobile.items.length > 0) {
      const filtered = {
        ...mobile,
        items: mobile.items.filter((item) => viewIds.has(item.view_id)),
      };
      if (filtered.items.length > 0) {
        next.dashboard_spec.layout.mobile = reconcileLayout(filtered, undefined, {
          compactVertical: false,
        });
      }
    }
  }

  return next;
}

function dedupeBindingsBySlot(
  bindings: DashboardDocument["bindings"],
  viewById: Map<string, DashboardDocument["dashboard_spec"]["views"][number]>,
): DashboardDocument["bindings"] {
  const bindingsBySlot = new Map<string, DashboardDocument["bindings"][number]>();

  for (const binding of bindings) {
    const normalizedBinding = normalizeBinding(binding, viewById.get(binding.view_id));
    bindingsBySlot.set(`${normalizedBinding.view_id}:${normalizedBinding.slot_id}`, {
      ...normalizedBinding,
      mode: binding.mode ?? "live",
    });
  }

  return Array.from(bindingsBySlot.values());
}

function upsertLayoutItem(
  items: DashboardLayoutItem[],
  item: DashboardLayoutItem,
  viewId: string,
): DashboardLayoutItem[] {
  const nextItems = items.filter((candidate) => candidate.view_id !== viewId);
  nextItems.push(item);
  return nextItems;
}

function createAppendedLayoutItemFromTemplate(
  layout: DashboardBreakpointLayout,
  viewId: string,
  template?: DashboardLayoutItem,
): DashboardLayoutItem {
  const fallback = createAppendedLayoutItem(layout, viewId);
  return {
    ...fallback,
    x: template?.x ?? fallback.x,
    w: template?.w ?? fallback.w,
    h: template?.h ?? fallback.h,
    view_id: viewId,
    y: fallback.y,
  };
}

function createAppendedMobileLayoutItemFromTemplate(
  layout: {
    items: DashboardLayoutItem[];
  },
  viewId: string,
  template?: DashboardLayoutItem,
): DashboardLayoutItem {
  const fallback = createDefaultMobileLayoutItem(layout, viewId);
  return {
    ...fallback,
    x: template?.x ?? fallback.x,
    w: template?.w ?? fallback.w,
    h: template?.h ?? fallback.h,
    view_id: viewId,
    y: fallback.y,
  };
}

function createDefaultMobileLayoutItem(
  layout: {
    items: DashboardLayoutItem[];
  },
  viewId: string,
): DashboardLayoutItem {
  return {
    view_id: viewId,
    x: 0,
    y: layout.items.reduce((maxY, item) => Math.max(maxY, item.y + item.h), 0),
    w: 4,
    h: 6,
  };
}
