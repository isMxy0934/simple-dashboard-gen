import { tool } from "ai";
import { z } from "zod";
import type {
  BindingDetail,
  DeleteQueryToolInput,
  DeleteQueryToolOutput,
  DeleteViewToolInput,
  DeleteViewToolOutput,
  RunCheckToolInput,
  RunCheckToolOutput,
  UpsertBindingToolInput,
  UpsertBindingToolOutput,
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
import type { AuthoringDependencies } from "@/ai/authoring/engine/dependencies";
import type { AuthoringMessage } from "@/ai/authoring/contracts/tool-io";
import type { DashboardDocument, DashboardView } from "@/contracts";
import { validateDashboardDocument, type ValidationIssue } from "@/contracts/validation";
import { createMockBindingForView } from "@/domain/dashboard/bindings";
import {
  cloneDashboardDocument,
  reconcileDashboardDocumentContract,
  removeBindingFromDocument,
  removeQueryFromDocument,
  removeViewFromDocument,
  upsertBindingInDocument,
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
  type DraftPhase,
  type LastRunCheckState,
  buildValidationRuntimeCheck,
  buildViewCheckSnapshots,
  collectRunCheckFailures,
  determineDraftPhase,
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
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import { buildPatchDetails, buildPatchFromDocument } from "@/ai/authoring/tools/patch-builder";
import {
  upsertViewInputSchema,
  upsertQueryInputSchema,
  upsertBindingInputSchema,
} from "@/ai/authoring/tools/schemas";
import {
  UPSERT_BINDING_TOOL_CONTRACT,
  UPSERT_QUERY_TOOL_CONTRACT,
  UPSERT_VIEW_TOOL_CONTRACT,
} from "@/ai/authoring/tool-contracts";
import { assertFocusedViewAccess, assertNoFocusedLayoutMutation, resolveScopedViewId } from "@/ai/authoring/tools/focused-guards";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
  hasGrantedApplyPatchApproval,
} from "@/ai/authoring/messages/inspection";
import type { MutationDescriptor } from "@/ai/authoring/messages/invalidate-on-mutation";
import type { AiSuggestionKind } from "@/ai/authoring/contracts/artifacts";
import type { AuthoringSkillReferenceCheck } from "@/ai/authoring/skill-checks";
import {
  AuthoringToolGateError,
  type AuthoringToolGateErrorCode,
} from "@/ai/authoring/tool-gate-error";
import {
  isDataFormatSkillCheck,
  isEChartsSkillCheck,
  resolveSkillCheck,
  validateBindingAgainstSkillCheck,
  validateQueryAgainstSkillCheck,
  validateViewAgainstSkillCheck,
} from "@/ai/authoring/skill-checks";

interface ProposalMeta {
  suggestionId: string;
  kind: AiSuggestionKind;
  title: string;
  summary: string;
  patchSummary: string;
}

function skillCheckKeys(checks: AuthoringSkillReferenceCheck[], kind: AuthoringSkillReferenceCheck["kind"]) {
  return checks
    .filter((check) => check.kind === kind)
    .map((check) => check.reference_key)
    .join(", ");
}

function resolveRequiredEChartsSkillCheck(input: {
  checks: AuthoringSkillReferenceCheck[];
  requestedKey?: string | null;
}) {
  const check = resolveSkillCheck({
    checks: input.checks,
    kind: "echarts-view",
    requestedKey: input.requestedKey,
  });
  if (check && isEChartsSkillCheck(check)) {
    return check;
  }
  const available = skillCheckKeys(input.checks, "echarts-view");
  const userSafeSummary = input.requestedKey
    ? `ECharts skill reference "${input.requestedKey}" is not loaded or is not supported for view creation. Load a supported ECharts skill reference before calling upsertView.`
    : `upsertView requires exactly one loaded ECharts skill reference for the chart type. Loaded ECharts references: ${available || "none"}.`;
  throw new AuthoringToolGateError({
    code: "missing_skill",
    userSafeSummary,
    recoveryHint: input.requestedKey
      ? "Call loadSkillReference for the supported ECharts chart skill, then retry upsertView with that exact skill_reference key."
      : "Load exactly one supported ECharts chart skill reference for the intended view type before calling upsertView.",
    retryable: true,
  });
}

function resolveRequiredDataFormatSkillCheck(input: {
  checks: AuthoringSkillReferenceCheck[];
  requestedKey?: string | null;
}) {
  const check = resolveSkillCheck({
    checks: input.checks,
    kind: "data-format",
    requestedKey: input.requestedKey,
  });
  if (check && isDataFormatSkillCheck(check)) {
    return check;
  }
  const available = skillCheckKeys(input.checks, "data-format");
  const userSafeSummary = input.requestedKey
    ? `Data-format skill reference "${input.requestedKey}" is not loaded or is not supported for query-backed authoring. Load a supported data-format skill reference before calling this tool.`
    : `This write requires exactly one loaded data-format skill reference. Loaded data-format references: ${available || "none"}.`;
  throw new AuthoringToolGateError({
    code: "missing_skill",
    userSafeSummary,
    recoveryHint: input.requestedKey
      ? "Call loadSkillReference for the matching data-format skill, then retry the write with that exact skill_reference key."
      : "Load exactly one data-format skill reference matching the intended query output before retrying.",
    retryable: true,
  });
}

function throwSkillCheckIssues(input: {
  label: string;
  issues: string[];
  code: AuthoringToolGateErrorCode;
  recoveryHint: string;
  retryable?: boolean;
}) {
  const { label, issues } = input;
  if (issues.length === 0) {
    return;
  }
  throw new AuthoringToolGateError({
    code: input.code,
    userSafeSummary: `${label} does not match the loaded skill check: ${issues.join(" ")}`,
    recoveryHint: input.recoveryHint,
    retryable: input.retryable ?? true,
  });
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
      const phase = determineDraftPhase(input.workingDraft);
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
          : collectVisibleViewIds(document);
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
        phase,
        visibleViewIds,
      );
      const failures = collectRunCheckFailures({
        document,
        phase,
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
  ensureRepairWindowOpen: (toolName: "upsertView") => void;
  clearViewPhaseDraft: () => void;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  getLoadedSkillReferenceChecks: () => AuthoringSkillReferenceCheck[];
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
      const isEmptyDashboardFirstPhase =
        input.dashboard.dashboard_spec.views.length === 0 &&
        determineDraftPhase(input.workingDraft) === "view";
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
      const skillCheck = resolveRequiredEChartsSkillCheck({
        checks: input.getLoadedSkillReferenceChecks(),
        requestedKey: toolInput.skill_reference,
      });
      const loadedReferenceKeys = new Set(
        input.getLoadedSkillReferenceChecks().map((check) => check.reference_key),
      );
      const missingPairedFormats = skillCheck.paired_data_formats.filter(
        (referenceKey) => !loadedReferenceKeys.has(referenceKey),
      );
      if (missingPairedFormats.length) {
        throw new AuthoringToolGateError({
          code: "missing_skill",
          userSafeSummary: `View "${nextView.title}" requires paired data-format skill reference(s): ${missingPairedFormats.join(", ")}.`,
          recoveryHint:
            "Call loadSkillReference for the paired data-format skill reference(s), then retry upsertView with the same ECharts skill_reference.",
          retryable: true,
        });
      }
      throwSkillCheckIssues({
        label: `View "${nextView.title}"`,
        issues: validateViewAgainstSkillCheck({ view: nextView, check: skillCheck }),
        code: "schema_mismatch",
        recoveryHint:
          "Regenerate view_spec so renderer kind, series type, slots, and slot paths match the loaded ECharts skill. Preserve the user goal.",
      });
      const nextCandidate = upsertViewInDocument(document, nextView, {
        desktopItem: normalizeLayoutItem(toolInput.layout?.desktop, nextViewId),
        mobileItem: normalizeLayoutItem(toolInput.layout?.mobile, nextViewId),
      });
      const mockBinding = isEmptyDashboardFirstPhase
        ? createMockBindingForView(nextView)
        : null;
      const finalCandidate = mockBinding
        ? upsertBindingInDocument(nextCandidate, mockBinding)
        : nextCandidate;

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
      if (
        JSON.stringify(document.dashboard_spec.layout) !==
        JSON.stringify(finalCandidate.dashboard_spec.layout)
      ) {
        input.workingDraft.layoutTouched = true;
      }
      if (mockBinding) {
        input.workingDraft.bindings = finalCandidate.bindings.map(cloneBinding);
        input.workingDraft.bindingMode = "mock";
        input.workingDraft.dirtyBindingIds.clear();
        input.workingDraft.dirtyBindingIds.add(mockBinding.id);
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
  ensureRepairWindowOpen: (toolName: "upsertQuery") => void;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  getLoadedSkillReferenceChecks: () => AuthoringSkillReferenceCheck[];
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
      const skillCheck = resolveRequiredDataFormatSkillCheck({
        checks: input.getLoadedSkillReferenceChecks(),
        requestedKey: toolInput.skill_reference,
      });
      if (skillCheck.view_support === "data-only") {
        throw new AuthoringToolGateError({
          code: "unsupported_view_type",
          userSafeSummary: `${skillCheck.reference_key} is data-only and cannot be used to create a visible view with the current renderer support.`,
          recoveryHint:
            "Do not create a visible view from this data-only shape. Tell the user the requested chart/table type is not currently supported, or choose a supported chart skill if it matches the goal.",
          retryable: false,
        });
      }
      throwSkillCheckIssues({
        label: `Query "${nextQuery.name}"`,
        issues: validateQueryAgainstSkillCheck({ query: nextQuery, check: skillCheck }),
        code: "schema_mismatch",
        recoveryHint:
          "Regenerate query.output so it matches the loaded data-format skill. Preserve datasource, table, metrics, and SQL intent.",
      });
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
      input.workingDraft.dirtyQueryIds.add(nextQuery.id);
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
  ensureRepairWindowOpen: (toolName: "upsertBinding") => void;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  getLoadedSkillReferenceChecks: () => AuthoringSkillReferenceCheck[];
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
      const skillCheck = resolveRequiredDataFormatSkillCheck({
        checks: input.getLoadedSkillReferenceChecks(),
        requestedKey: toolInput.skill_reference,
      });
      assertFocusedViewAccess({
        focusedViewId: input.focusedViewId,
        requestedViewId: nextBinding.view_id,
        action: "Binding updates",
      });
      const view = resolveRequiredView(document, nextBinding.view_id);

      if (
        nextBinding.mode !== "mock" &&
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
      const query = nextBinding.query_id
        ? document.query_defs.find((candidate) => candidate.id === nextBinding.query_id)
        : undefined;
      if (nextBinding.mode !== "mock" && query) {
        throwSkillCheckIssues({
          label: `Binding "${nextBinding.id}"`,
          issues: validateBindingAgainstSkillCheck({
            binding: nextBinding,
            view,
            query,
            check: skillCheck,
          }),
          code: "binding_mismatch",
          recoveryHint:
            "Regenerate binding.result_selector so query fields match the view slot semantics declared by the loaded data-format skill.",
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
  setLatestProposalMeta: (proposal: ProposalMeta | null) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
}) {
  return tool({
    description: "Compose the staged candidate document into one approval-ready patch.",
    inputSchema: z.object({
      reason: z.string().optional(),
    }),
    execute: async (): Promise<AuthoringDraftOutput> => {
      const phase = determineDraftPhase(input.workingDraft);
      const kind: AiSuggestionKind = phase === "data" ? "data" : "layout";
      const stabilization = await stabilizeCandidateDocument({
        dashboard: input.buildCandidateDocument(input.dashboard, input.workingDraft),
        phase,
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
        phase === "view" &&
        input.dashboard.dashboard_spec.views.length === 0 &&
        !patch.operations.some((operation) =>
          operation.path.startsWith("dashboard_spec.views."),
        )
      ) {
        throw new Error(
          "The first staged patch must add at least one visible view before approval.",
        );
      }

      const draftOutput: AuthoringDraftOutput = {
        suggestion: {
          id: `patch-${Date.now()}`,
          kind,
          title: kind === "layout" ? "Dashboard Layout Patch" : "Dashboard Data Patch",
          summary:
            kind === "layout"
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
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
}) {
  return tool({
    description:
      "Request approval to apply the staged composePatch proposal to the local dashboard draft.",
    inputSchema: z.object({
      suggestion_id: z.string().min(1).optional(),
    }),
    needsApproval: async (
      _toolInput: ApplyPatchToolInput,
      { messages: modelMessages }: { messages: unknown[] },
    ): Promise<boolean> => {
      return !hasGrantedApplyPatchApproval({
        messages: input.messages ?? [],
        modelMessages,
      });
    },
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

      const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const candidatePatch = buildPatchFromDocument(
        input.dashboard,
        candidate,
        determineDraftPhase(input.workingDraft) === "data" ? "data" : "layout",
        input.workingDraft,
      );
      if (candidatePatch.operations.length === 0) {
        throw new Error(
          "applyPatch cannot apply an empty proposal. Compose a non-empty patch first.",
        );
      }

      const phase = determineDraftPhase(input.workingDraft);
      const reliability = await stabilizeCandidateDocument({
        dashboard: candidate,
        phase,
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

      input.resetWorkingDraft();
      input.recordMutation({ kind: "patch-apply" });

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
          "applyPatch could not determine suggestion_id. Call composePatch before applyPatch.",
        );
      }

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
