import type { DashboardDocument } from "../../../contracts";
import type { MobileLayoutMode } from "../state/authoring-state";
import { ensureLayoutMap } from "../../../domain/dashboard/document";
import { formatTimestamp } from "../../../shared/time";

export interface LoadedRemoteAuthoringState {
  dashboard: DashboardDocument;
  selectedViewId: string | null;
  mobileLayoutMode: MobileLayoutMode;
  message: string;
  version: number;
  updatedAt: string;
}

export async function loadRemoteAuthoringState(
  dashboardId: string,
): Promise<LoadedRemoteAuthoringState> {
  const response = await fetch(`/api/dashboards/${dashboardId}?mode=authoring`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      document: DashboardDocument;
      version: number;
      updated_at: string;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data?.document) {
    throw new Error(payload.reason || "Unable to load dashboard.");
  }

  const restoredDashboard = ensureLayoutMap(payload.data.document);
  return {
    dashboard: restoredDashboard,
    selectedViewId: restoredDashboard.dashboard_spec.views[0]?.id ?? null,
    mobileLayoutMode: "auto",
    message: `Loaded dashboard v${payload.data.version} from ${formatTimestamp(payload.data.updated_at)}.`,
    version: payload.data.version,
    updatedAt: payload.data.updated_at,
  };
}

export async function saveRemoteDashboardDraft(input: {
  dashboardId: string;
  dashboard: DashboardDocument;
}): Promise<{ version: number; savedAt: string; changed: boolean }> {
  const response = await fetch("/api/dashboard/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...input.dashboard,
      dashboard_id: input.dashboardId,
    }),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      version: number;
      saved_at: string;
      changed?: boolean;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to save dashboard.");
  }

  return {
    version: payload.data.version,
    savedAt: payload.data.saved_at,
    changed: payload.data.changed ?? true,
  };
}

export async function publishRemoteDashboard(input: {
  dashboardId: string;
  dashboard: DashboardDocument;
}): Promise<{ version: number; publishedAt: string; changed: boolean }> {
  const response = await fetch("/api/dashboard/publish", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...input.dashboard,
      dashboard_id: input.dashboardId,
    }),
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: {
      version: number;
      published_at: string;
      changed?: boolean;
    } | null;
  };

  if (payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to publish dashboard.");
  }

  return {
    version: payload.data.version,
    publishedAt: payload.data.published_at,
    changed: payload.data.changed ?? true,
  };
}
