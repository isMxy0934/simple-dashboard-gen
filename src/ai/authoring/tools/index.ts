import {
  readUIMessageStream,
  stepCountIs,
  tool,
  ToolLoopAgent,
  type ToolSet,
} from "ai";
import { resolveProviderModelConfig } from "@/ai/providers";
import { z } from "zod";
import type {
  Binding,
  BindingResult,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRenderer,
  JsonValue,
  PreviewRequest,
  QueryDef,
  DashboardView,
  DatasourceContext,
} from "@/contracts";
import {
  validateDashboardDocument,
  type ValidationIssue,
} from "@/contracts/validation";
import type {
  ApplyPatchToolInput,
  ApplyPatchToolOutput,
  BindingDetail,
  AuthoringCheckFailure,
  AuthoringCheckSummary,
  AuthoringDraftOutput,
  AuthoringMessage,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  DeleteBindingToolInput,
  DeleteBindingToolOutput,
  DeleteQueryToolInput,
  DeleteQueryToolOutput,
  DeleteViewToolInput,
  DeleteViewToolOutput,
  GetBindingToolInput,
  GetDatasourcesToolInput,
  GetDatasourcesToolOutput,
  GetQueryToolInput,
  GetSchemaByDatasourceToolInput,
  GetSchemaByDatasourceToolOutput,
  GetViewToolInput,
  GetViewsToolInput,
  LoadSkillReferenceToolInput,
  LoadSkillReferenceToolOutput,
  LoadSkillToolInput,
  LoadSkillToolOutput,
  QueryDetail,
  RunCheckToolInput,
  RunCheckToolOutput,
  UpsertBindingToolInput,
  UpsertBindingToolOutput,
  UpsertQueryToolInput,
  UpsertQueryToolOutput,
  UpsertViewToolInput,
  UpsertViewToolOutput,
  ViewCheckSnapshot,
  ViewDetail,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringWorkingDraftSnapshot } from "@/ai/authoring/contracts/session-state";
import type {
  AiSuggestionKind,
  ContractPatch,
  ContractPatchOperation,
} from "@/ai/authoring/contracts/artifacts";
import {
  buildBindingDetail,
  collectViewQueryIds,
} from "@/ai/authoring/contracts/tool-io";
import {
  buildCandidateDocument,
  buildDocumentFingerprint,
} from "@/ai/authoring/tools/candidate-document";
import { createMockBindingForView } from "@/domain/dashboard/bindings";
import {
  findDraftOutputBySuggestionId,
  findLatestDraftOutput,
  hasGrantedApplyPatchApprovalInModelMessages,
  hasPendingApprovalResponse,
} from "@/ai/authoring/messages/inspection";
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
import { dashboardDocumentPersistenceFingerprint } from "@/domain/dashboard/document-fingerprint";
import {
  buildViewListSummary,
} from "@/ai/authoring/context/context-summary";
import type { AuthoringDependencies } from "@/ai/authoring/engine/dependencies";
import type { RendererChecksByView } from "@/renderers/core/validation-result";
import {
  createUnknownRendererCheck,
  summarizeRendererValidationChecks,
} from "@/renderers/core/validation-result";
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
  cloneBinding,
  cloneDashboardSpec,
  cloneDatasourceSchema,
  cloneQuery,
  cloneRenderer,
  createWorkingDraftState,
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import {
  buildPatchDetails,
  buildPatchFromDocument,
} from "@/ai/authoring/tools/patch-builder";
import {
  DraftPhase,
  LastRunCheckState,
  MAX_AUTOREPAIR_ATTEMPTS,
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
  bindingSchema,
  layoutItemSchema,
  querySchema,
  rendererSchema,
} from "@/ai/authoring/tools/schemas";
import {
  buildDeleteBindingTool,
  buildGetBindingTool,
  buildGetDatasourcesTool,
  buildGetQueryTool,
  buildGetSchemaByDatasourceTool,
  buildGetViewTool,
  buildLoadSkillReferenceTool,
  buildLoadSkillTool,
} from "@/ai/authoring/tools/shared-tools";
import {
  assertFocusedViewAccess,
  assertNoFocusedLayoutMutation,
  resolveScopedViewId,
} from "@/ai/authoring/tools/focused-guards";
import type { AuthoringScope, AuthoringToolName } from "@/ai/authoring/types";
import { redactSupersededToolOutputs } from "@/ai/authoring/messages/redact";
import { invalidateMutatedReads, type MutationDescriptor } from "@/ai/authoring/messages/invalidate-on-mutation";

