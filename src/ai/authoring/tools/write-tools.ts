import { tool } from "ai";
import { z } from "zod";
import type {
  DeleteQueryToolInput,
  DeleteQueryToolOutput,
  DeleteViewToolInput,
  DeleteViewToolOutput,
  RunCheckToolInput,
  RunCheckToolOutput,
  UpsertBindingToolInput,
  UpsertBindingToolOutput,
  UpsertLayoutToolInput,
  UpsertLayoutToolOutput,
  UpsertQueryToolInput,
  UpsertQueryToolOutput,
  UpsertViewToolInput,
  UpsertViewToolOutput,
  ViewCheckSnapshot,
  AuthoringDraftOutput,
  ApplyPatchToolInput,
  ApplyPatchToolOutput,
} from "@/ai/authoring/contracts/tool-io";
import { buildBindingDetail } from "@/ai/authoring/contracts/tool-io";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";
import type { DashboardDocument, DashboardLayoutItem, DashboardView } from "@/contracts";
import { validateDashboardDocument } from "@/contracts/validation";
import {
  cloneDashboardDocument,
  getLayoutItemsForView,
  reconcileDashboardDocumentContract,
  removeBindingFromDocument,
  removeQueryFromDocument,
  removeViewFromDocument,
  upsertBindingInDocument,
  upsertLayoutForViewInDocument,
  upsertQueryInDocument,
  upsertViewInDocument,
} from "@/domain/dashboard/document";
import {
  buildQueryDetail,
  buildViewDetail,
  collectVisibleViewIds,
  findCheckSnapshot,
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
  normalizeLayoutItem,
  registerRunCheckState,
  stabilizeCandidateDocument,
} from "@/ai/authoring/tools/reliability";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneQuery,
  cloneRenderer,
  markWorkingDraftArtifactOwner,
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import { buildPatchDetails, buildPatchFromDocument } from "@/ai/authoring/tools/patch-builder";
import {
  upsertViewInputSchema,
  upsertQueryInputSchema,
  upsertBindingInputSchema,
  upsertLayoutInputSchema,
} from "@/ai/authoring/tools/schemas";
import {
  UPSERT_BINDING_TOOL_CONTRACT,
  UPSERT_QUERY_TOOL_CONTRACT,
  UPSERT_VIEW_TOOL_CONTRACT,
} from "@/ai/authoring/tools/tool-contracts";
import { assertFocusedViewAccess, assertNoFocusedLayoutMutation, resolveScopedViewId } from "@/ai/authoring/tools/focused-guards";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
} from "@/ai/authoring/messages/inspection";
import type { MutationDescriptor } from "@/ai/authoring/messages/invalidate-on-mutation";
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

