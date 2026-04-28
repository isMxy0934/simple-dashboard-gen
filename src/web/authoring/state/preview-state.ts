import type { BindingResults } from "../../../contracts";
import type { RendererChecksByView } from "../../../renderers/core/validation-result";
import { summarizeRendererValidationChecks } from "../../../renderers/core/validation-result";
import type { TranslateFn } from "../../i18n";

function compactReason(reason: string): string {
  return reason.trim().replace(/\s+/g, " ").slice(0, 180);
}

function firstRuntimeErrorReason(bindingResults: BindingResults): string | null {
  const firstError = Object.values(bindingResults).find(
    (result) => result.status === "error",
  );
  if (!firstError) {
    return null;
  }
  return compactReason(firstError.message ?? firstError.code ?? "");
}

function appendIssueReason(
  summary: string,
  reason: string | null,
  labelKey: string,
  t: TranslateFn,
): string {
  if (!reason) {
    return summary;
  }
  return `${summary} ${t(labelKey, { reason })}`;
}

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
    return appendIssueReason(
      t("authoring.persistence.runtimeCheckErrorSummary", {
        ok: okCount,
        empty: emptyCount,
        error: errorCount,
      }),
      firstRuntimeErrorReason(bindingResults),
      "authoring.persistence.runtimeCheckFirstIssue",
      t,
    );
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
    return appendIssueReason(
      `${runtimeSummary} ${t("authoring.persistence.rendererErrorSummary", {
        count: rendererErrors.length,
      })}`,
      compactReason(rendererErrors[0]?.reason ?? ""),
      "authoring.persistence.rendererFirstIssue",
      t,
    );
  }

  if (rendererWarnings.length > 0) {
    return appendIssueReason(
      `${runtimeSummary} ${t("authoring.persistence.rendererWarningSummary", {
        count: rendererWarnings.length,
      })}`,
      compactReason(rendererWarnings[0]?.reason ?? ""),
      "authoring.persistence.rendererFirstIssue",
      t,
    );
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