export function buildAuthoringTools(input: {
  scope: AuthoringScope;
  activeTools?: AuthoringToolName[];
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  messages?: AuthoringMessage[];
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: AuthoringWorkingDraftSnapshot | null;
  dependencies?: AuthoringDependencies;
}) {
  const focusedViewId = input.scope.kind === "focused" ? input.scope.viewId : null;
  const workingDraft = createWorkingDraftState(input.initialWorkingDraft);
  let datasourceListCache =
    input.datasources?.map((datasource) => ({ ...datasource })) ?? null;
  const skillCatalog = new Map(
    (input.skills ?? []).map((skill) => [skill.id, { ...skill }]),
  );
  const datasourceSchemaCache = new Map<string, DatasourceContext>();
  let lastRunCheckState: LastRunCheckState | null = null;

  const getDatasourceList = async (): Promise<DatasourceListItemSummary[]> => {
    if (datasourceListCache) {
      return datasourceListCache.map((datasource) => ({ ...datasource }));
    }

    const datasources = await input.dependencies?.listDatasources?.();
    datasourceListCache = (datasources ?? []).map((datasource) => ({
      ...datasource,
    }));
    return datasourceListCache.map((datasource) => ({ ...datasource }));
  };

  const getDatasourceSchema = async (
    datasourceId: string,
  ): Promise<DatasourceContext> => {
    const cached = datasourceSchemaCache.get(datasourceId);
    if (cached) {
      return cloneDatasourceSchema(cached);
    }

    const schema = await input.dependencies?.loadDatasourceSchema?.(datasourceId);
    if (!schema) {
      throw new Error(`Datasource schema "${datasourceId}" is unavailable.`);
    }

    datasourceSchemaCache.set(datasourceId, cloneDatasourceSchema(schema));
    return cloneDatasourceSchema(schema);
  };

  const ensureRepairWindowOpen = (toolName: "upsertView" | "upsertQuery" | "upsertBinding") => {
    if (
      lastRunCheckState &&
      lastRunCheckState.consecutive_repeat_count >= MAX_AUTOREPAIR_ATTEMPTS
    ) {
      throw new Error(
        `Repair dead-end reached after repeated ${toolName} attempts. The same reliability failures are still present, so stop retrying and explain the issue.`,
      );
    }
  };

  const clearViewPhaseDraft = () => {
    workingDraft.dashboardSpec = undefined;
    workingDraft.bindings = undefined;
    workingDraft.bindingMode = undefined;
    workingDraft.dirtyViewIds.clear();
    workingDraft.dirtyBindingIds.clear();
    workingDraft.layoutTouched = false;
  };

  const markWorkingDraftUpdated = () => {
    workingDraft.stagedAt = new Date().toISOString();
  };

  let localMessages = redactSupersededToolOutputs(input.messages ?? []);

  const recordMutation = (mutation: MutationDescriptor) => {
    localMessages = invalidateMutatedReads(localMessages, mutation);
  };

  const resetWorkingDraft = () => {
    workingDraft.dashboardSpec = undefined;
    workingDraft.queryDefs = undefined;
    workingDraft.bindings = undefined;
    workingDraft.bindingMode = undefined;
    workingDraft.dirtyViewIds.clear();
    workingDraft.dirtyQueryIds.clear();
    workingDraft.dirtyBindingIds.clear();
    workingDraft.layoutTouched = false;
    workingDraft.stagedAt = null;
  };

  const getDraftSnapshot = (): AuthoringWorkingDraftSnapshot | null => {
    if (
      !workingDraft.dashboardSpec &&
      !workingDraft.queryDefs &&
      !workingDraft.bindings &&
      !workingDraft.bindingMode &&
      workingDraft.dirtyViewIds.size === 0 &&
      workingDraft.dirtyQueryIds.size === 0 &&
      workingDraft.dirtyBindingIds.size === 0 &&
      !workingDraft.layoutTouched
    ) {
      return null;
    }

    return {
      ...(workingDraft.dashboardSpec
        ? { dashboardSpec: cloneDashboardSpec(workingDraft.dashboardSpec) }
        : {}),
      ...(workingDraft.queryDefs
        ? { queryDefs: workingDraft.queryDefs.map(cloneQuery) }
        : {}),
      ...(workingDraft.bindings
        ? { bindings: workingDraft.bindings.map(cloneBinding) }
        : {}),
      ...(workingDraft.bindingMode ? { bindingMode: workingDraft.bindingMode } : {}),
      dirtyViewIds: [...workingDraft.dirtyViewIds],
      dirtyQueryIds: [...workingDraft.dirtyQueryIds],
      dirtyBindingIds: [...workingDraft.dirtyBindingIds],
      layoutTouched: workingDraft.layoutTouched,
      stagedAt: workingDraft.stagedAt ?? new Date().toISOString(),
    };
  };

  const tools = {
    loadSkill: buildLoadSkillTool({
      skillCatalog,
      loadSkill: input.dependencies?.loadSkill,
    }),
    loadSkillReference: buildLoadSkillReferenceTool({
      skillCatalog,
      loadSkillReference: input.dependencies?.loadSkillReference,
    }),
    getViews: tool({
      description:
        "Get the dashboard view list with binding/query/check summary for each view.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async (_toolInput: GetViewsToolInput) =>
        buildViewListSummary({
          document: buildCandidateDocument(input.dashboard, workingDraft),
          dashboardId: input.dashboardId,
          checks: input.checks,
        }),
    }),
    getDatasources: buildGetDatasourcesTool({
      getDatasourceList,
    }),
    getView: buildGetViewTool({
      dashboard: input.dashboard,
      dashboardId: input.dashboardId,
      checks: input.checks,
      workingDraft,
      buildCandidateDocument,
      buildViewSummary: ({ document, dashboardId, checks }) =>
        buildViewListSummary({ document, dashboardId, checks }),
      buildViewDetail,
      findCheckSnapshot,
      onBeforeResolve: (requestedViewId, requestedTitle) =>
        assertFocusedViewAccess({
          focusedViewId,
          requestedViewId,
          action: requestedTitle ? "View title lookup" : "View access",
        }),
    }),
    getQuery: buildGetQueryTool({
      dashboard: input.dashboard,
      workingDraft,
      buildCandidateDocument,
      buildQueryDetail,
      onAfterResolve: (query, document) => {
        if (!focusedViewId) {
          return;
        }

        const usedByOtherViews = document.bindings.some(
          (binding) =>
            binding.query_id === query.id &&
            binding.view_id !== focusedViewId,
        );
        if (usedByOtherViews) {
          throw new Error(`Query "${query.id}" is not scoped to "${focusedViewId}".`);
        }
      },
    }),
    getBinding: buildGetBindingTool({
      dashboard: input.dashboard,
      workingDraft,
      buildCandidateDocument,
      onBeforeResolve: (viewId) =>
        assertFocusedViewAccess({
          focusedViewId,
          requestedViewId: viewId,
          action: "Binding inspection",
        }),
    }),
    getSchemaByDatasource: buildGetSchemaByDatasourceTool({
      getDatasourceSchema,
    }),
    runCheck: tool({
      description:
        "Run a runtime check on the current staged candidate or on a single view.",
      inputSchema: z.object({
        scope: z.enum(["dashboard", "view"]),
        view_id: z.string().optional(),
        reason: z.string().optional(),
      }),
      execute: async (toolInput: RunCheckToolInput): Promise<RunCheckToolOutput> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const phase = determineDraftPhase(workingDraft);
        assertFocusedViewAccess({
          focusedViewId,
          requestedViewId: toolInput.scope === "view" ? toolInput.view_id : undefined,
          action: "View check",
        });
        const visibleViewIds =
          toolInput.scope === "view"
            ? [
                resolveRequiredView(
                  document,
                  resolveScopedViewId({
                    focusedViewId,
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
          lastRunCheckState = registerRunCheckState({
            previous: lastRunCheckState,
            fingerprint: buildDocumentFingerprint(document),
            failures: runtimeCheck.errors,
          });
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
        lastRunCheckState = registerRunCheckState({
          previous: lastRunCheckState,
          fingerprint: buildDocumentFingerprint(document),
          failures,
        });
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
    }),
    upsertView: tool({
      description:
        "Stage a single view and its layout into the draft dashboard spec.",
      inputSchema: z.object({
        request: z.string().min(1),
        view_spec: z.object({
          view_id: z.string().min(1).optional(),
          title: z.string().min(1),
          description: z.string().optional(),
          renderer: rendererSchema,
        }),
        layout: z
          .object({
            desktop: layoutItemSchema.optional(),
            mobile: layoutItemSchema.optional(),
          })
          .optional(),
      }),
      execute: async (toolInput: UpsertViewToolInput): Promise<UpsertViewToolOutput> => {
        ensureRepairWindowOpen("upsertView");
        const isEmptyDashboardFirstPhase =
          input.dashboard.dashboard_spec.views.length === 0 &&
          determineDraftPhase(workingDraft) === "view";
        if (isEmptyDashboardFirstPhase && workingDraft.dashboardSpec?.views.length) {
          clearViewPhaseDraft();
        }
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const beforeFingerprint = buildDocumentFingerprint(document);
        const nextViewId =
          focusedViewId ||
          toolInput.view_spec.view_id?.trim() ||
          `v_ai_${document.dashboard_spec.views.length + 1}`;
        assertNoFocusedLayoutMutation({
          focusedViewId,
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
        const mockBinding = isEmptyDashboardFirstPhase
          ? createMockBindingForView(nextView)
          : null;
        const finalCandidate = mockBinding
          ? upsertBindingInDocument(nextCandidate, mockBinding)
          : nextCandidate;

        const afterFingerprint = buildDocumentFingerprint(finalCandidate);
        if (beforeFingerprint === afterFingerprint) {
          throw new Error(
            `No semantic view change was staged for "${nextView.title}". Inspect the current view and submit a different explicit view contract.`,
          );
        }

        workingDraft.dashboardSpec = cloneDashboardDocument(finalCandidate).dashboard_spec;
        workingDraft.dirtyViewIds.add(nextViewId);
        if (
          JSON.stringify(document.dashboard_spec.layout) !==
          JSON.stringify(finalCandidate.dashboard_spec.layout)
        ) {
          workingDraft.layoutTouched = true;
        }
        if (mockBinding) {
          workingDraft.bindings = finalCandidate.bindings.map(cloneBinding);
          workingDraft.bindingMode = "mock";
          workingDraft.dirtyBindingIds.clear();
          workingDraft.dirtyBindingIds.add(mockBinding.id);
        }
        markWorkingDraftUpdated();
        recordMutation({ kind: "view", view_id: nextViewId });
        const candidate = buildCandidateDocument(input.dashboard, workingDraft);
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
    }),
    upsertQuery: tool({
      description:
        "Stage one explicit query contract exactly as provided.",
      inputSchema: z.object({
        reason: z.string().optional(),
        query: querySchema,
      }),
      execute: async (toolInput: UpsertQueryToolInput): Promise<UpsertQueryToolOutput> => {
        ensureRepairWindowOpen("upsertQuery");
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const beforeFingerprint = buildDocumentFingerprint(document);
        const nextQuery = cloneQuery(toolInput.query);
        if (focusedViewId) {
          const usedByOtherViews = document.bindings.some(
            (binding) =>
              binding.query_id === nextQuery.id &&
              binding.view_id !== focusedViewId,
          );
          if (usedByOtherViews) {
            throw new Error(`Query "${nextQuery.id}" is not scoped to "${focusedViewId}".`);
          }
        }
        const nextCandidate = upsertQueryInDocument(document, nextQuery);
        const afterFingerprint = buildDocumentFingerprint(nextCandidate);

        if (beforeFingerprint === afterFingerprint) {
          throw new Error(
            `No semantic query change was staged for "${nextQuery.id}". Inspect the current query and submit a different explicit query contract.`,
          );
        }

        workingDraft.queryDefs = nextCandidate.query_defs;
        workingDraft.dirtyQueryIds.add(nextQuery.id);
        markWorkingDraftUpdated();
        recordMutation({
          kind: "query",
          query_id: nextQuery.id,
          affected_view_ids: nextCandidate.bindings
            .filter((binding) => binding.query_id === nextQuery.id)
            .map((binding) => binding.view_id),
        });
        const candidate = buildCandidateDocument(input.dashboard, workingDraft);
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
    }),
    upsertBinding: tool({
      description:
        "Stage one explicit binding contract exactly as provided.",
      inputSchema: z.object({
        reason: z.string().optional(),
        binding: bindingSchema,
      }),
      execute: async (toolInput: UpsertBindingToolInput): Promise<UpsertBindingToolOutput> => {
        ensureRepairWindowOpen("upsertBinding");
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const beforeFingerprint = buildDocumentFingerprint(document);
        const nextBinding = cloneBinding(toolInput.binding);
        assertFocusedViewAccess({
          focusedViewId,
          requestedViewId: nextBinding.view_id,
          action: "Binding updates",
        });
        const view = resolveRequiredView(document, nextBinding.view_id);

        if (
          nextBinding.mode !== "mock" &&
          (!nextBinding.query_id ||
            !document.query_defs.some((query) => query.id === nextBinding.query_id))
        ) {
          throw new Error(
            `Live binding "${nextBinding.id}" must reference an existing query before it can be staged.`,
          );
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
        const afterFingerprint = buildDocumentFingerprint(nextCandidate);

        if (beforeFingerprint === afterFingerprint) {
          throw new Error(
            `No semantic binding change was staged for "${nextBinding.id}". Inspect the current binding and submit a different explicit binding contract.`,
          );
        }

        workingDraft.bindings = nextCandidate.bindings;
        workingDraft.bindingMode = nextBinding.mode ?? "live";
        workingDraft.dirtyBindingIds.add(nextBinding.id);
        removedBindingIds.forEach((bindingId) => workingDraft.dirtyBindingIds.add(bindingId));
        markWorkingDraftUpdated();
        recordMutation({
          kind: "binding",
          binding_id: nextBinding.id,
          view_id: nextBinding.view_id,
        });

        const candidate = buildCandidateDocument(input.dashboard, workingDraft);
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
    }),
    deleteView: tool({
      description:
        "Remove one view and its layout entries from the staged dashboard draft.",
      inputSchema: z.object({
        reason: z.string().optional(),
        view_id: z.string().min(1),
      }),
      execute: async ({ view_id }: DeleteViewToolInput): Promise<DeleteViewToolOutput> => {
        assertFocusedViewAccess({
          focusedViewId,
          requestedViewId: view_id,
          action: "View deletion",
        });
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const view = resolveRequiredView(document, view_id);
        const removedBindingIds = document.bindings
          .filter((binding) => binding.view_id === view.id)
          .map((binding) => binding.id);
        const nextCandidate = removeViewFromDocument(document, view.id);

        if (buildDocumentFingerprint(document) === buildDocumentFingerprint(nextCandidate)) {
          throw new Error(`No view removal was staged for "${view.title}".`);
        }

        workingDraft.dashboardSpec = cloneDashboardSpec(nextCandidate.dashboard_spec);
        workingDraft.bindings = nextCandidate.bindings.map(cloneBinding);
        workingDraft.dirtyViewIds.add(view.id);
        removedBindingIds.forEach((bindingId) => workingDraft.dirtyBindingIds.add(bindingId));
        workingDraft.layoutTouched = true;
        markWorkingDraftUpdated();
        recordMutation({ kind: "view-delete", view_id: view.id });

        return {
          summary: `Removed view "${view.title}" from the staged dashboard draft.`,
          view_id: view.id,
          removed_binding_ids: removedBindingIds,
        };
      },
    }),
    deleteQuery: tool({
      description:
        "Remove one query and any live bindings that still reference it from the staged draft.",
      inputSchema: z.object({
        reason: z.string().optional(),
        query_id: z.string().min(1),
      }),
      execute: async ({ query_id }: DeleteQueryToolInput): Promise<DeleteQueryToolOutput> => {
        const document = buildCandidateDocument(input.dashboard, workingDraft);
        const query = document.query_defs.find((candidate) => candidate.id === query_id);
        if (!query) {
          throw new Error(`Query "${query_id}" was not found.`);
        }
        if (
          focusedViewId &&
          document.bindings.some(
            (binding) =>
              binding.query_id === query.id &&
              binding.view_id !== focusedViewId,
          )
        ) {
          throw new Error(`Query "${query.id}" is not scoped to "${focusedViewId}".`);
        }

        const removedBindingIds = document.bindings
          .filter((binding) => binding.query_id === query.id)
          .map((binding) => binding.id);
        const nextCandidate = removeQueryFromDocument(document, query.id);

        if (buildDocumentFingerprint(document) === buildDocumentFingerprint(nextCandidate)) {
          throw new Error(`No query removal was staged for "${query.name}".`);
        }

        workingDraft.queryDefs = nextCandidate.query_defs.map(cloneQuery);
        workingDraft.bindings = nextCandidate.bindings.map(cloneBinding);
        workingDraft.dirtyQueryIds.add(query.id);
        removedBindingIds.forEach((bindingId) => workingDraft.dirtyBindingIds.add(bindingId));
        markWorkingDraftUpdated();
        recordMutation({
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
    }),
    deleteBinding: buildDeleteBindingTool({
      dashboard: input.dashboard,
      workingDraft,
      buildCandidateDocument,
      buildDocumentFingerprint,
      cloneBinding,
      removeBindingFromDocument,
      markWorkingDraftUpdated,
      onBeforeDelete: (binding) =>
        assertFocusedViewAccess({
          focusedViewId,
          requestedViewId: binding.view_id,
          action: "Binding deletion",
        }),
      onAfterDelete: (binding) =>
        recordMutation({
          kind: "binding-delete",
          binding_id: binding.id,
          view_id: binding.view_id,
        }),
    }),
    composePatch: tool({
      description:
        "Compose the staged candidate document into one approval-ready patch.",
      inputSchema: z.object({
        reason: z.string().optional(),
      }),
      execute: async (): Promise<AuthoringDraftOutput> => {
        const phase = determineDraftPhase(workingDraft);
        const includesDataDraft = phase === "data";
        const kind = includesDataDraft ? "data" : "layout";
        const stabilization = await stabilizeCandidateDocument({
          dashboard: buildCandidateDocument(input.dashboard, workingDraft),
          phase,
          dependencies: input.dependencies,
          validateDocument: (document) => validateDashboardDocument(document, "save"),
          cloneDocument: cloneDashboardDocument,
          reconcileDocument: (document) =>
            reconcileDashboardDocumentContract(document),
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
          workingDraft,
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

        return {
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
              bindingMode: workingDraft.bindingMode,
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
      },
    }),
    applyPatch: tool({
      description:
        "Request approval to apply the staged composePatch proposal to the local dashboard draft.",
      inputSchema: z.object({
        suggestion_id: z.string().min(1).optional(),
      }),
      needsApproval: async (
        _toolInput: ApplyPatchToolInput,
        { messages: modelMessages }: { messages: unknown[] },
      ): Promise<boolean> => {
        // Single logical gate: UI state (authoritative for this app) + model messages
        // (approvalId-linked; SDK does not put toolName on tool-approval-response).
        if (hasPendingApprovalResponse(input.messages ?? [])) {
          return false;
        }
        if (hasGrantedApplyPatchApprovalInModelMessages(modelMessages)) {
          return false;
        }
        return true;
      },
      execute: async ({
        suggestion_id: inputSuggestionId,
      }: ApplyPatchToolInput): Promise<ApplyPatchToolOutput> => {
        // Prefer the in-memory workingDraft when it has staged changes; this avoids
        // suggestion_id mismatches that occur when composePatch ran in a prior round.
        const hasWorkingDraftChanges =
          Boolean(workingDraft.dashboardSpec) ||
          Boolean(workingDraft.queryDefs) ||
          Boolean(workingDraft.bindings) ||
          workingDraft.dirtyViewIds.size > 0 ||
          workingDraft.dirtyQueryIds.size > 0 ||
          workingDraft.dirtyBindingIds.size > 0 ||
          workingDraft.layoutTouched;
        const workingDraftCandidate = hasWorkingDraftChanges
          ? buildCandidateDocument(input.dashboard, workingDraft)
          : null;

        const draftOutput =
          inputSuggestionId && input.messages
            ? findDraftOutputBySuggestionId(input.messages, inputSuggestionId)
            : findLatestDraftOutput(input.messages ?? []);

        // Use workingDraft as the primary source; fall back to the persisted proposal.
        const candidate = workingDraftCandidate ?? draftOutput?.suggestion.dashboard ?? null;

        if (!candidate) {
          throw new Error(
            "No staged composePatch proposal is available to apply. Call composePatch first.",
          );
        }
        const candidatePatch =
          draftOutput?.suggestion.patch ??
          (workingDraftCandidate
            ? buildPatchFromDocument(
                input.dashboard,
                workingDraftCandidate,
                determineDraftPhase(workingDraft) === "data" ? "data" : "layout",
                workingDraft,
              )
            : null);
        if (!candidatePatch || candidatePatch.operations.length === 0) {
          throw new Error(
            "applyPatch cannot apply an empty proposal. Compose a non-empty patch first.",
          );
        }

        const phase = determineDraftPhase(workingDraft);
        const reliability = await stabilizeCandidateDocument({
          dashboard: candidate,
          phase,
          dependencies: input.dependencies,
          validateDocument: (document) => validateDashboardDocument(document, "save"),
          cloneDocument: cloneDashboardDocument,
          reconcileDocument: (document) =>
            reconcileDashboardDocumentContract(document),
        });
        if (reliability.repair.status === "failed") {
          throw new Error(
            reliability.repair.notes[0] ??
              reliability.runtimeCheck?.reason ??
              "Apply patch is blocked until the staged contract passes reliability checks.",
          );
        }

        resetWorkingDraft();

        const syntheticSuggestionId =
          workingDraftCandidate && !draftOutput
            ? `working-draft-${workingDraft.stagedAt ?? `t-${Date.now()}`}`
            : null;
        const resolvedSuggestionId =
          draftOutput?.suggestion.id ?? syntheticSuggestionId ?? "";

        if (!resolvedSuggestionId) {
          throw new Error(
            "applyPatch could not determine suggestion_id. Call composePatch before applyPatch.",
          );
        }

        return {
          applied: true,
          suggestion_id: resolvedSuggestionId,
          kind: draftOutput?.suggestion.kind ?? "layout",
          title: draftOutput?.suggestion.title ?? "Dashboard update",
          summary: draftOutput?.suggestion.summary ?? "Applied staged patch.",
          patch_summary: draftOutput?.suggestion.patch.summary ?? "",
          focused_view_id: draftOutput
            ? resolveFocusedViewIdFromPatch({
                patch: draftOutput.suggestion.patch,
                currentDashboard: input.dashboard,
                nextDashboard: candidate,
              })
            : null,
          dashboard: cloneDashboardDocument(candidate),
        };
      },
    }),
  } satisfies ToolSet;

  const focusedTask = tool({
    description:
      "Run a bounded sub-task for one existing view using a focused tool subset.",
    inputSchema: z.object({
      view_id: z.string().min(1),
      task: z.string().min(1),
      max_steps: z.number().int().min(1).max(12).optional(),
    }),
    execute: async (
      { view_id, task, max_steps }: { view_id: string; task: string; max_steps?: number },
      { abortSignal }: { abortSignal?: AbortSignal },
    ) => {
      if (input.scope.kind !== "dashboard") {
        throw new Error("focusedTask is only available in dashboard scope.");
      }

      const document = buildCandidateDocument(input.dashboard, workingDraft);
      const view = document.dashboard_spec.views.find((candidate) => candidate.id === view_id);
      if (!view) {
        throw new Error(`View "${view_id}" was not found on the staged dashboard.`);
      }

      const subTools = {
        getView: tools.getView,
        getQuery: tools.getQuery,
        getBinding: tools.getBinding,
        getSchemaByDatasource: tools.getSchemaByDatasource,
        runCheck: tools.runCheck,
        upsertView: tools.upsertView,
        upsertQuery: tools.upsertQuery,
        upsertBinding: tools.upsertBinding,
        deleteBinding: tools.deleteBinding,
      };

      const runtime = resolveProviderModelConfig();
      let stepsUsed = 0;
      let finalText = "";
      const subAgent = new ToolLoopAgent({
        id: `view-subagent-${view_id}`,
        model: runtime.model,
        instructions: [
          `You are a specialist for ONE dashboard view: "${view.title}" (id: ${view_id}).`,
          "Only modify this view and its related queries/bindings using the provided tools.",
          "Do not delete the view. Prefer getView, getQuery, and getBinding before edits.",
          "When running checks, prefer runCheck with scope \"view\" and this view id.",
          "Do not call composePatch or applyPatch — the main orchestrator handles approval.",
          "",
          `Task:\n${task}`,
        ].join("\n"),
        tools: subTools,
        providerOptions: runtime.providerOptions,
        ...(runtime.supportsTemperature ? { temperature: 0.2 } : {}),
        stopWhen: stepCountIs(Math.min(max_steps ?? 8, 12)),
        onStepFinish: async ({ stepNumber }) => {
          stepsUsed = stepNumber;
        },
        onFinish: async ({ text }) => {
          finalText = text.trim();
        },
      });

      const result = await subAgent.stream({
        prompt: `Execute the delegated task for view ${view_id}.`,
        abortSignal,
      });

      let lastMessage: unknown = null;
      for await (const message of readUIMessageStream({
        stream: result.toUIMessageStream(),
      })) {
        lastMessage = message;
      }

      const summary =
        finalText ||
        extractLastTextFromDelegateOutput(lastMessage) ||
        "Focused sub-task finished. Review staged changes, then composePatch when ready.";

      return {
        status: abortSignal?.aborted ? "aborted" : "completed",
        summary,
        changed_view_ids: [view_id],
        steps_used: stepsUsed,
      };
    },
  });

  const allTools = {
    ...tools,
    focusedTask,
  } satisfies ToolSet;

  const selectedToolNames = new Set(
    input.activeTools ?? (Object.keys(allTools) as AuthoringToolName[]),
  );
  const filteredTools = Object.fromEntries(
    Object.entries(allTools).filter(([toolName]) =>
      selectedToolNames.has(toolName as AuthoringToolName),
    ),
  ) satisfies ToolSet;

  return {
    tools: filteredTools,
    getDraftSnapshot,
    getMessagesForModel: () => localMessages,
  };
}

function extractLastTextFromDelegateOutput(output: unknown): string {
  if (!output || typeof output !== "object") {
    return "";
  }
  const parts = (output as { parts?: Array<{ type?: string; text?: string }> }).parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part?.type === "text" && part.text?.trim()) {
      return part.text.trim();
    }
  }
  return "";
}
