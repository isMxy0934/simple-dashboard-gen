import type {
  BindingResults,
  DashboardDocument,
} from "../../../contracts";
import type { ValidationIssue } from "../../../contracts/validation";
import { buildDashboardPreviewRequest } from "../../dashboard/render-input";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";
import { summarizeRendererValidationChecks } from "../../../renderers/core/validation-result";
import { materializeEChartsOptionTemplate } from "../../../renderers/echarts/browser/materialize-option";
import { validateEChartsOptionInBrowser } from "../../../renderers/echarts/browser/validate-option";
import type { DashboardChartLabelKey } from "../../../presentation/dashboard/chart-i18n";
import { resolveAuthoringPreviewChartPresentation } from "./preview-presentation";
import { getApiErrorMessage } from "../../api/api-error";
import { dashboardDraftDocumentHash } from "./dashboard-api";
import { persistAuthoringCheckSnapshots } from "../agent/agent-checks-client";
import type { AuthoringBreakpoint } from "../state/authoring-state";
import type {
  AuthoringCheckFailure,
  AuthoringCheckSummary,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";

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
  chartLabels?: Partial<Record<DashboardChartLabelKey, string>> | null;
}): Promise<RendererChecksByView> {
  const result: RendererChecksByView = {};
  const chartPresentation = resolveAuthoringPreviewChartPresentation({
    document: input.document,
    chartLabels: input.chartLabels,
  });

  for (const viewId of input.visibleViewIds) {
    const view = input.document.dashboard_spec.views.find((candidate) => candidate.id === viewId);
    if (!view) {
      continue;
    }

    const materializedOption = materializeEChartsOptionTemplate({
      template: view.renderer.option_template,
      slots: view.renderer.slots,
      transforms: view.renderer.transforms,
      presentation: chartPresentation,
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

function buildRuntimeSummary(input: {
  bindingResults: BindingResults;
  rendererChecks: RendererChecksByView;
  publishIssues: ValidationIssue[];
}): AuthoringCheckSummary {
  const bindingFailures: AuthoringCheckFailure[] = Object.entries(input.bindingResults)
    .filter(([, result]) => result.status === "error")
    .map(([bindingId, result]) => ({
      source: "runtime",
      code: result.status === "error" ? result.code ?? "binding_error" : "binding_error",
      message:
        result.status === "error"
          ? result.message ?? "Binding execution failed."
          : "Binding execution failed.",
      view_id: result.view_id,
      query_id: result.query_id,
      binding_id: bindingId,
    }));
  const rendererFailures: AuthoringCheckFailure[] = Object.entries(input.rendererChecks)
    .flatMap(([viewId, checks]) =>
      (["server", "browser"] as const).flatMap((target) => {
        const check = checks[target];
        if (check?.status !== "error") {
          return [];
        }
        return [{
          source: "renderer" as const,
          code: `${target}_renderer_error`,
          message: check.message ?? check.reason,
          view_id: viewId,
        }];
      }),
    );
  const contractFailures: AuthoringCheckFailure[] = input.publishIssues.map((issue) => ({
    source: "contract",
    code: "publish_validation_issue",
    message: issue.message,
    path: issue.path,
  }));
  const resultValues = Object.values(input.bindingResults);

  return {
    status:
      bindingFailures.length > 0 ||
      rendererFailures.length > 0 ||
      contractFailures.length > 0
        ? "error"
        : "ok",
    reason:
      bindingFailures.length > 0 ||
      rendererFailures.length > 0 ||
      contractFailures.length > 0
        ? "Runtime, renderer, or publish validation found issues."
        : "Runtime and renderer checks passed.",
    counts: {
      ok: resultValues.filter((result) => result.status === "ok").length,
      empty: resultValues.filter((result) => result.status === "empty").length,
      error: resultValues.filter((result) => result.status === "error").length,
    },
    errors: [...bindingFailures, ...rendererFailures, ...contractFailures],
  };
}

function buildPreviewCheckSnapshots(input: {
  document: DashboardDocument;
  bindingResults: BindingResults;
  rendererChecks: RendererChecksByView;
  publishIssues: ValidationIssue[];
  visibleViewIds: string[];
}): ViewCheckSnapshot[] {
  const runtimeSummary = buildRuntimeSummary(input);
  const checkedAt = new Date().toISOString();
  const documentHash = dashboardDraftDocumentHash(input.document);

  return input.visibleViewIds.map((viewId) => {
    const bindingIds = input.document.bindings
      .filter((binding) => binding.view_id === viewId)
      .map((binding) => binding.id);
    const queryIds = [
      ...new Set(
        input.document.bindings
          .filter((binding) => binding.view_id === viewId)
          .map((binding) => binding.query_id)
          .filter((queryId): queryId is string => typeof queryId === "string"),
      ),
    ];
    const viewBindingResults = Object.fromEntries(
      Object.entries(input.bindingResults).filter(([bindingId, result]) =>
        bindingIds.includes(bindingId) || result.view_id === viewId,
      ),
    );
    const hasRuntimeError = Object.values(viewBindingResults).some(
      (result) => result.status === "error",
    );
    const hasEmptyResult =
      Object.values(viewBindingResults).length > 0 &&
      Object.values(viewBindingResults).every((result) => result.status === "empty");
    const rendererSummary = summarizeRendererValidationChecks(input.rendererChecks[viewId]);
    const hasRendererError = rendererSummary.status === "error";

    return {
      view_id: viewId,
      status: hasRuntimeError || hasRendererError
        ? "error"
        : hasEmptyResult
          ? "empty"
          : "ok",
      reason:
        hasRuntimeError || hasRendererError
          ? rendererSummary.status === "error"
            ? rendererSummary.reason
            : "Runtime check found binding errors."
          : hasEmptyResult
            ? "Runtime query returned no rows."
            : rendererSummary.reason,
      last_checked_at: checkedAt,
      document_hash: documentHash,
      source: "browser",
      query_ids: queryIds,
      binding_ids: bindingIds,
      runtime_summary: runtimeSummary,
      runtime_evidence: {
        binding_results: viewBindingResults,
        publish_issues: input.publishIssues,
        visible_view_ids: input.visibleViewIds,
      },
      renderer_checks: input.rendererChecks[viewId] ?? {},
    };
  });
}

export async function runDashboardPreview(
  document: DashboardDocument,
  breakpoint: AuthoringBreakpoint,
  dashboardId?: string | null,
  workspaceId?: string | null,
  chatSessionId?: string | null,
  options?: {
    userId?: string | null;
    visibleViewIds?: string[];
    persistChecks?: boolean;
    chartLabels?: Partial<Record<DashboardChartLabelKey, string>> | null;
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
    chartLabels: options?.chartLabels,
  });

  const rendererChecks = mergeRendererChecks(
    preview.serverRendererChecks,
    browserRendererChecks,
  );

  if (
    options?.persistChecks &&
    dashboardId &&
    workspaceId &&
    options.userId &&
    chatSessionId
  ) {
    await persistAuthoringCheckSnapshots({
      workspaceId,
      userId: options.userId,
      dashboardId,
      chatSessionId,
      checks: buildPreviewCheckSnapshots({
        document,
        bindingResults: preview.bindingResults,
        rendererChecks,
        publishIssues: preview.publishIssues,
        visibleViewIds: preview.visibleViewIds,
      }),
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
