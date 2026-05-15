import type { DashboardListMode, DashboardSummary } from "../../../contracts";

export type ManagementSection =
  | "overview"
  | "reports"
  | "datasources"
  | "views"
  | "users"
  | "settings";
export type ReportListTab = DashboardListMode;

export interface DashboardCollectionState {
  dashboards: DashboardSummary[];
  status: "idle" | "loading" | "error";
  message: string;
}

export type DashboardCollections = Record<DashboardListMode, DashboardCollectionState>;

export interface DatasourceOverviewState {
  count: number;
  status: "idle" | "loading" | "error";
  message: string;
}

export const MANAGEMENT_SECTIONS: ManagementSection[] = [
  "overview",
  "reports",
  "datasources",
  "views",
  "users",
  "settings",
];

export function createEmptyCollections(): DashboardCollections {
  return {
    authoring: createEmptyCollection("Loading draft reports..."),
    viewer: createEmptyCollection("Loading published reports..."),
  };
}

export function createLoadingCollections(): DashboardCollections {
  return {
    authoring: {
      dashboards: [],
      status: "loading",
      message: "Loading draft reports...",
    },
    viewer: {
      dashboards: [],
      status: "loading",
      message: "Loading published reports...",
    },
  };
}

export function createEmptyCollection(message: string): DashboardCollectionState {
  return {
    dashboards: [],
    status: "idle",
    message,
  };
}

export function createOverviewStats(collections: DashboardCollections) {
  const authoringDashboards = collections.authoring.dashboards;
  const viewerDashboards = collections.viewer.dashboards;
  const uniqueIds = new Set([
    ...authoringDashboards.map((dashboard) => dashboard.dashboard_id),
    ...viewerDashboards.map((dashboard) => dashboard.dashboard_id),
  ]);

  const total = uniqueIds.size;
  const drafts = authoringDashboards.filter(
    (dashboard) => dashboard.snapshot_source === "draft",
  ).length;
  const published = viewerDashboards.filter(
    (dashboard) => dashboard.snapshot_source === "published",
  ).length;

  return {
    total,
    drafts,
    published,
    recent: countRecentDashboards(authoringDashboards, viewerDashboards),
    draftCoverage: total === 0 ? 0 : Math.round((drafts / total) * 100),
    pendingRelease: Math.max(total - published, 0),
  };
}

export type OverviewStats = ReturnType<typeof createOverviewStats>;

export function createRecentDashboards(collections: DashboardCollections): DashboardSummary[] {
  const merged = [...collections.authoring.dashboards, ...collections.viewer.dashboards];
  const deduped = new Map<string, DashboardSummary>();

  merged
    .sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
    )
    .forEach((dashboard) => {
      if (!deduped.has(dashboard.dashboard_id)) {
        deduped.set(dashboard.dashboard_id, dashboard);
      }
    });

  return [...deduped.values()].slice(0, 6);
}

export function filterDashboards(
  dashboards: DashboardSummary[],
  searchValue: string,
): DashboardSummary[] {
  const needle = searchValue.trim().toLowerCase();
  if (!needle) {
    return dashboards;
  }

  return dashboards.filter((dashboard) => {
    return [dashboard.name, dashboard.description, dashboard.dashboard_id]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(needle));
  });
}

function countRecentDashboards(
  authoringDashboards: DashboardSummary[],
  viewerDashboards: DashboardSummary[],
) {
  const uniqueIds = new Set([
    ...authoringDashboards.map((dashboard) => dashboard.dashboard_id),
    ...viewerDashboards.map((dashboard) => dashboard.dashboard_id),
  ]);

  return Math.min(uniqueIds.size, 6);
}
