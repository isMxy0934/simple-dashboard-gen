import type {
  DashboardDocument,
  DashboardFilter,
} from "../../contracts";
import { isLiveBinding } from "./bindings";
import { generateMobileLayout, reconcileLayout } from "./layout";

/** Matches client authoring mobile mode; kept as string union to avoid importing client. */
export type DashboardMobileLayoutMode = "auto" | "custom";

interface ReconcileDashboardDocumentContractOptions {
  mobileLayoutMode?: DashboardMobileLayoutMode;
  pruneUnusedQueries?: boolean;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const DEFAULT_FILTERS: DashboardFilter[] = [
  {
    id: "f_time_range",
    kind: "time_range",
    label: "Time Range",
    default_value: "last_12_weeks",
    resolved_fields: ["start", "end", "timezone"],
  },
  {
    id: "f_region",
    kind: "single_select",
    label: "Region",
    default_value: "all",
    options: [
      { label: "All Regions", value: "all" },
      { label: "East", value: "East" },
      { label: "West", value: "West" },
      { label: "South", value: "South" },
    ],
  },
];

export function createInitialAuthoringDocument(): DashboardDocument {
  return {
    dashboard_spec: {
      schema_version: "0.1",
      dashboard: {
        name: "Untitled Dashboard",
        description: "",
      },
      layout: {
        desktop: {
          cols: 12,
          row_height: 30,
          items: [],
        },
        mobile: {
          cols: 4,
          row_height: 30,
          items: [],
        },
      },
      views: [],
      filters: clone(DEFAULT_FILTERS),
    },
    query_defs: [],
    bindings: [],
  };
}

export function cloneDashboardDocument(document: DashboardDocument): DashboardDocument {
  return clone(document);
}

export function ensureLayoutMap(document: DashboardDocument): DashboardDocument {
  const nextDocument = cloneDashboardDocument(document);
  const desktopLayout = nextDocument.dashboard_spec.layout.desktop ?? {
    cols: 12,
    row_height: 30,
    items: [],
  };

  nextDocument.dashboard_spec.layout.desktop = desktopLayout;
  nextDocument.dashboard_spec.layout.mobile =
    nextDocument.dashboard_spec.layout.mobile ?? generateMobileLayout(desktopLayout);
  nextDocument.bindings = nextDocument.bindings.map((binding) => ({
    ...binding,
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

  next.bindings = dedupeBindingsByViewId(next.bindings).filter((binding) =>
    viewIds.has(binding.view_id),
  );

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

/**
 * Drop orphan layout entries, merge duplicate view slots, and resolve overlaps.
 * Call after load from API/local draft and whenever a full document is applied (e.g. AI patch).
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
      filtered.items.length > 0 ? reconcileLayout(filtered) : { ...desktop, items: [] };
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
        next.dashboard_spec.layout.mobile = reconcileLayout(filtered);
      }
    }
  }

  return next;
}

function dedupeBindingsByViewId(
  bindings: DashboardDocument["bindings"],
): DashboardDocument["bindings"] {
  const bindingsByViewId = new Map<string, DashboardDocument["bindings"][number]>();

  for (const binding of bindings) {
    bindingsByViewId.set(binding.view_id, {
      ...binding,
      mode: binding.mode ?? "live",
    });
  }

  return Array.from(bindingsByViewId.values());
}
