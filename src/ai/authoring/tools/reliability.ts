import type {
  BindingResult,
  DashboardDocument,
  DashboardLayoutItem,
  JsonValue,
  PreviewRequest,
} from "@/contracts";
import type { ValidationIssue } from "@/contracts/validation";
import type {
  MainAgentCheckFailure,
  MainAgentCheckSummary,
  MainAgentDraftOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringDependencies } from "@/ai/authoring/engine/dependencies";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  createUnknownRendererCheck,
  summarizeRendererValidationChecks,
} from "@/renderers/core/validation-result";
import { collectViewQueryIds } from "@/ai/authoring/contracts/tool-io";
import { collectVisibleViewIds } from "@/ai/authoring/tools/detail-builders";

export type DraftPhase = "view" | "data";

export interface LastRunCheckState {
  fingerprint: string;
  signatures: string[];
  consecutive_repeat_count: number;
}

export const MAX_AUTOREPAIR_ATTEMPTS = 2;

export function normalizeLayoutItem(
  layoutItem: DashboardLayoutItem | undefined,
  viewId: string,
) {
  if (!layoutItem) {
    return undefined;
  }

  return {
    ...layoutItem,
    view_id: viewId,
  };
}

export function determineDraftPhase(workingDraft: {
  queryDefs?: unknown;
  bindings?: Array<{ mode?: "mock" | "live" }>;
}): DraftPhase {
  const hasLiveQueryDraft = Boolean(workingDraft.queryDefs);
  const hasLiveBindingDraft = Boolean(
    workingDraft.bindings?.some((binding) => (binding.mode ?? "live") === "live"),
  );
  return hasLiveQueryDraft || hasLiveBindingDraft ? "data" : "view";
}

export function registerRunCheckState(input: {
  previous: LastRunCheckState | null;
  fingerprint: string;
  failures: MainAgentCheckFailure[];
}): LastRunCheckState {
  const signatures = input.failures.map(buildFailureSignature).sort();
  const sameAsPrevious =
    input.previous &&
    input.previous.fingerprint === input.fingerprint &&
    JSON.stringify(input.previous.signatures) === JSON.stringify(signatures);

  return {
    fingerprint: input.fingerprint,
    signatures,
    consecutive_repeat_count: sameAsPrevious
      ? (input.previous?.consecutive_repeat_count ?? 0) + 1
      : 0,
  };
}

export async function stabilizeCandidateDocument(input: {
  dashboard: DashboardDocument;
  phase: DraftPhase;
  dependencies?: AuthoringDependencies;
  validateDocument: (
    document: DashboardDocument,
  ) => { ok: true } | { ok: false; issues: ValidationIssue[] };
  cloneDocument: (document: DashboardDocument) => DashboardDocument;
  reconcileDocument: (document: DashboardDocument) => DashboardDocument;
}): Promise<{
  dashboard: DashboardDocument;
  runtimeCheck?: MainAgentCheckSummary;
  repair: MainAgentDraftOutput["repair"];
}> {
  const document = input.reconcileDocument(input.cloneDocument(input.dashboard));
  const validation = input.validateDocument(document);
  if (!validation.ok) {
    return {
      dashboard: document,
      runtimeCheck: buildValidationRuntimeCheck(validation.issues, document),
      repair: {
        status: "failed",
        attempted: 0,
        max_attempts: MAX_AUTOREPAIR_ATTEMPTS,
        repaired: false,
        notes: ["Compose patch is blocked until the staged contract is valid."],
      },
    };
  }

  const finalPreviewCheck = await executePreviewCheckForDocument(
    document,
    input.dependencies,
    input.phase,
  );
  const failures = collectRunCheckFailures({
    document,
    phase: input.phase,
    runtimeCheck: finalPreviewCheck.runtimeCheck,
    rendererChecks: finalPreviewCheck.rendererChecks,
    visibleViewIds: collectVisibleViewIds(document),
  });

  return {
    dashboard: document,
    runtimeCheck: finalPreviewCheck.runtimeCheck,
    repair: {
      status: failures.length > 0 ? "failed" : "not-needed",
      attempted: 0,
      max_attempts: MAX_AUTOREPAIR_ATTEMPTS,
      repaired: false,
      notes:
        failures.length > 0
          ? ["Compose patch is blocked until all reliability failures are resolved."]
          : [],
    },
  };
}

