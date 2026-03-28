import type {
  BindingResults,
  DashboardDocument,
  PreviewRequest,
} from "../../../contracts";
import type { AuthoringBreakpoint } from "../state/authoring-state";

const PREVIEW_FILTER_VALUES = {
  f_time_range: "last_12_weeks",
  f_region: "all",
} as const;

const RUNTIME_CONTEXT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const;

export async function runDashboardPreview(
  document: DashboardDocument,
  breakpoint: AuthoringBreakpoint,
): Promise<BindingResults> {
  const previewVisibleViewIds =
    document.dashboard_spec.layout[breakpoint]?.items.map((item) => item.view_id) ??
    [];

  const request: PreviewRequest = {
    dashboard_spec: document.dashboard_spec,
    query_defs: document.query_defs,
    bindings: document.bindings,
    visible_view_ids: previewVisibleViewIds,
    filter_values: { ...PREVIEW_FILTER_VALUES },
    runtime_context: { ...RUNTIME_CONTEXT },
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
