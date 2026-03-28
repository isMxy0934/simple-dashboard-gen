import type { BindingResults } from "../../../contracts";

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
