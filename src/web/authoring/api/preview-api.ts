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

export async function runPreview(input: {
  document: DashboardDocument;
  breakpoint: AuthoringBreakpoint;
  visibleViewIds?: string[];
}): Promise<{
  bindingResults: BindingResults;
  serverRendererChecks: RendererChecksByView;
  publishIssues: ValidationIssue[];
  visibleViewIds: string[];
}> {
  const previewVisibleViewIds =
    input.visibleViewIds ??
    input.document.dashboard_spec.layout[input.breakpoint]?.items.map((item) => item.view_id) ??
    [];

  const request = buildDashboardPreviewRequest({
    dashboard: input.document,
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

  return {
    bindingResults: payload.data.binding_results,
    serverRendererChecks: payload.data.renderer_checks ?? {},
    publishIssues: payload.data.publish_issues ?? [],
    visibleViewIds: previewVisibleViewIds,
  };
}

export async function validateRendererInBrowser(input: {
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

export async function persistRendererChecks(input: {
  workspaceId?: string | null;
  userId?: string | null;
  dashboardId: string;
  sessionId?: string | null;
  rendererChecks: RendererChecksByView;
}) {
  const checkSessionId =
    input.workspaceId && input.userId && input.sessionId
      ? buildAuthoringCompositeSessionId({
          workspaceId: input.workspaceId,
          userId: input.userId,
          dashboardId: input.dashboardId,
          sessionId: input.sessionId,
        })
      : input.sessionId ?? "sessionless";

  await persistAuthoringRendererChecks({
    workspaceId: input.workspaceId ?? undefined,
    dashboardId: input.dashboardId,
    sessionId: checkSessionId,
    rendererChecks: input.rendererChecks,
  });
}

export async function runDashboardPreview(
  document: DashboardDocument,
  breakpoint: AuthoringBreakpoint,
  dashboardId?: string | null,
  workspaceId?: string | null,
  sessionId?: string | null,
  options?: {
    userId?: string | null;
    visibleViewIds?: string[];
    persistChecks?: boolean;
  },
): Promise<{
  bindingResults: BindingResults;
  rendererChecks: RendererChecksByView;
  publishIssues: ValidationIssue[];
}> {
  const preview = await runPreview({
    document,
    breakpoint,
    visibleViewIds: options?.visibleViewIds,
  });
  const browserRendererChecks = await validateRendererInBrowser({
    document,
    bindingResults: preview.bindingResults,
    visibleViewIds: preview.visibleViewIds,
  });

  const rendererChecks = mergeRendererChecks(
    preview.serverRendererChecks,
    browserRendererChecks,
  );

  if (options?.persistChecks && dashboardId) {
    await persistRendererChecks({
      workspaceId,
      userId: options.userId,
      dashboardId,
      sessionId,
      rendererChecks,
    }).catch(() => undefined);
  }

  return {
    bindingResults: preview.bindingResults,
    rendererChecks,
    publishIssues: preview.publishIssues,
  };
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
