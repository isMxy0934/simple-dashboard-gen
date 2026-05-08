import type {
  BindingResults,
  DashboardDocument,
  DashboardSnapshot,
  JsonValue,
} from "../../../contracts";
import { executeBatchCached } from "../../api/execute-batch-cache";
import {
  buildDashboardExecuteBatchRequest,
  buildDashboardPreviewRequest,
} from "../../dashboard/render-input";

export async function loadViewerSnapshot(
  dashboardId: string,
  workspaceId: string,
): Promise<DashboardSnapshot> {
  const params = new URLSearchParams({ mode: "viewer" });
  params.set("workspaceId", workspaceId);
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
  workspaceId: string;
  dashboardId: string;
  version: number;
  dashboard: DashboardDocument;
  visibleViewIds: string[];
  selectedFilterValues: Record<string, JsonValue>;
}): Promise<BindingResults> {
  const request = buildDashboardExecuteBatchRequest({
    workspaceId: input.workspaceId,
    dashboardId: input.dashboardId,
    version: input.version,
    dashboard: input.dashboard,
    visibleViewIds: input.visibleViewIds,
    selectedFilterValues: input.selectedFilterValues,
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
  selectedFilterValues: Record<string, JsonValue>;
}): Promise<BindingResults> {
  const request = buildDashboardPreviewRequest({
    dashboard: input.dashboard,
    visibleViewIds: input.visibleViewIds,
    selectedFilterValues: input.selectedFilterValues,
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
