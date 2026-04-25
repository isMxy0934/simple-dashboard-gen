import type {
  BindingResults,
  DashboardDocument,
} from "../../../contracts";
import type { ValidationIssue } from "../../../contracts/validation";
import { buildDashboardPreviewRequest } from "../../dashboard/render-input";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";
import { materializeEChartsOptionTemplate } from "../../../renderers/echarts/browser/materialize-option";
import { validateEChartsOptionInBrowser } from "../../../renderers/echarts/browser/validate-option";
import { buildAuthoringCompositeSessionId } from "../../../shared/authoring/session-key";
import { getApiErrorMessage } from "../../api/api-error";
import { persistAuthoringRendererChecks } from "../agent/agent-checks-client";
import type { AuthoringBreakpoint } from "../state/authoring-state";

export async function runDashboardPreview(
  document: DashboardDocument,
  breakpoint: AuthoringBreakpoint,
  dashboardId?: string | null,
  workspaceId?: string | null,
  sessionId?: string | null,
  options?: {
    userId?: string | null;
    visibleViewIds?: string[];
  },
): Promise<{
  bindingResults: BindingResults;
  rendererChecks: RendererChecksByView;
  publishIssues: ValidationIssue[];
}> {
  const previewVisibleViewIds =
    options?.visibleViewIds ??
    document.dashboard_spec.layout[breakpoint]?.items.map((item) => item.view_id) ??
    [];

  const request = buildDashboardPreviewRequest({
    dashboard: document,
    visibleViewIds: previewVisibleViewIds,
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
    data?: {
      binding_results: BindingResults;
      renderer_checks?: RendererChecksByView;
      publish_issues?: ValidationIssue[];
    } | null;
  };

  if (!response.ok || payload.status_code !== 200 || !payload.data) {
    throw new Error(getApiErrorMessage(payload, `Preview failed with HTTP ${response.status}`));
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
    const checkSessionId =
      workspaceId && options?.userId && sessionId
        ? buildAuthoringCompositeSessionId({
            workspaceId,
            userId: options.userId,
            dashboardId,
            sessionId,
          })
        : sessionId ?? "sessionless";
    void persistAuthoringRendererChecks({
      workspaceId: workspaceId ?? undefined,
      dashboardId,
      sessionId: checkSessionId,
      rendererChecks,
    }).catch(() => undefined);
  }

  return {
    bindingResults: payload.data.binding_results,
    rendererChecks,
    publishIssues: payload.data.publish_issues ?? [],
  };
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
