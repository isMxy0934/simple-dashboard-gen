import type { CSSProperties } from "react";
import { formatTimestamp } from "../../utils/time";
import type { TranslateFn } from "../../i18n";
import { groupFiltersForViewer } from "../template-runtime/filter-placement";
import type {
  Binding,
  BindingResults,
  DashboardBreakpointLayout,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardView,
  ExecuteBatchRequest,
  JsonValue,
} from "../../../contracts";
import { cssGridAutoRowsForLayout } from "../../utils/layout-presentation";
import type { ViewRenderStatus } from "./rendered-views";

export type ViewMode = "desktop" | "mobile";
export const FILTERS = ["today", "this_week", "last_12_weeks"] as const;
export const VIEW_MODES: ViewMode[] = ["desktop", "mobile"];
export const DEFAULT_RUNTIME_CONTEXT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const;

export function getDefaultTimeRange(
  dashboard: DashboardDocument,
): (typeof FILTERS)[number] {
  const timeFilter = groupFiltersForViewer(dashboard).templateShared.find(
    (filter) => filter.kind === "time_range",
  );
  if (
    timeFilter?.default_value === "today" ||
    timeFilter?.default_value === "this_week" ||
    timeFilter?.default_value === "last_12_weeks"
  ) {
    return timeFilter.default_value;
  }

  return "last_12_weeks";
}

export function buildDefaultViewerFilterValues(
  dashboard: DashboardDocument,
): Record<string, JsonValue> {
  return Object.fromEntries(
    dashboard.dashboard_spec.filters.flatMap((filter) =>
      filter.default_value === undefined
        ? []
        : [[filter.id, filter.default_value as JsonValue]],
    ),
  );
}

export function getTimeRangeFilterValue(
  dashboard: DashboardDocument,
  filterValues: Record<string, JsonValue>,
): (typeof FILTERS)[number] {
  const timeFilter = groupFiltersForViewer(dashboard).templateShared.find(
    (filter) => filter.kind === "time_range",
  );
  const value = timeFilter ? filterValues[timeFilter.id] : undefined;
  if (value === "today" || value === "this_week" || value === "last_12_weeks") {
    return value;
  }

  return getDefaultTimeRange(dashboard);
}

export function viewerStatusLabel(
  state: "loading" | "ready" | "error",
  t: TranslateFn,
) {
  if (state === "loading") {
    return t("viewer.dashboard.statusLoading");
  }

  if (state === "error") {
    return t("viewer.dashboard.statusError");
  }

  return t("viewer.dashboard.statusReady");
}

export function labelForRange(
  range: (typeof FILTERS)[number],
  t: TranslateFn,
) {
  switch (range) {
    case "today":
      return t("viewer.dashboard.rangeToday");
    case "this_week":
      return t("viewer.dashboard.rangeThisWeek");
    case "last_12_weeks":
      return t("viewer.dashboard.rangeLast12Weeks");
    default:
      return range;
  }
}

export function labelForViewMode(mode: ViewMode, t: TranslateFn) {
  return mode === "desktop"
    ? t("viewer.dashboard.layoutDesktop")
    : t("viewer.dashboard.layoutMobile");
}

export function buildFilterValues(
  range: (typeof FILTERS)[number],
): ExecuteBatchRequest["filter_values"] {
  return {
    f_time_range: range,
  };
}

export function getLayout(dashboard: DashboardDocument, mode: ViewMode) {
  const layout =
    dashboard.dashboard_spec.layout[mode] ??
    dashboard.dashboard_spec.layout.desktop ??
    dashboard.dashboard_spec.layout.mobile;

  if (!layout) {
    throw new Error("Report layout is missing.");
  }

  return layout;
}

export function getVisibleViews(
  dashboard: DashboardDocument,
  visibleViewIds: string[],
) {
  const viewById = new Map(dashboard.dashboard_spec.views.map((view) => [view.id, view]));
  return visibleViewIds
    .map((viewId) => viewById.get(viewId))
    .filter((view): view is DashboardView => Boolean(view));
}

export function hasAnyBindingForView(bindings: Binding[], viewId: string) {
  return bindings.some((binding) => binding.view_id === viewId);
}

export function buildStatusMap(
  views: DashboardView[],
  bindingResults: BindingResults,
  requestState: "loading" | "ready" | "error",
) {
  if (requestState === "loading") {
    return Object.fromEntries(views.map((view) => [view.id, "loading"])) as Record<
      string,
      ViewRenderStatus
    >;
  }

  if (requestState === "error") {
    return Object.fromEntries(views.map((view) => [view.id, "error"])) as Record<
      string,
      ViewRenderStatus
    >;
  }

  const statusMap: Record<string, ViewRenderStatus> = Object.fromEntries(
    views.map((view) => [view.id, "error"]),
  ) as Record<string, ViewRenderStatus>;
  const resultsByViewId = new Map<string, BindingResults[string][]>();

  for (const bindingResult of Object.values(bindingResults)) {
    const current = resultsByViewId.get(bindingResult.view_id) ?? [];
    current.push(bindingResult);
    resultsByViewId.set(bindingResult.view_id, current);
  }

  for (const view of views) {
    const results = resultsByViewId.get(view.id) ?? [];
    if (results.length === 0) {
      continue;
    }

    if (results.some((result) => result.status === "error")) {
      statusMap[view.id] = "error";
      continue;
    }

    if (results.every((result) => result.status === "empty")) {
      statusMap[view.id] = "empty";
      continue;
    }

    statusMap[view.id] = "ok";
  }

  return statusMap;
}

export function buildGridStyle(layout: DashboardBreakpointLayout): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
    gridAutoRows: cssGridAutoRowsForLayout(layout.row_height),
  };
}

export function buildCardStyle(item: DashboardLayoutItem): CSSProperties {
  return {
    gridColumn: `${item.x + 1} / span ${item.w}`,
    gridRow: `${item.y + 1} / span ${item.h}`,
  };
}

export function formatViewerTimestamp(timestamp: string): string {
  return formatTimestamp(timestamp);
}