export function buildValidationRuntimeCheck(
  issues: ValidationIssue[],
  document: DashboardDocument,
): MainAgentCheckSummary {
  return {
    status: "error",
    reason: `${issues.length} contract validation issue${issues.length === 1 ? "" : "s"} blocked runtime preview.`,
    counts: {
      ok: 0,
      empty: 0,
      error: issues.length,
    },
    errors: issues.map((issue) => buildValidationFailure(document, issue)),
  };
}

export async function executePreviewCheckForDocument(
  document: DashboardDocument,
  dependencies?: AuthoringDependencies,
  phase: DraftPhase = "data",
  visibleViewIds: string[] = collectVisibleViewIds(document),
): Promise<{
  runtimeCheck: MainAgentCheckSummary;
  rendererChecks: RendererChecksByView;
}> {
  if (!dependencies?.executePreview) {
    return {
      runtimeCheck: {
        status: "error",
        reason: "Runtime preview capability is unavailable.",
        counts: {
          ok: 0,
          empty: 0,
          error: 0,
        },
        errors: [],
      },
      rendererChecks: {},
    };
  }

  const request: PreviewRequest = {
    dashboard_spec: document.dashboard_spec,
    query_defs: document.query_defs,
    bindings: document.bindings,
    visible_view_ids: visibleViewIds,
    filter_values: buildPreviewFilterValues(document),
  };
  const outcome = await dependencies.executePreview(request);

  if (outcome.body.status_code !== 200 || !outcome.body.data) {
    return {
      runtimeCheck: {
        status: "error",
        reason: outcome.body.reason,
        counts: {
          ok: 0,
          empty: 0,
          error: 1,
        },
        errors: [
          {
            source: "runtime",
            code: outcome.body.reason,
            message: outcome.body.reason,
          },
        ],
      },
      rendererChecks: {},
    };
  }

  const results: BindingResult[] = Object.values(outcome.body.data.binding_results);
  const blockingErrorResults = results
    .filter((result) => result.status === "error")
    .filter((result) => !isAllowedFirstPhaseGap(result, phase));
  const counts = {
    ok: results.filter((result) => result.status === "ok").length,
    empty: results.filter((result) => result.status === "empty").length,
    error: blockingErrorResults.length,
  };
  const errors = blockingErrorResults.map((result) => ({
    source: "runtime" as const,
    view_id: result.view_id,
    query_id: result.query_id,
    binding_id: findBindingIdForResult(document, result),
    code: result.code ?? "RUNTIME_CHECK_FAILED",
    message: result.message ?? "Runtime preview failed for this binding.",
  }));

  return {
    runtimeCheck: {
      status: counts.error > 0 ? "error" : counts.empty > 0 ? "warning" : "ok",
      reason:
        counts.error > 0
          ? `${counts.error} binding checks failed.`
          : counts.empty > 0
            ? `${counts.ok} bindings passed and ${counts.empty} returned empty rows.`
            : `${counts.ok} bindings passed runtime check.`,
      counts,
      errors,
    },
    rendererChecks: outcome.body.data.renderer_checks,
  };
}

export function buildViewCheckSnapshots(input: {
  document: DashboardDocument;
  runtimeCheck: MainAgentCheckSummary;
  rendererChecks: RendererChecksByView;
  visibleViewIds: string[];
}): ViewCheckSnapshot[] {
  const visibleSet = new Set(input.visibleViewIds);

  return input.document.dashboard_spec.views
    .filter((view) => visibleSet.has(view.id))
    .map((view) => {
      const viewErrors = input.runtimeCheck.errors.filter(
        (error) => !error.view_id || error.view_id === view.id,
      );
      const hasBindings = input.document.bindings.some(
        (binding) => binding.view_id === view.id,
      );
      const rendererChecks = input.rendererChecks[view.id] ?? {};
      const rendererSummary = summarizeRendererValidationChecks(rendererChecks);
      const status = viewErrors.length || rendererSummary.status === "error"
        ? "error"
        : hasBindings && input.runtimeCheck.counts.empty > 0
          ? "empty"
          : hasBindings
            ? "ok"
            : "stale";

      return {
        view_id: view.id,
        status,
        reason:
          viewErrors[0]?.message ??
          (rendererSummary.status === "error" ? rendererSummary.reason : undefined) ??
          (status === "empty"
            ? "Preview returned empty rows."
            : status === "ok"
              ? "Runtime check passed."
              : "No active binding was checked."),
        last_checked_at: new Date().toISOString(),
        query_ids: collectViewQueryIds(view.id, input.document.bindings),
        binding_ids: input.document.bindings
          .filter((binding) => binding.view_id === view.id)
          .map((binding) => binding.id),
        runtime_summary: input.runtimeCheck,
        renderer_checks: {
          server:
            rendererChecks.server ??
            createUnknownRendererCheck("server"),
          browser:
            rendererChecks.browser ??
            createUnknownRendererCheck("browser"),
        },
      };
    });
}

