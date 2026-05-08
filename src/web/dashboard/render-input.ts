import type {
  DashboardDocument,
  ExecuteBatchRequest,
  JsonValue,
  PreviewRequest,
} from "../../contracts";

export type DashboardViewMode = "desktop" | "mobile";

export const DEFAULT_DASHBOARD_RUNTIME_CONTEXT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const;

export function resolveDashboardLayout(
  dashboard: DashboardDocument,
  mode: DashboardViewMode,
) {
  const layout =
    dashboard.dashboard_spec.layout[mode] ??
    dashboard.dashboard_spec.layout.desktop ??
    dashboard.dashboard_spec.layout.mobile;

  if (!layout) {
    throw new Error("Dashboard layout is missing.");
  }

  return layout;
}

export function resolveVisibleViewIdsForMode(
  dashboard: DashboardDocument,
  mode: DashboardViewMode,
) {
  return resolveDashboardLayout(dashboard, mode).items.map((item) => item.view_id);
}

export function buildDashboardFilterValues(
  dashboard: DashboardDocument,
  options?: {
    selectedTimeRange?: string | null;
    selectedFilterValues?: Record<string, JsonValue>;
  },
): Record<string, JsonValue> {
  const entries: Array<readonly [string, JsonValue]> = [];

  for (const filter of dashboard.dashboard_spec.filters) {
    const selectedValue = options?.selectedFilterValues?.[filter.id];
    if (selectedValue !== undefined) {
      entries.push([filter.id, selectedValue]);
      continue;
    }
    if (filter.kind === "time_range" && options?.selectedTimeRange) {
      entries.push([filter.id, options.selectedTimeRange]);
      continue;
    }
    if (filter.default_value !== undefined) {
      entries.push([filter.id, filter.default_value]);
    }
  }

  return Object.fromEntries(entries);
}

export function buildDashboardPreviewRequest(input: {
  dashboard: DashboardDocument;
  visibleViewIds: string[];
  selectedTimeRange?: string | null;
  selectedFilterValues?: Record<string, JsonValue>;
}): PreviewRequest {
  return {
    dashboard_spec: input.dashboard.dashboard_spec,
    query_defs: input.dashboard.query_defs,
    bindings: input.dashboard.bindings,
    visible_view_ids: input.visibleViewIds,
    filter_values: buildDashboardFilterValues(input.dashboard, {
      selectedTimeRange: input.selectedTimeRange,
      selectedFilterValues: input.selectedFilterValues,
    }),
    runtime_context: { ...DEFAULT_DASHBOARD_RUNTIME_CONTEXT },
  };
}

export function buildDashboardExecuteBatchRequest(input: {
  workspaceId: string;
  dashboardId: string;
  version: number;
  visibleViewIds: string[];
  dashboard: DashboardDocument;
  selectedTimeRange?: string | null;
  selectedFilterValues?: Record<string, JsonValue>;
}): ExecuteBatchRequest {
  return {
    workspace_id: input.workspaceId,
    dashboard_id: input.dashboardId,
    version: input.version,
    visible_view_ids: input.visibleViewIds,
    filter_values: buildDashboardFilterValues(input.dashboard, {
      selectedTimeRange: input.selectedTimeRange,
      selectedFilterValues: input.selectedFilterValues,
    }),
    runtime_context: { ...DEFAULT_DASHBOARD_RUNTIME_CONTEXT },
  };
}
