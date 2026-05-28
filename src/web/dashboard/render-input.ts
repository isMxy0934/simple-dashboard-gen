import type {
  DashboardDocument,
  ExecuteBatchRequest,
  JsonValue,
  PreviewRequest,
} from "../../contracts";
import { getApplicableRenderableFilters } from "@/domain/dashboard/filter-scope";

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
    throw new Error("Report layout is missing.");
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
    visibleViewIds?: string[];
    selectedTimeRange?: string | null;
    selectedFilterValues?: Record<string, JsonValue>;
  },
): Record<string, JsonValue> {
  const entries: Array<readonly [string, JsonValue]> = [];
  const visibleViewIds =
    options?.visibleViewIds ?? dashboard.dashboard_spec.views.map((view) => view.id);
  const applicableFilters = getApplicableRenderableFilters(
    dashboard.dashboard_spec.filters,
    visibleViewIds,
  );

  for (const filter of applicableFilters) {
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
    schema_version: input.dashboard.schema_version,
    dashboard_spec: input.dashboard.dashboard_spec,
    query_defs: input.dashboard.query_defs,
    bindings: input.dashboard.bindings,
    visible_view_ids: input.visibleViewIds,
    filter_values: buildDashboardFilterValues(input.dashboard, {
      visibleViewIds: input.visibleViewIds,
      selectedTimeRange: input.selectedTimeRange,
      selectedFilterValues: input.selectedFilterValues,
    }),
    runtime_context: { ...DEFAULT_DASHBOARD_RUNTIME_CONTEXT },
  };
}

export function buildDashboardExecuteBatchRequest(input: {
  dashboardId: string;
  version: number;
  visibleViewIds: string[];
  dashboard: DashboardDocument;
  selectedTimeRange?: string | null;
  selectedFilterValues?: Record<string, JsonValue>;
}): ExecuteBatchRequest {
  return {
    dashboard_id: input.dashboardId,
    version: input.version,
    visible_view_ids: input.visibleViewIds,
    filter_values: buildDashboardFilterValues(input.dashboard, {
      visibleViewIds: input.visibleViewIds,
      selectedTimeRange: input.selectedTimeRange,
      selectedFilterValues: input.selectedFilterValues,
    }),
    runtime_context: { ...DEFAULT_DASHBOARD_RUNTIME_CONTEXT },
  };
}