export function collectRunCheckFailures(input: {
  document: DashboardDocument;
  phase: DraftPhase;
  runtimeCheck: MainAgentCheckSummary;
  rendererChecks: RendererChecksByView;
  visibleViewIds: string[];
}): MainAgentCheckFailure[] {
  const failures = [...input.runtimeCheck.errors];

  for (const viewId of input.visibleViewIds) {
    const checks = input.rendererChecks[viewId] ?? {};
    for (const check of Object.values(checks)) {
      if (check?.status === "error") {
        failures.push({
          source: "renderer",
          code: `RENDERER_${check.target.toUpperCase()}_ERROR`,
          message: check.message ?? check.reason,
          view_id: viewId,
        });
      }
    }
  }

  return failures;
}

function buildPreviewFilterValues(document: DashboardDocument): Record<string, JsonValue> {
  return Object.fromEntries(
    document.dashboard_spec.filters
      .filter((filter) => filter.default_value !== undefined)
      .map((filter) => [filter.id, filter.default_value as JsonValue]),
  );
}

function buildFailureSignature(failure: MainAgentCheckFailure) {
  return [
    failure.source,
    failure.code,
    failure.path ?? "*",
    failure.view_id ?? "*",
    failure.query_id ?? "*",
    failure.binding_id ?? "*",
  ].join(":");
}

function buildValidationFailure(
  document: DashboardDocument,
  issue: ValidationIssue,
): MainAgentCheckFailure {
  const bindingMatch = issue.path.match(/^bindings\[(\d+)\]/);
  if (bindingMatch) {
    const binding = document.bindings[Number(bindingMatch[1])];
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: binding?.view_id,
      query_id: binding?.query_id,
      binding_id: binding?.id,
    };
  }

  const queryMatch = issue.path.match(/^query_defs\[(\d+)\]/);
  if (queryMatch) {
    const query = document.query_defs[Number(queryMatch[1])];
    const binding = query
      ? document.bindings.find((candidate) => candidate.query_id === query.id)
      : undefined;
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: binding?.view_id,
      query_id: query?.id,
      binding_id: binding?.id,
    };
  }

  const viewMatch = issue.path.match(/^dashboard_spec\.views\[(\d+)\]/);
  if (viewMatch) {
    const view = document.dashboard_spec.views[Number(viewMatch[1])];
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: view?.id,
    };
  }

  const layoutMatch = issue.path.match(
    /^dashboard_spec\.layout\.(desktop|mobile)\.items\[(\d+)\]/,
  );
  if (layoutMatch) {
    const layout = document.dashboard_spec.layout[
      layoutMatch[1] as "desktop" | "mobile"
    ];
    const item = layout?.items[Number(layoutMatch[2])];
    return {
      source: "contract",
      code: "CONTRACT_VALIDATION_ERROR",
      message: issue.message,
      path: issue.path,
      view_id: item?.view_id,
    };
  }

  return {
    source: "contract",
    code: "CONTRACT_VALIDATION_ERROR",
    message: issue.message,
    path: issue.path,
  };
}

function findBindingIdForResult(
  document: DashboardDocument,
  result: BindingResult,
) {
  return document.bindings.find(
    (binding) =>
      binding.view_id === result.view_id &&
      binding.query_id === result.query_id &&
      binding.slot_id === result.slot_id,
  )?.id;
}

function isAllowedFirstPhaseGap(
  result: BindingResult,
  phase: DraftPhase,
) {
  return (
    phase === "view" &&
    result.status === "error" &&
    result.code === "BINDING_NOT_FOUND"
  );
}
