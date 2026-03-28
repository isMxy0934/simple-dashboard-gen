import type { DashboardListMode, DashboardSummary } from "../../../contracts";

export type ManagementSection = "overview" | DashboardListMode;

export interface DashboardCollectionState {
  dashboards: DashboardSummary[];
  status: "idle" | "loading" | "error";
  message: string;
}

export type DashboardCollections = Record<DashboardListMode, DashboardCollectionState>;

export const MANAGEMENT_SECTIONS: ManagementSection[] = ["overview", "authoring", "viewer"];

export function createEmptyCollections(): DashboardCollections {
  return {
    authoring: createEmptyCollection("Loading authoring dashboards..."),
    viewer: createEmptyCollection("Loading viewer dashboards..."),
  };
}

export function createLoadingCollections(): DashboardCollections {
  return {
    authoring: {
      dashboards: [],
      status: "loading",
      message: "Loading authoring dashboards...",
    },
    viewer: {
      dashboards: [],
      status: "loading",
      message: "Loading viewer dashboards...",
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

export type CollectionMeta =
  | { kind: "translate"; key: string; values?: Record<string, string | number> }
  | { kind: "raw"; text: string };

export function describeCollection(
  mode: DashboardListMode,
  collection: DashboardCollectionState,
): CollectionMeta {
  if (collection.status === "loading") {
    return {
      kind: "translate",
      key:
        mode === "authoring"
          ? "management.collection.loadingAuthoring"
          : "management.collection.loadingViewer",
    };
  }

  if (collection.status === "error") {
    return { kind: "raw", text: collection.message };
  }

  if (mode === "authoring") {
    if (collection.dashboards.length === 0) {
      return { kind: "translate", key: "management.collection.authoringEmpty" };
    }
    return {
      kind: "translate",
      key: "management.collection.authoringCount",
      values: { count: collection.dashboards.length },
    };
  }

  const publishedCount = collection.dashboards.filter(
    (dashboard) => dashboard.snapshot_source === "published",
  ).length;
  const fallbackCount = collection.dashboards.length - publishedCount;

  if (collection.dashboards.length === 0) {
    return { kind: "translate", key: "management.collection.viewerEmpty" };
  }

  if (fallbackCount === 0) {
    return {
      kind: "translate",
      key: "management.collection.viewerSummaryClean",
      values: { published: publishedCount },
    };
  }

  return {
    kind: "translate",
    key: "management.collection.viewerSummary",
    values: { published: publishedCount, draft: fallbackCount },
  };
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
