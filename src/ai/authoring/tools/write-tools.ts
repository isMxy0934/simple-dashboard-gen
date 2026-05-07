import { Type } from "typebox";
import type {
  RunCheckToolInput,
  RunCheckToolOutput,
  ViewCheckSnapshot,
  AuthoringDraftOutput,
  ApplyPatchToolInput,
  ApplyPatchToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import type { DashboardDocument } from "@/contracts";
import { validateDashboardDocument } from "@/contracts/validation";
import {
  cloneDashboardDocument,
  getLayoutItemsForView,
  reconcileDashboardDocumentContract,
} from "@/domain/dashboard/document";
import {
  collectVisibleViewIds,
  mergeRendererChecksByView,
  resolveFocusedViewIdFromPatch,
  resolveRequiredView,
} from "@/ai/authoring/tools/detail-builders";
import {
  type LastRunCheckState,
  buildValidationRuntimeCheck,
  buildViewCheckSnapshots,
  collectRunCheckFailures,
  determineDraftStage,
  executePreviewCheckForDocument,
  registerRunCheckState,
  stabilizeCandidateDocument,
} from "@/ai/authoring/tools/reliability";
import {
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import { buildPatchDetails, buildPatchFromDocument } from "@/ai/authoring/tools/patch-builder";
import { defineTool } from "@/ai/authoring/tools/definition";
import {
  assertFocusedPatchBoundary,
  assertFocusedViewAccess,
  resolveScopedViewId,
} from "@/ai/authoring/tools/focused-guards";
import type { AiSuggestionKind } from "@/ai/authoring/contracts/artifacts";
import { AuthoringToolGateError } from "@/ai/authoring/contracts/errors";
import { draftNeedsBindingBeforeCompose } from "@/ai/authoring/tools/compose-readiness";

interface ProposalMeta {
  suggestionId: string;
  kind: AiSuggestionKind;
  title: string;
  summary: string;
  patchSummary: string;
}

export interface RuntimeApprovalContext {
  approved: boolean;
  proposalId?: string | null;
  baseVersion?: number | null;
  pendingProposalId?: string | null;
  pendingProposalBaseVersion?: number | null;
  draftFingerprint?: string | null;
}

function collectDashboardRuntimeCheckViewIds(input: {
  document: DashboardDocument;
  workingDraft: WorkingDraftState;
}): string[] {
  const existingViewIds = new Set(
    input.document.dashboard_spec.views.map((view) => view.id),
  );
  const viewIds = new Set(collectVisibleViewIds(input.document));
  for (const viewId of input.workingDraft.dirtyViewIds) {
    if (existingViewIds.has(viewId)) {
      viewIds.add(viewId);
    }
  }
  return [...viewIds];
}

function collectDirtyUnplacedViewIds(input: {
  document: DashboardDocument;
  workingDraft: WorkingDraftState;
}): string[] {
  const existingViewIds = new Set(
    input.document.dashboard_spec.views.map((view) => view.id),
  );
  return [...input.workingDraft.dirtyViewIds].filter((viewId) => {
    if (!existingViewIds.has(viewId)) {
      return false;
    }
    const layout = getLayoutItemsForView(input.document, viewId);
    return !layout.desktop || !layout.mobile;
  });
}

function workingDraftDataMode(
  workingDraft: WorkingDraftState,
): "live" | "mock" | "undecided" {
  if (workingDraft.bindingMode) {
    return workingDraft.bindingMode;
  }
  if (workingDraft.queryDefs?.length || workingDraft.dirtyQueryIds.size > 0) {
    return "live";
  }
  if (workingDraft.bindings?.some((binding) => binding.mode === "mock")) {
    return "mock";
  }
  return "undecided";
}

function bindingCoversRequiredSlot(input: {
  binding: DashboardDocument["bindings"][number];
  viewId: string;
  slotId: string;
  dataMode: "live" | "mock";
}): boolean {
  if (
    input.binding.view_id !== input.viewId ||
    input.binding.slot_id !== input.slotId
  ) {
    return false;
  }
  if (input.dataMode === "live") {
    return (input.binding.mode ?? "live") === "live" && Boolean(input.binding.query_id);
  }
  return (
    input.binding.mode === "mock" &&
    ("mock_value" in input.binding || "mock_data" in input.binding)
  );
}

function collectDirtyMissingRequiredBindingSlots(input: {
  document: DashboardDocument;
  workingDraft: WorkingDraftState;
}): string[] {
  const dataMode = workingDraftDataMode(input.workingDraft);
  if (dataMode === "undecided") {
    return [];
  }
  const viewById = new Map(
    input.document.dashboard_spec.views.map((view) => [view.id, view]),
  );
  return [...input.workingDraft.dirtyViewIds].flatMap((viewId) => {
    const view = viewById.get(viewId);
    if (!view) {
      return [];
    }
    return view.renderer.slots
      .filter((slot) => slot.required !== false)
      .filter(
        (slot) =>
          !input.document.bindings.some(
            (binding) => bindingCoversRequiredSlot({
              binding,
              viewId: view.id,
              slotId: slot.id,
              dataMode,
            }),
          ),
      )
      .map((slot) => `${view.id}:${slot.id}`);
  });
}

function assertFreshRunCheckForCompose(input: {
  document: DashboardDocument;
  workingDraft: WorkingDraftState;
  getLastRunCheckState: () => LastRunCheckState | null;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  const missingRequiredBindingSlots = collectDirtyMissingRequiredBindingSlots({
    document: input.document,
    workingDraft: input.workingDraft,
  });
  if (missingRequiredBindingSlots.length > 0) {
    throw new AuthoringToolGateError({
      code: "binding_mismatch",
      userSafeSummary:
        `composePatch cannot finalize staged view slot(s) without required bindings for the current data mode: ${missingRequiredBindingSlots.join(", ")}.`,
      recoveryHint:
        "Required staged view slots are not bound for the selected mock or live data mode.",
      retryable: true,
    });
  }

  const unplacedViewIds = collectDirtyUnplacedViewIds({
    document: input.document,
    workingDraft: input.workingDraft,
  });
  if (unplacedViewIds.length > 0) {
    throw new AuthoringToolGateError({
      code: "missing_layout",
      userSafeSummary:
        `composePatch cannot finalize ${unplacedViewIds.length} staged view(s) without both desktop and mobile layout.`,
      recoveryHint:
        "Re-stage the chart with complete layout intent, then runCheck again.",
      retryable: true,
    });
  }

  const documentHash = input.buildDocumentFingerprint(input.document);
  const lastRunCheckState = input.getLastRunCheckState();
  if (
    !lastRunCheckState ||
    lastRunCheckState.fingerprint !== documentHash ||
    lastRunCheckState.signatures.length > 0
  ) {
    throw new AuthoringToolGateError({
      code: "stale_check",
      userSafeSummary:
        "composePatch requires a fresh successful runCheck for the current staged document hash.",
      recoveryHint:
        "The staged draft does not have a fresh successful runtime check for its current document hash.",
      retryable: true,
    });
  }
}

const RUN_CHECK_ALLOWED_SCOPES = ["dashboard", "view"] as const;

function runCheckScopeList(): string {
  return RUN_CHECK_ALLOWED_SCOPES.map((scope) => `"${scope}"`).join(" or ");
}

function describeRunCheckValue(value: unknown): string {
  if (value === undefined) {
    return "missing";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function assertOnlyRunCheckKeys(
  args: Record<string, unknown>,
  allowedKeys: readonly string[],
) {
  const allowed = new Set(allowedKeys);
  const unknownKeys = Object.keys(args).filter((key) => !allowed.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Invalid runCheck arguments: unsupported key(s) ${unknownKeys.join(", ")}. ` +
        `Allowed keys are ${allowedKeys.join(", ")}.`,
    );
  }
}

function validateRunCheckInput(args: unknown): RunCheckToolInput {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error(
      `Invalid runCheck arguments: expected an object with scope ${runCheckScopeList()}.`,
    );
  }

  const record = args as Record<string, unknown>;
  const scope = record.scope;
  if (scope !== "dashboard" && scope !== "view") {
    throw new Error(
      `Invalid runCheck.scope: expected ${runCheckScopeList()}; received ${describeRunCheckValue(scope)}.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(record, "reason") &&
    record.reason !== undefined &&
    typeof record.reason !== "string"
  ) {
    throw new Error(
      `Invalid runCheck.reason: expected string; received ${describeRunCheckValue(record.reason)}.`,
    );
  }

  if (scope === "dashboard") {
    assertOnlyRunCheckKeys(record, ["scope", "reason"]);
    return {
      scope,
      ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    };
  }

  assertOnlyRunCheckKeys(record, ["scope", "view_id", "reason"]);
  if (typeof record.view_id !== "string" || record.view_id.trim().length === 0) {
    throw new Error(
      "Invalid runCheck.view_id: view_id is required when scope is \"view\".",
    );
  }
  return {
    scope,
    view_id: record.view_id,
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
  };
}

export function buildRunCheckTool(input: {
  dashboard: DashboardDocument;
  workingDraft: WorkingDraftState;
  checks?: ViewCheckSnapshot[] | null;
  focusedViewId: string | null;
  dependencies: AuthoringDependencies;
  getLastRunCheckState: () => LastRunCheckState | null;
  setLastRunCheckState: (value: LastRunCheckState | null) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return defineTool({
    name: "runCheck",
    label: "Run Check",
    description:
      "Run a runtime check on the current staged candidate or on a single view. scope must be exactly \"dashboard\" or \"view\"; scope \"view\" requires view_id.",
    parameters: Type.Union([
      Type.Object(
        {
          scope: Type.Literal("dashboard", {
            description: "Check all visible and staged dashboard views.",
          }),
          reason: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          scope: Type.Literal("view", {
            description: "Check exactly one view.",
          }),
          view_id: Type.String({
            minLength: 1,
            description: "Required view id when scope is \"view\".",
          }),
          reason: Type.Optional(Type.String()),
        },
        { additionalProperties: false },
      ),
    ]),
    prepareArguments: validateRunCheckInput,
    execute: async (toolInput: RunCheckToolInput): Promise<RunCheckToolOutput> => {
      const checkedInput = validateRunCheckInput(toolInput);
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const stage = determineDraftStage(input.workingDraft);
      assertFocusedViewAccess({
        focusedViewId: input.focusedViewId,
        requestedViewId: checkedInput.scope === "view" ? checkedInput.view_id : undefined,
        action: "View check",
      });
      const visibleViewIds =
        checkedInput.scope === "view"
          ? [
              resolveRequiredView(
                document,
                resolveScopedViewId({
                  focusedViewId: input.focusedViewId,
                  requestedViewId: checkedInput.view_id,
                }),
              ).id,
            ]
          : collectDashboardRuntimeCheckViewIds({
              document,
              workingDraft: input.workingDraft,
            });
      const validation = validateDashboardDocument(document, "save");

      if (!validation.ok) {
        const runtimeCheck = buildValidationRuntimeCheck(validation.issues, document);
        const checks = buildViewCheckSnapshots({
          document,
          runtimeCheck,
          rendererChecks: {},
          visibleViewIds,
        });
        input.setLastRunCheckState(
          registerRunCheckState({
            previous: input.getLastRunCheckState(),
            fingerprint: input.buildDocumentFingerprint(document),
            failures: runtimeCheck.errors,
          }),
        );
        return {
          status: runtimeCheck.status,
          reason: runtimeCheck.reason,
          checks,
          failures: runtimeCheck.errors,
          renderer_checks: checks.map((check) => ({
            view_id: check.view_id,
            checks: check.renderer_checks ?? {},
          })),
        };
      }

      const previewCheck = await executePreviewCheckForDocument(
        document,
        input.dependencies,
        stage,
        visibleViewIds,
      );
      const failures = collectRunCheckFailures({
        document,
        runtimeCheck: previewCheck.runtimeCheck,
        rendererChecks: previewCheck.rendererChecks,
        visibleViewIds,
      });
      const rendererChecks = mergeRendererChecksByView(
        previewCheck.rendererChecks,
        input.checks,
        visibleViewIds,
      );
      const checks = buildViewCheckSnapshots({
        document,
        runtimeCheck: previewCheck.runtimeCheck,
        rendererChecks,
        visibleViewIds,
      });
      input.setLastRunCheckState(
        registerRunCheckState({
          previous: input.getLastRunCheckState(),
          fingerprint: input.buildDocumentFingerprint(document),
          failures,
        }),
      );
      return {
        status: previewCheck.runtimeCheck.status,
        reason: previewCheck.runtimeCheck.reason,
        checks,
        failures,
        renderer_checks: checks.map((check) => ({
          view_id: check.view_id,
          checks: check.renderer_checks ?? {},
        })),
      };
    },
  });
}

export function buildComposePatchTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  dependencies: AuthoringDependencies;
  workingDraft: WorkingDraftState;
  getLastRunCheckState: () => LastRunCheckState | null;
  setLatestProposalMeta: (proposal: ProposalMeta | null) => void;
  getBaseVersion?: () => number | undefined;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return defineTool({
    name: "composePatch",
    label: "Compose Patch",
    description:
      "Compose the staged candidate document into one approval-ready patch. This is available only after staging a complete query/view/binding draft; after it succeeds, stop so the UI can show the local approval card.",
    parameters: Type.Object({ reason: Type.Optional(Type.String()) }),
    execute: async (): Promise<AuthoringDraftOutput> => {
      const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const draftFingerprint = input.buildDocumentFingerprint(candidate);
      if (
        draftNeedsBindingBeforeCompose({
          dashboard: input.dashboard,
          draft: input.workingDraft,
        })
      ) {
        throw new AuthoringToolGateError({
          code: "binding_mismatch",
          userSafeSummary:
            "composePatch cannot finalize a staged view before its required bindings are staged for the current data mode.",
          recoveryHint:
            "Required renderer slots are not bound for the selected mock or live data mode.",
          retryable: true,
        });
      }
      assertFreshRunCheckForCompose({
        document: candidate,
        workingDraft: input.workingDraft,
        getLastRunCheckState: input.getLastRunCheckState,
        buildDocumentFingerprint: input.buildDocumentFingerprint,
      });

      const stage = determineDraftStage(input.workingDraft);
      const kind: AiSuggestionKind = stage === "data" ? "data" : "layout";
      const stabilization = await stabilizeCandidateDocument({
        dashboard: candidate,
        stage,
        dependencies: input.dependencies,
        validateDocument: (document) => validateDashboardDocument(document, "save"),
        cloneDocument: cloneDashboardDocument,
        reconcileDocument: (document) => reconcileDashboardDocumentContract(document),
      });

      if (stabilization.stabilization.status === "failed") {
        throw new Error(
          stabilization.stabilization.notes[0] ??
            stabilization.runtimeCheck?.reason ??
            "Compose patch is blocked until the staged contract passes reliability checks.",
        );
      }

      const patch = buildPatchFromDocument(
        input.dashboard,
        stabilization.dashboard,
        kind,
        input.workingDraft,
      );
      assertFocusedPatchBoundary({
        focusedViewId: input.focusedViewId,
        patch,
        before: {
          layout: input.dashboard.dashboard_spec.layout,
          bindings: input.dashboard.bindings,
          queries: input.dashboard.query_defs,
        },
        after: {
          layout: stabilization.dashboard.dashboard_spec.layout,
          bindings: stabilization.dashboard.bindings,
          queries: stabilization.dashboard.query_defs,
        },
      });
      if (patch.operations.length === 0) {
        throw new Error(
          "Compose patch produced no contract changes. The staged draft did not create a real diff.",
        );
      }
      if (
        stage === "view" &&
        input.dashboard.dashboard_spec.views.length === 0 &&
        !patch.operations.some((operation) =>
          operation.path.startsWith("dashboard_spec.views."),
        )
      ) {
        throw new Error(
          "The first staged patch must add at least one visible view before approval.",
        );
      }

      const baseVersion = input.getBaseVersion?.();
      const draftOutput: AuthoringDraftOutput = {
        suggestion: {
          id: `patch-${Date.now()}`,
          kind,
          title:
            input.workingDraft.bindingMode === "mock"
              ? "Dashboard Mock Placeholder Patch"
              : kind === "layout"
                ? "Dashboard Layout Patch"
                : "Dashboard Data Patch",
          summary:
            input.workingDraft.bindingMode === "mock"
              ? "Prepared a patch for the staged views with mock placeholder bindings."
              : kind === "layout"
                ? "Prepared a patch for the staged views and layout."
                : "Prepared a patch for the staged views, query definitions, and bindings.",
          details: buildPatchDetails({
            dashboard: stabilization.dashboard,
            bindingMode: input.workingDraft.bindingMode,
            runtimeCheck: stabilization.runtimeCheck,
            stabilization: stabilization.stabilization,
          }),
          patch,
          dashboard: stabilization.dashboard,
        },
        approval: {
          required: true,
          status: "pending",
          summary:
            "This patch changes the dashboard contract and requires approval before apply.",
          operation_count: patch.operations.length,
          affected_paths: patch.operations.map((operation) => operation.path),
        },
        draft_fingerprint: draftFingerprint,
        ...(typeof baseVersion === "number"
          ? { base_version: baseVersion }
          : {}),
        ...(stabilization.runtimeCheck
          ? { runtime_check: stabilization.runtimeCheck }
          : {}),
        stabilization: stabilization.stabilization,
      };

      input.setLatestProposalMeta({
        suggestionId: draftOutput.suggestion.id,
        kind: draftOutput.suggestion.kind,
        title: draftOutput.suggestion.title,
        summary: draftOutput.suggestion.summary,
        patchSummary: draftOutput.suggestion.patch.summary,
      });

      return draftOutput;
    },
  });
}

export function buildApplyPatchTool(input: {
  dashboard: DashboardDocument;
  dependencies: AuthoringDependencies;
  workingDraft: WorkingDraftState;
  resetWorkingDraft: () => void;
  getLatestProposalMeta: () => ProposalMeta | null;
  findLatestDraftOutput?: () => AuthoringDraftOutput | null;
  findDraftOutputBySuggestionId?: (suggestionId: string) => AuthoringDraftOutput | null;
  getRuntimeApprovalContext?: () => RuntimeApprovalContext | null | undefined;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return defineTool({
    name: "applyPatch",
    label: "Apply Patch",
    description:
      "Apply an existing staged composePatch proposal to the local dashboard draft after runtime approval has been verified.",
    parameters: Type.Object({ suggestion_id: Type.Optional(Type.String({ minLength: 1 })) }),
    execute: async ({
      suggestion_id: inputSuggestionId,
    }: ApplyPatchToolInput): Promise<ApplyPatchToolOutput> => {
      const approval = input.getRuntimeApprovalContext?.() ?? null;
      if (!approval?.approved) {
        throw new AuthoringToolGateError({
          code: "approval_required",
          userSafeSummary:
            "applyPatch requires a matching local UI approval event for the pending proposal.",
          recoveryHint:
            "Approve the current proposal from the local approval card before applying it.",
          retryable: false,
        });
      }

      const approvedProposalId = approval.proposalId?.trim() || "";
      const pendingProposalId = approval.pendingProposalId?.trim() || "";
      if (!approvedProposalId || !pendingProposalId || approvedProposalId !== pendingProposalId) {
        throw new AuthoringToolGateError({
          code: "approval_proposal_mismatch",
          userSafeSummary:
            "applyPatch cannot apply because the approved proposal does not match the pending proposal.",
          recoveryHint:
            "Refresh the proposal and approve the currently pending patch again.",
          retryable: false,
        });
      }
      if (inputSuggestionId && inputSuggestionId !== approvedProposalId) {
        throw new AuthoringToolGateError({
          code: "approval_proposal_mismatch",
          userSafeSummary:
            "applyPatch cannot apply a proposal id different from the approved proposal.",
          recoveryHint:
            "Use the proposal id from the local approval event.",
          retryable: false,
        });
      }
      if (
        typeof approval.baseVersion !== "number" ||
        typeof approval.pendingProposalBaseVersion !== "number" ||
        approval.baseVersion !== approval.pendingProposalBaseVersion
      ) {
        throw new AuthoringToolGateError({
          code: "approval_base_version_mismatch",
          userSafeSummary:
            "applyPatch cannot apply because the approved dashboard version is stale.",
          recoveryHint:
            "Refresh the dashboard, compose a new proposal, and approve that proposal.",
          retryable: false,
        });
      }
      if (!approval.draftFingerprint?.trim()) {
        throw new AuthoringToolGateError({
          code: "approval_draft_fingerprint_missing",
          userSafeSummary:
            "applyPatch cannot apply because the approved proposal fingerprint is missing.",
          recoveryHint:
            "Compose a fresh proposal and approve it before applying.",
          retryable: false,
        });
      }

      const hasWorkingDraftChanges =
        Boolean(input.workingDraft.dashboardSpec) ||
        Boolean(input.workingDraft.queryDefs) ||
        Boolean(input.workingDraft.bindings) ||
        input.workingDraft.dirtyViewIds.size > 0 ||
        input.workingDraft.dirtyQueryIds.size > 0 ||
        input.workingDraft.dirtyBindingIds.size > 0 ||
        input.workingDraft.layoutTouched;
      if (!hasWorkingDraftChanges) {
        throw new Error(
          "No staged working draft is available to apply. Stage changes and compose a patch first.",
        );
      }
      if (
        draftNeedsBindingBeforeCompose({
          dashboard: input.dashboard,
          draft: input.workingDraft,
        })
      ) {
        throw new AuthoringToolGateError({
          code: "binding_mismatch",
          userSafeSummary:
            "applyPatch cannot apply a staged view before its required bindings are staged for the current data mode.",
          recoveryHint:
            "Required view slots are not bound for the selected mock or live data mode.",
          retryable: true,
        });
      }

      const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const currentDraftFingerprint = input.buildDocumentFingerprint(candidate);
      if (currentDraftFingerprint !== approval.draftFingerprint) {
        throw new AuthoringToolGateError({
          code: "approval_draft_fingerprint_mismatch",
          userSafeSummary:
            "applyPatch cannot apply because the staged draft changed after the proposal was approved.",
          recoveryHint:
            "Compose a fresh proposal for the current staged draft and approve it again.",
          retryable: false,
        });
      }
      const candidatePatch = buildPatchFromDocument(
        input.dashboard,
        candidate,
        determineDraftStage(input.workingDraft) === "data" ? "data" : "layout",
        input.workingDraft,
      );
      if (candidatePatch.operations.length === 0) {
        throw new Error(
          "applyPatch cannot apply an empty proposal. Compose a non-empty patch first.",
        );
      }

      const stage = determineDraftStage(input.workingDraft);
      const reliability = await stabilizeCandidateDocument({
        dashboard: candidate,
        stage,
        dependencies: input.dependencies,
        validateDocument: (document) => validateDashboardDocument(document, "save"),
        cloneDocument: cloneDashboardDocument,
        reconcileDocument: (document) => reconcileDashboardDocumentContract(document),
      });
      if (reliability.stabilization.status === "failed") {
        throw new Error(
          reliability.stabilization.notes[0] ??
            reliability.runtimeCheck?.reason ??
            "Apply patch is blocked until the staged contract passes reliability checks.",
        );
      }

      const proposalMeta =
        (() => {
          const latest = input.getLatestProposalMeta();
          return latest?.suggestionId === approvedProposalId ? latest : null;
        })() ??
        (input.findDraftOutputBySuggestionId
          ? (() => {
              const output = input.findDraftOutputBySuggestionId?.(approvedProposalId);
              return output
                ? {
                    suggestionId: output.suggestion.id,
                    kind: output.suggestion.kind,
                    title: output.suggestion.title,
                    summary: output.suggestion.summary,
                    patchSummary: output.suggestion.patch.summary,
                  }
                : null;
            })()
          : null);

      const resolvedSuggestionId = proposalMeta?.suggestionId ?? approvedProposalId;
      if (!resolvedSuggestionId) {
        throw new Error(
          "applyPatch requires an existing patch proposal id.",
        );
      }

      input.resetWorkingDraft();

      return {
        applied: true,
        suggestion_id: resolvedSuggestionId,
        kind: proposalMeta?.kind ?? "layout",
        title: proposalMeta?.title ?? "Dashboard update",
        summary: proposalMeta?.summary ?? "Applied staged patch.",
        patch_summary: proposalMeta?.patchSummary ?? candidatePatch.summary,
        focused_view_id: resolveFocusedViewIdFromPatch({
          patch: candidatePatch,
          currentDashboard: input.dashboard,
          nextDashboard: candidate,
        }),
        dashboard: cloneDashboardDocument(candidate),
      };
    },
  });
}
