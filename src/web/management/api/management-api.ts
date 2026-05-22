import type {
  DashboardListMode,
  DashboardSnapshot,
  DashboardSummary,
} from "../../../contracts";
import {
  createEmptyCollections,
  type DashboardCollections,
} from "../state/management-state";

function requireWorkspaceId(workspaceId: string): string {
  const trimmed = workspaceId.trim();
  if (!trimmed) {
    throw new Error("Workspace id is required.");
  }
  return trimmed;
}

function requireUserId(userId: string): string {
  const trimmed = userId.trim();
  if (!trimmed) {
    throw new Error("Workspace user id is required.");
  }
  return trimmed;
}

export async function loadManagementCollections(input: {
  workspaceId: string;
}): Promise<DashboardCollections> {
  const workspaceId = requireWorkspaceId(input.workspaceId);
  const results: Array<readonly [DashboardListMode, DashboardSummary[]]> =
    await Promise.all(
      (["authoring", "viewer"] as DashboardListMode[]).map(async (mode) => {
        const dashboards = await loadDashboardSummaries(mode, workspaceId);
        return [mode, dashboards] as const;
      }),
    );

  return {
    authoring: buildCollectionState(results, "authoring"),
    viewer: buildCollectionState(results, "viewer"),
  };
}

export async function createManagementDashboard(input: {
  workspaceId: string;
  userId: string;
  templateId?: string;
  templateVersion?: string;
}): Promise<string> {
  requireWorkspaceId(input.workspaceId);
  requireUserId(input.userId);
  const params = new URLSearchParams();
  if (input.templateId?.trim()) {
    params.set("templateId", input.templateId.trim());
  }
  if (input.templateVersion?.trim()) {
    params.set("templateVersion", input.templateVersion.trim());
  }
  const response = await fetch(
    `/api/dashboards?${params.toString()}`,
    {
      method: "POST",
    },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: DashboardSnapshot | null;
  };

  if (payload.status_code !== 200 || !payload.data?.dashboard_id) {
    throw new Error(payload.reason || "Unable to create report.");
  }

  return payload.data.dashboard_id;
}

export async function deleteManagementDashboard(input: {
  workspaceId: string;
  dashboardId: string;
}): Promise<void> {
  requireWorkspaceId(input.workspaceId);
  const response = await fetch(`/api/dashboards/${input.dashboardId}`, {
    method: "DELETE",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
  };

  if (payload.status_code !== 200) {
    throw new Error(payload.reason || "Unable to delete report.");
  }
}

export async function unpublishManagementDashboard(input: {
  workspaceId: string;
  dashboardId: string;
}): Promise<void> {
  requireWorkspaceId(input.workspaceId);
  const response = await fetch(`/api/dashboards/${input.dashboardId}/publish`, {
    method: "DELETE",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
  };

  if (payload.status_code !== 200) {
    throw new Error(payload.reason || "Unable to unpublish report.");
  }
}

async function loadDashboardSummaries(
  mode: DashboardListMode,
  workspaceId: string,
): Promise<DashboardSummary[]> {
  const response = await fetch(
    `/api/dashboards?mode=${mode}`,
    {
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      dashboards?: DashboardSummary[];
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.dashboards) {
    throw new Error(payload.reason || `Unable to load ${mode} reports.`);
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
        message: `No ${mode} reports yet.`,
      }
    : {
        dashboards,
        status: "idle" as const,
        message: `${dashboards.length} ${mode} reports loaded.`,
      };
}

export function createLoadingManagementCollections(): DashboardCollections {
  return createEmptyCollections();
}
