import type {
  BindingResults,
  DashboardDocument,
  DashboardSnapshot,
} from "../../../contracts";
import { executeBatchCached } from "../../api/execute-batch-cache";
import {
  buildDashboardExecuteBatchRequest,
  buildDashboardPreviewRequest,
} from "../../dashboard/render-input";

export async function loadViewerSnapshot(
  dashboardId: string,
  workspaceId?: string | null,
): Promise<DashboardSnapshot> {
  const params = new URLSearchParams({ mode: "viewer" });
  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }
  const response = await fetch(`/api/dashboards/${dashboardId}?${params.toString()}`, {
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: DashboardSnapshot | null;
  };

  if (payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason || "Unable to load dashboard.");
  }

  return payload.data;
}

export async function executeViewerBatch(input: {
  workspaceId?: string | null;
  dashboardId: string;
  version: number;
  dashboard: DashboardDocument;
  visibleViewIds: string[];
  selectedRange: (typeof import("../state/viewer-state").FILTERS)[number];
}): Promise<BindingResults> {
  const request = buildDashboardExecuteBatchRequest({
    workspaceId: input.workspaceId,
    dashboardId: input.dashboardId,
    version: input.version,
    dashboard: input.dashboard,
    visibleViewIds: input.visibleViewIds,
    selectedTimeRange: input.selectedRange,
  });

  const response = await executeBatchCached(request);
  if (response.status_code !== 200 || !response.data) {
    throw new Error(response.reason || "Batch request failed");
  }

  return response.data.binding_results;
}

export async function executePreviewRequest(input: {
  dashboard: DashboardDocument;
  visibleViewIds: string[];
  selectedRange: (typeof import("../state/viewer-state").FILTERS)[number];
}): Promise<BindingResults> {
  const request = buildDashboardPreviewRequest({
    dashboard: input.dashboard,
    visibleViewIds: input.visibleViewIds,
    selectedTimeRange: input.selectedRange,
  });

  const response = await fetch("/api/preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    status_code?: number;
    reason?: string;
    data?: { binding_results: BindingResults } | null;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason ?? `Preview failed with HTTP ${response.status}`);
  }

  return payload.data.binding_results;
}
