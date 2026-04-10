import type { BindingResults } from "../../../contracts";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";
import { summarizeRendererValidationChecks } from "../../../renderers/core/validation-result";
import type { TranslateFn } from "../../i18n";

export type PreviewState = "idle" | "loading" | "ready" | "error";

export function formatRuntimeCheckSummary(
  bindingResults: BindingResults,
  t: TranslateFn,
): string {
  const results = Object.values(bindingResults);
  const okCount = results.filter((result) => result.status === "ok").length;
  const emptyCount = results.filter((result) => result.status === "empty").length;
  const errorCount = results.filter((result) => result.status === "error").length;

  if (errorCount > 0) {
    return t("authoring.persistence.runtimeCheckErrorSummary", {
      ok: okCount,
      empty: emptyCount,
      error: errorCount,
    });
  }

  if (emptyCount > 0) {
    return t("authoring.persistence.runtimeCheckEmptySummary", {
      ok: okCount,
      empty: emptyCount,
    });
  }

  return t("authoring.persistence.runtimeCheckOkSummary", {
    ok: okCount,
  });
}

export function formatPreviewCheckSummary(
  bindingResults: BindingResults,
  rendererChecks: RendererChecksByView,
  t: TranslateFn,
): string {
  const runtimeSummary = formatRuntimeCheckSummary(bindingResults, t);
  const rendererSummaries = Object.values(rendererChecks).map((checks) =>
    summarizeRendererValidationChecks(checks),
  );
  const rendererErrors = rendererSummaries.filter((summary) => summary.status === "error");
  const rendererWarnings = rendererSummaries.filter((summary) => summary.status === "warning");

  if (rendererErrors.length > 0) {
    return `${runtimeSummary} ${t("authoring.persistence.rendererErrorSummary", {
      count: rendererErrors.length,
    })}`;
  }

  if (rendererWarnings.length > 0) {
    return `${runtimeSummary} ${t("authoring.persistence.rendererWarningSummary", {
      count: rendererWarnings.length,
    })}`;
  }

  return `${runtimeSummary} ${t("authoring.persistence.rendererOkSummary")}`;
}

export function formatPreviewState(previewState: PreviewState): string {
  if (previewState === "loading") {
    return "Running";
  }

  if (previewState === "ready") {
    return "OK";
  }

  if (previewState === "error") {
    return "Error";
  }

  return "Idle";
}