function pruneStaleUnboundViewsFromEmptyDataDraft(input: {
  dashboard: DashboardDocument;
  workingDraft: WorkingDraftState;
}) {
  const draftSpec = input.workingDraft.dashboardSpec;
  if (
    input.dashboard.dashboard_spec.views.length > 0 ||
    !draftSpec ||
    !input.workingDraft.queryDefs ||
    draftSpec.views.length === 0
  ) {
    return;
  }

  const liveBindings = (input.workingDraft.bindings ?? []).filter(
    (binding) => (binding.mode ?? "live") === "live",
  );
  const liveViewIds = new Set(liveBindings.map((binding) => binding.view_id));
  const nextViews = draftSpec.views.filter((view) => liveViewIds.has(view.id));

  if (nextViews.length === draftSpec.views.length) {
    return;
  }

  const keptViewIds = new Set(nextViews.map((view) => view.id));
  input.workingDraft.dashboardSpec = {
    ...draftSpec,
    views: nextViews,
    layout: Object.fromEntries(
      Object.entries(draftSpec.layout).map(([breakpoint, layout]) => [
        breakpoint,
        layout
          ? {
              ...layout,
              items: layout.items.filter((item: DashboardLayoutItem) =>
                keptViewIds.has(item.view_id),
              ),
            }
          : layout,
      ]),
    ) as DashboardDocument["dashboard_spec"]["layout"],
  };

  input.workingDraft.bindings = liveBindings.length
    ? liveBindings.map(cloneBinding)
    : undefined;
  input.workingDraft.bindingMode = liveBindings.length ? "live" : undefined;

  for (const viewId of [...input.workingDraft.dirtyViewIds]) {
    if (!keptViewIds.has(viewId)) {
      input.workingDraft.dirtyViewIds.delete(viewId);
    }
  }

  const keptBindingIds = new Set(liveBindings.map((binding) => binding.id));
  for (const bindingId of [...input.workingDraft.dirtyBindingIds]) {
    if (!keptBindingIds.has(bindingId)) {
      input.workingDraft.dirtyBindingIds.delete(bindingId);
    }
  }

  input.workingDraft.layoutTouched = true;
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
        "Call upsertView with explicit desktop and mobile layout for every staged view, then runCheck again.",
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
  return tool({
    description:
      "Run a runtime check on the current staged candidate or on a single view.",
    inputSchema: z.object({
      scope: z.enum(["dashboard", "view"]),
      view_id: z.string().optional(),
      reason: z.string().optional(),
    }),
    execute: async (toolInput: RunCheckToolInput): Promise<RunCheckToolOutput> => {
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const stage = determineDraftStage(input.workingDraft);
      assertFocusedViewAccess({
        focusedViewId: input.focusedViewId,
        requestedViewId: toolInput.scope === "view" ? toolInput.view_id : undefined,
        action: "View check",
      });
      const visibleViewIds =
        toolInput.scope === "view"
          ? [
              resolveRequiredView(
                document,
                resolveScopedViewId({
                  focusedViewId: input.focusedViewId,
                  requestedViewId: toolInput.view_id,
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

export function buildUpsertViewTool(input: {
  dashboard: DashboardDocument;
  checks?: ViewCheckSnapshot[] | null;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  getActiveGoalId?: () => string | null | undefined;
  ensureRepairWindowOpen: (toolName: "upsertView") => void;
  clearViewPhaseDraft: () => void;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return tool({
    description: UPSERT_VIEW_TOOL_CONTRACT,
    inputSchema: upsertViewInputSchema,
    execute: async (toolInput: UpsertViewToolInput): Promise<UpsertViewToolOutput> => {
      input.ensureRepairWindowOpen("upsertView");
      pruneStaleUnboundViewsFromEmptyDataDraft({
        dashboard: input.dashboard,
        workingDraft: input.workingDraft,
      });
      const isEmptyDashboardFirstPhase =
        input.dashboard.dashboard_spec.views.length === 0 &&
        determineDraftStage(input.workingDraft) === "view";
      if (isEmptyDashboardFirstPhase && input.workingDraft.dashboardSpec?.views.length) {
        input.clearViewPhaseDraft();
      }
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const beforeFingerprint = input.buildDocumentFingerprint(document);
      const nextViewId =
        input.focusedViewId ||
        toolInput.view_spec.view_id?.trim() ||
        `v_ai_${document.dashboard_spec.views.length + 1}`;
      assertNoFocusedLayoutMutation({
        focusedViewId: input.focusedViewId,
        hasLayoutChange: Boolean(toolInput.layout),
      });
      const nextView: DashboardView = {
        id: nextViewId,
        title: toolInput.view_spec.title.trim(),
        description: toolInput.view_spec.description?.trim() || undefined,
        renderer: cloneRenderer(toolInput.view_spec.renderer),
      };
      const nextCandidate = upsertViewInDocument(document, nextView, {
        desktopItem: normalizeLayoutItem(toolInput.layout?.desktop, nextViewId),
        mobileItem: normalizeLayoutItem(toolInput.layout?.mobile, nextViewId),
      });
      const finalCandidate = nextCandidate;

      const afterFingerprint = input.buildDocumentFingerprint(finalCandidate);
      if (beforeFingerprint === afterFingerprint) {
        throw new AuthoringToolGateError({
          code: "no_semantic_change",
          userSafeSummary: `No semantic view change was staged for "${nextView.title}". Inspect the current view and submit a different explicit view contract.`,
          recoveryHint:
            "Inspect the current view before retrying; only retry if there is a real changed renderer, title, or layout contract to stage.",
          retryable: false,
        });
      }

      input.workingDraft.dashboardSpec = cloneDashboardDocument(finalCandidate).dashboard_spec;
      input.workingDraft.dirtyViewIds.add(nextViewId);
      const ownerGoalId = toolInput.goal_id ?? input.getActiveGoalId?.();
      markWorkingDraftArtifactOwner({
        workingDraft: input.workingDraft,
        goalId: ownerGoalId,
        artifactKind: "view",
        artifactId: nextViewId,
      });
      if (
        JSON.stringify(document.dashboard_spec.layout) !==
        JSON.stringify(finalCandidate.dashboard_spec.layout)
      ) {
        input.workingDraft.layoutTouched = true;
        markWorkingDraftArtifactOwner({
          workingDraft: input.workingDraft,
          goalId: ownerGoalId,
          artifactKind: "layout",
          artifactId: nextViewId,
        });
      }
      input.markWorkingDraftUpdated();
      input.recordMutation({ kind: "view", view_id: nextViewId });
      const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const view = resolveRequiredView(candidate, nextViewId);
      return {
        summary: `Staged view "${view.title}".`,
        view: buildViewDetail({
          document: candidate,
          view,
          latestCheck: findCheckSnapshot(input.checks, view.id),
        }),
      };
    },
  });
}

export function buildUpsertQueryTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  getActiveGoalId?: () => string | null | undefined;
  ensureRepairWindowOpen: (toolName: "upsertQuery") => void;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return tool({
    description: UPSERT_QUERY_TOOL_CONTRACT,
    inputSchema: upsertQueryInputSchema,
    execute: async (toolInput: UpsertQueryToolInput): Promise<UpsertQueryToolOutput> => {
      input.ensureRepairWindowOpen("upsertQuery");
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const beforeFingerprint = input.buildDocumentFingerprint(document);
      const nextQuery = cloneQuery(toolInput.query);
      if (input.focusedViewId) {
        const usedByOtherViews = document.bindings.some(
          (binding) =>
            binding.query_id === nextQuery.id &&
            binding.view_id !== input.focusedViewId,
        );
        if (usedByOtherViews) {
          throw new AuthoringToolGateError({
            code: "scope_violation",
            userSafeSummary: `Query "${nextQuery.id}" is not scoped to "${input.focusedViewId}".`,
            recoveryHint:
              "Use a new query id scoped to the focused view, or restrict the edit to the focused view's existing query.",
            retryable: true,
          });
        }
      }
      const nextCandidate = upsertQueryInDocument(document, nextQuery);
      const afterFingerprint = input.buildDocumentFingerprint(nextCandidate);

      if (beforeFingerprint === afterFingerprint) {
        throw new AuthoringToolGateError({
          code: "no_semantic_change",
          userSafeSummary: `No semantic query change was staged for "${nextQuery.id}". Inspect the current query and submit a different explicit query contract.`,
          recoveryHint:
            "Inspect the current query before retrying; only retry if there is a real changed SQL, output, params, or datasource contract to stage.",
          retryable: false,
        });
      }

      input.workingDraft.queryDefs = nextCandidate.query_defs;
      input.workingDraft.bindingMode = "live";
      input.workingDraft.dirtyQueryIds.add(nextQuery.id);
      markWorkingDraftArtifactOwner({
        workingDraft: input.workingDraft,
        goalId: toolInput.goal_id ?? input.getActiveGoalId?.(),
        artifactKind: "query",
        artifactId: nextQuery.id,
      });
      input.markWorkingDraftUpdated();
      input.recordMutation({
        kind: "query",
        query_id: nextQuery.id,
        affected_view_ids: nextCandidate.bindings
          .filter((binding) => binding.query_id === nextQuery.id)
          .map((binding) => binding.view_id),
      });
      const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const targetViews = candidate.bindings
        .filter((binding) => binding.query_id === nextQuery.id)
        .map((binding) => candidate.dashboard_spec.views.find((view) => view.id === binding.view_id)?.title)
        .filter((title): title is string => typeof title === "string");
      const targetLabel =
        targetViews[0] ??
        candidate.dashboard_spec.views.find((view) =>
          candidate.bindings.some(
            (binding) => binding.view_id === view.id && binding.query_id === nextQuery.id,
          ),
        )?.title;

      return {
        summary: targetLabel
          ? `Staged query "${nextQuery.name}" for view "${targetLabel}".`
          : `Staged query "${nextQuery.name}".`,
        query: buildQueryDetail(
          candidate,
          candidate.query_defs.find((query) => query.id === nextQuery.id) ?? nextQuery,
        ),
      };
    },
  });
}

export function buildUpsertBindingTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  getActiveGoalId?: () => string | null | undefined;
  ensureRepairWindowOpen: (toolName: "upsertBinding") => void;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return tool({
    description: UPSERT_BINDING_TOOL_CONTRACT,
    inputSchema: upsertBindingInputSchema,
    execute: async (toolInput: UpsertBindingToolInput): Promise<UpsertBindingToolOutput> => {
      input.ensureRepairWindowOpen("upsertBinding");
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const beforeFingerprint = input.buildDocumentFingerprint(document);
      const nextBinding = cloneBinding(toolInput.binding);
      const isMockBinding = nextBinding.mode === "mock";
      assertFocusedViewAccess({
        focusedViewId: input.focusedViewId,
        requestedViewId: nextBinding.view_id,
        action: "Binding updates",
      });
      const view = resolveRequiredView(document, nextBinding.view_id);

      if (
        isMockBinding &&
        !("mock_value" in nextBinding) &&
        !("mock_data" in nextBinding)
      ) {
        throw new AuthoringToolGateError({
          code: "binding_mismatch",
          userSafeSummary: `Mock binding "${nextBinding.id}" must include mock_value or mock_data before it can be staged.`,
          recoveryHint:
            "Retry upsertBinding with mode: \"mock\" and explicit mock_value or mock_data for the target slot.",
          retryable: true,
        });
      }

      if (
        !isMockBinding &&
        (!nextBinding.query_id ||
          !document.query_defs.some((query) => query.id === nextBinding.query_id))
      ) {
        throw new AuthoringToolGateError({
          code: "binding_mismatch",
          userSafeSummary: `Live binding "${nextBinding.id}" must reference an existing query before it can be staged.`,
          recoveryHint:
            "Create or inspect the intended query first, then retry upsertBinding with an existing query_id and matching result_selector.",
          retryable: true,
        });
      }
      let nextCandidate = document;
      const removedBindingIds: string[] = [];
      for (const existingBinding of nextCandidate.bindings.filter(
        (binding) =>
          binding.view_id === nextBinding.view_id &&
          binding.slot_id === nextBinding.slot_id &&
          binding.id !== nextBinding.id,
      )) {
        removedBindingIds.push(existingBinding.id);
        nextCandidate = removeBindingFromDocument(nextCandidate, existingBinding.id);
      }
      nextCandidate = upsertBindingInDocument(nextCandidate, nextBinding);
      const afterFingerprint = input.buildDocumentFingerprint(nextCandidate);

      if (beforeFingerprint === afterFingerprint) {
        throw new AuthoringToolGateError({
          code: "no_semantic_change",
          userSafeSummary: `No semantic binding change was staged for "${nextBinding.id}". Inspect the current binding and submit a different explicit binding contract.`,
          recoveryHint:
            "Inspect the current binding before retrying; only retry if slot_id, query_id, selector, mode, or params actually change.",
          retryable: false,
        });
      }

      input.workingDraft.bindings = nextCandidate.bindings;
      input.workingDraft.bindingMode = nextBinding.mode ?? "live";
      input.workingDraft.dirtyBindingIds.add(nextBinding.id);
      removedBindingIds.forEach((bindingId) => input.workingDraft.dirtyBindingIds.add(bindingId));
      markWorkingDraftArtifactOwner({
        workingDraft: input.workingDraft,
        goalId: toolInput.goal_id ?? input.getActiveGoalId?.(),
        artifactKind: "binding",
        artifactId: nextBinding.id,
      });
      input.markWorkingDraftUpdated();
      input.recordMutation({
        kind: "binding",
        binding_id: nextBinding.id,
        view_id: nextBinding.view_id,
      });

      const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const bindings = candidate.bindings
        .filter(
          (binding) =>
            binding.view_id === view.id &&
            binding.slot_id === nextBinding.slot_id,
        )
        .map((binding) =>
          buildBindingDetail({
            binding,
            view,
            query: candidate.query_defs.find(
              (query) => query.id === binding.query_id,
            ),
          }),
        );

      return {
        summary: `Staged ${(nextBinding.mode ?? "live")} binding${bindings.length === 1 ? "" : "s"} for "${view.title}".`,
        bindings,
      };
    },
  });
}

export function buildUpsertLayoutTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  getActiveGoalId?: () => string | null | undefined;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return tool({
    description:
      "Stage explicit desktop and mobile layout for one existing view. This only changes layout in the working draft; it does not modify the view renderer, title, query, or bindings.",
    inputSchema: upsertLayoutInputSchema,
    execute: async (toolInput: UpsertLayoutToolInput): Promise<UpsertLayoutToolOutput> => {
      assertFocusedViewAccess({
        focusedViewId: input.focusedViewId,
        requestedViewId: toolInput.view_id,
        action: "Layout updates",
      });
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const beforeFingerprint = input.buildDocumentFingerprint(document);
      const view = resolveRequiredView(document, toolInput.view_id);
      const desktopItem = normalizeLayoutItem(toolInput.layout.desktop, view.id);
      const mobileItem = normalizeLayoutItem(toolInput.layout.mobile, view.id);
      if (!desktopItem || !mobileItem) {
        throw new Error("upsertLayout requires both desktop and mobile layout items.");
      }
      const nextCandidate = upsertLayoutForViewInDocument(document, view.id, {
        desktopItem,
        mobileItem,
      });
      const afterFingerprint = input.buildDocumentFingerprint(nextCandidate);

      if (beforeFingerprint === afterFingerprint) {
        throw new AuthoringToolGateError({
          code: "no_semantic_change",
          userSafeSummary: `No layout change was staged for "${view.title}". Inspect the current layout and submit different desktop/mobile items.`,
          recoveryHint:
            "Retry upsertLayout only if desktop or mobile x/y/w/h changes for the target view.",
          retryable: false,
        });
      }

      input.workingDraft.dashboardSpec = cloneDashboardSpec(nextCandidate.dashboard_spec);
      input.workingDraft.dirtyViewIds.add(view.id);
      input.workingDraft.layoutTouched = true;
      markWorkingDraftArtifactOwner({
        workingDraft: input.workingDraft,
        goalId: toolInput.goal_id ?? input.getActiveGoalId?.(),
        artifactKind: "layout",
        artifactId: view.id,
      });
      input.markWorkingDraftUpdated();
      input.recordMutation({ kind: "layout", view_id: view.id });

      const layout = getLayoutItemsForView(
        input.buildCandidateDocument(input.dashboard, input.workingDraft),
        view.id,
      );

      return {
        summary: `Staged layout for "${view.title}".`,
        view_id: view.id,
        layout: {
          desktop: layout.desktop ?? desktopItem,
          mobile: layout.mobile ?? mobileItem,
        },
      };
    },
  });
}

export function buildDeleteViewTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return tool({
    description:
      "Remove one view and its layout entries from the staged dashboard draft.",
    inputSchema: z.object({
      reason: z.string().optional(),
      view_id: z.string().min(1),
    }),
    execute: async ({ view_id }: DeleteViewToolInput): Promise<DeleteViewToolOutput> => {
      assertFocusedViewAccess({
        focusedViewId: input.focusedViewId,
        requestedViewId: view_id,
        action: "View deletion",
      });
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const view = resolveRequiredView(document, view_id);
      const removedBindingIds = document.bindings
        .filter((binding) => binding.view_id === view.id)
        .map((binding) => binding.id);
      const nextCandidate = removeViewFromDocument(document, view.id);

      if (input.buildDocumentFingerprint(document) === input.buildDocumentFingerprint(nextCandidate)) {
        throw new Error(`No view removal was staged for "${view.title}".`);
      }

      input.workingDraft.dashboardSpec = cloneDashboardSpec(nextCandidate.dashboard_spec);
      input.workingDraft.bindings = nextCandidate.bindings.map(cloneBinding);
      input.workingDraft.dirtyViewIds.add(view.id);
      removedBindingIds.forEach((bindingId) => input.workingDraft.dirtyBindingIds.add(bindingId));
      input.workingDraft.layoutTouched = true;
      input.markWorkingDraftUpdated();
      input.recordMutation({ kind: "view-delete", view_id: view.id });

      return {
        summary: `Removed view "${view.title}" from the staged dashboard draft.`,
        view_id: view.id,
        removed_binding_ids: removedBindingIds,
      };
    },
  });
}

export function buildDeleteQueryTool(input: {
  dashboard: DashboardDocument;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
}) {
  return tool({
    description:
      "Remove one query and any live bindings that still reference it from the staged draft.",
    inputSchema: z.object({
      reason: z.string().optional(),
      query_id: z.string().min(1),
    }),
    execute: async ({ query_id }: DeleteQueryToolInput): Promise<DeleteQueryToolOutput> => {
      const document = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const query = document.query_defs.find((candidate) => candidate.id === query_id);
      if (!query) {
        throw new Error(`Query "${query_id}" was not found.`);
      }
      if (
        input.focusedViewId &&
        document.bindings.some(
          (binding) =>
            binding.query_id === query.id &&
            binding.view_id !== input.focusedViewId,
        )
      ) {
        throw new Error(`Query "${query.id}" is not scoped to "${input.focusedViewId}".`);
      }

      const removedBindingIds = document.bindings
        .filter((binding) => binding.query_id === query.id)
        .map((binding) => binding.id);
      const nextCandidate = removeQueryFromDocument(document, query.id);

      if (input.buildDocumentFingerprint(document) === input.buildDocumentFingerprint(nextCandidate)) {
        throw new Error(`No query removal was staged for "${query.name}".`);
      }

      input.workingDraft.queryDefs = nextCandidate.query_defs.map(cloneQuery);
      input.workingDraft.bindings = nextCandidate.bindings.map(cloneBinding);
      input.workingDraft.dirtyQueryIds.add(query.id);
      removedBindingIds.forEach((bindingId) => input.workingDraft.dirtyBindingIds.add(bindingId));
      input.markWorkingDraftUpdated();
      input.recordMutation({
        kind: "query-delete",
        query_id: query.id,
        affected_view_ids: document.bindings
          .filter((binding) => binding.query_id === query.id)
          .map((binding) => binding.view_id),
      });

      return {
        summary: `Removed query "${query.name}" from the staged dashboard draft.`,
        query_id: query.id,
        removed_binding_ids: removedBindingIds,
      };
    },
  });
}

export function buildComposePatchTool(input: {
  dashboard: DashboardDocument;
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
  return tool({
    description:
      "Compose the staged candidate document into one approval-ready patch. This is available only after staging a complete query/view/binding draft; after it succeeds, stop so the UI can show the local approval card.",
    inputSchema: z.object({
      reason: z.string().optional(),
    }),
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

      if (stabilization.repair.status === "failed") {
        throw new Error(
          stabilization.repair.notes[0] ??
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
            repair: stabilization.repair,
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
        repair: stabilization.repair,
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
  messages?: AuthoringMessage[];
  workingDraft: WorkingDraftState;
  resetWorkingDraft: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  getLatestProposalMeta: () => ProposalMeta | null;
  hasRuntimeApproval?: () => boolean;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
}) {
  return tool({
    description:
      "Apply an existing staged composePatch proposal to the local dashboard draft after runtime approval has been verified.",
    inputSchema: z.object({
      suggestion_id: z.string().min(1).optional(),
    }),
    needsApproval: async (): Promise<boolean> => !input.hasRuntimeApproval?.(),
    execute: async ({
      suggestion_id: inputSuggestionId,
    }: ApplyPatchToolInput): Promise<ApplyPatchToolOutput> => {
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
      if (reliability.repair.status === "failed") {
        throw new Error(
          reliability.repair.notes[0] ??
            reliability.runtimeCheck?.reason ??
            "Apply patch is blocked until the staged contract passes reliability checks.",
        );
      }

      const proposalMeta =
        input.getLatestProposalMeta() ??
        (inputSuggestionId && input.messages
          ? (() => {
              const output = findDraftOutputBySuggestionId(input.messages, inputSuggestionId);
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
          : (() => {
              const output = findLatestDraftOutput(input.messages ?? []);
              return output
                ? {
                    suggestionId: output.suggestion.id,
                    kind: output.suggestion.kind,
                    title: output.suggestion.title,
                    summary: output.suggestion.summary,
                    patchSummary: output.suggestion.patch.summary,
                  }
                : null;
            })());

      const resolvedSuggestionId = proposalMeta?.suggestionId ?? inputSuggestionId ?? "";
      if (!resolvedSuggestionId) {
        throw new Error(
          "applyPatch requires an existing patch proposal id.",
        );
      }

      input.resetWorkingDraft();
      input.recordMutation({ kind: "patch-apply" });

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
