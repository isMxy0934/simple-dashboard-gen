import type {
  BindingResults,
  DashboardDocument,
  DashboardSnapshot,
  ExecuteBatchRequest,
  PreviewRequest,
} from "../../../contracts";
import { executeBatchCached } from "../../shared/api/execute-batch-cache";
import {
  buildFilterValues,
  DEFAULT_RUNTIME_CONTEXT,
} from "../state/viewer-state";

export async function loadViewerSnapshot(
  dashboardId: string,
): Promise<DashboardSnapshot> {
  const response = await fetch(`/api/dashboards/${dashboardId}?mode=viewer`, {
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
  dashboardId: string;
  version: number;
  visibleViewIds: string[];
  selectedRange: (typeof import("../state/viewer-state").FILTERS)[number];
}): Promise<BindingResults> {
  const request: ExecuteBatchRequest = {
    dashboard_id: input.dashboardId,
    version: input.version,
    visible_view_ids: input.visibleViewIds,
    filter_values: buildFilterValues(input.selectedRange),
    runtime_context: DEFAULT_RUNTIME_CONTEXT,
  };

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
  const request: PreviewRequest = {
    dashboard_spec: input.dashboard.dashboard_spec,
    query_defs: input.dashboard.query_defs,
    bindings: input.dashboard.bindings,
    visible_view_ids: input.visibleViewIds,
    filter_values: buildFilterValues(input.selectedRange),
    runtime_context: DEFAULT_RUNTIME_CONTEXT,
  };

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
