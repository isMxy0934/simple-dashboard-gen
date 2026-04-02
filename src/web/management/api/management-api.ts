import type {
  DashboardListMode,
  DashboardSnapshot,
  DashboardSummary,
} from "../../../contracts";
import { createEmptyCollections, type DashboardCollections } from "../state/management-state";

export async function loadManagementCollections(): Promise<DashboardCollections> {
  const results: Array<readonly [DashboardListMode, DashboardSummary[]]> = await Promise.all(
    (["authoring", "viewer"] as DashboardListMode[]).map(async (mode) => {
      const dashboards = await loadDashboardSummaries(mode);
      return [mode, dashboards] as const;
    }),
  );

  return {
    authoring: buildCollectionState(results, "authoring"),
    viewer: buildCollectionState(results, "viewer"),
  };
}

export async function createManagementDashboard(): Promise<string> {
  const response = await fetch("/api/dashboards", {
    method: "POST",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: DashboardSnapshot | null;
  };

  if (payload.status_code !== 200 || !payload.data?.dashboard_id) {
    throw new Error(payload.reason || "Unable to create dashboard.");
  }

  return payload.data.dashboard_id;
}

export async function deleteManagementDashboard(dashboardId: string): Promise<void> {
  const response = await fetch(`/api/dashboards/${dashboardId}`, {
    method: "DELETE",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
  };

  if (payload.status_code !== 200) {
    throw new Error(payload.reason || "Unable to delete dashboard.");
  }
}

async function loadDashboardSummaries(
  mode: DashboardListMode,
): Promise<DashboardSummary[]> {
  const response = await fetch(`/api/dashboards?mode=${mode}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      dashboards?: DashboardSummary[];
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.dashboards) {
    throw new Error(payload.reason || `Unable to load ${mode} dashboards.`);
  }

  return payload.data.dashboards;
}

function buildCollectionState(
  results: Array<readonly [DashboardListMode, DashboardSummary[]]>,
  mode: DashboardListMode,
) {
  const dashboards = results.find(([entryMode]) => entryMode === mode)?.[1] ?? [];
  return dashboards.length === 0
    ? {
        dashboards,
        status: "idle" as const,
        message: `No ${mode} dashboards yet.`,
      }
    : {
        dashboards,
        status: "idle" as const,
        message: `${dashboards.length} ${mode} dashboards loaded.`,
      };
}

export function createLoadingManagementCollections(): DashboardCollections {
  return createEmptyCollections();
}
