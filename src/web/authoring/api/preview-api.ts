import type {
  BindingResults,
  DashboardDocument,
  JsonValue,
  PreviewRequest,
} from "../../../contracts";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";
import { materializeEChartsOptionTemplate } from "../../../renderers/echarts/browser/materialize-option";
import { validateEChartsOptionInBrowser } from "../../../renderers/echarts/browser/validate-option";
import { persistAuthoringRendererChecks } from "../agent/agent-checks-client";
import type { AuthoringBreakpoint } from "../state/authoring-state";

const RUNTIME_CONTEXT = {
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
} as const;

export async function runDashboardPreview(
  document: DashboardDocument,
  breakpoint: AuthoringBreakpoint,
  dashboardId?: string | null,
): Promise<{
  bindingResults: BindingResults;
  rendererChecks: RendererChecksByView;
}> {
  const previewVisibleViewIds =
    document.dashboard_spec.layout[breakpoint]?.items.map((item) => item.view_id) ??
    [];

  const request: PreviewRequest = {
    dashboard_spec: document.dashboard_spec,
    query_defs: document.query_defs,
    bindings: document.bindings,
    visible_view_ids: previewVisibleViewIds,
    filter_values: buildPreviewFilterValues(document),
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
    data?: {
      binding_results: BindingResults;
      renderer_checks?: RendererChecksByView;
    } | null;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(payload.reason ?? `Preview failed with HTTP ${response.status}`);
  }

  const browserRendererChecks = await validateVisibleViewsInBrowser({
    document,
    bindingResults: payload.data.binding_results,
    visibleViewIds: previewVisibleViewIds,
  });

  const rendererChecks = mergeRendererChecks(
    payload.data.renderer_checks ?? {},
    browserRendererChecks,
  );

  if (dashboardId) {
    void persistAuthoringRendererChecks({
      dashboardId,
      rendererChecks,
    }).catch(() => undefined);
  }

  return {
    bindingResults: payload.data.binding_results,
    rendererChecks,
  };
}

function buildPreviewFilterValues(document: DashboardDocument): Record<string, JsonValue> {
  return Object.fromEntries(
    document.dashboard_spec.filters
      .filter((filter) => filter.default_value !== undefined)
      .map((filter) => [filter.id, filter.default_value as JsonValue]),
  );
}

async function validateVisibleViewsInBrowser(input: {
  document: DashboardDocument;
  bindingResults: BindingResults;
  visibleViewIds: string[];
}): Promise<RendererChecksByView> {
  const result: RendererChecksByView = {};

  for (const viewId of input.visibleViewIds) {
    const view = input.document.dashboard_spec.views.find((candidate) => candidate.id === viewId);
    if (!view) {
      continue;
    }

    const materializedOption = materializeEChartsOptionTemplate({
      template: view.renderer.option_template,
      slots: view.renderer.slots,
      bindingResults: Object.values(input.bindingResults)
        .filter((bindingResult) => bindingResult.view_id === viewId)
        .map((bindingResult) => ({
          slot_id: bindingResult.slot_id,
          result: bindingResult,
        })),
    });

    result[viewId] = {
      browser: await validateEChartsOptionInBrowser(materializedOption),
    };
  }

  return result;
}

function mergeRendererChecks(
  serverChecks: RendererChecksByView,
  browserChecks: RendererChecksByView,
): RendererChecksByView {
  const viewIds = new Set([
    ...Object.keys(serverChecks),
    ...Object.keys(browserChecks),
  ]);

  return Object.fromEntries(
    [...viewIds].map((viewId) => [
      viewId,
      {
        ...(serverChecks[viewId] ?? {}),
        ...(browserChecks[viewId] ?? {}),
      },
    ]),
  );
}
