import type { BindingResults } from "../../../contracts";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";
import { summarizeRendererValidationChecks } from "../../../renderers/core/validation-result";

export type PreviewState = "idle" | "loading" | "ready" | "error";

export function formatRuntimeCheckSummary(bindingResults: BindingResults): string {
  const results = Object.values(bindingResults);
  const okCount = results.filter((result) => result.status === "ok").length;
  const emptyCount = results.filter((result) => result.status === "empty").length;
  const errorCount = results.filter((result) => result.status === "error").length;

  if (errorCount > 0) {
    return `Runtime check finished: ${okCount} ok, ${emptyCount} empty, ${errorCount} error.`;
  }

  if (emptyCount > 0) {
    return `Runtime check finished: ${okCount} ok, ${emptyCount} empty, no execution errors.`;
  }

  return `Runtime check finished: ${okCount} ok, no empty results, no execution errors.`;
}

export function formatPreviewCheckSummary(
  bindingResults: BindingResults,
  rendererChecks: RendererChecksByView,
): string {
  const runtimeSummary = formatRuntimeCheckSummary(bindingResults);
  const rendererSummaries = Object.values(rendererChecks).map((checks) =>
    summarizeRendererValidationChecks(checks),
  );
  const rendererErrors = rendererSummaries.filter((summary) => summary.status === "error");
  const rendererWarnings = rendererSummaries.filter((summary) => summary.status === "warning");

  if (rendererErrors.length > 0) {
    return `${runtimeSummary} Renderer check failed for ${rendererErrors.length} view${rendererErrors.length === 1 ? "" : "s"}.`;
  }

  if (rendererWarnings.length > 0) {
    return `${runtimeSummary} Renderer check reported ${rendererWarnings.length} warning${rendererWarnings.length === 1 ? "" : "s"}.`;
  }

  return `${runtimeSummary} Renderer validation passed.`;
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
