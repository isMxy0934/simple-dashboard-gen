import { tool, type ToolSet } from "ai";
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
  hasGrantedApplyPatchApproval,
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
  buildApplyPatchTool,
  buildComposePatchTool,
  buildDeleteQueryTool,
  buildDeleteViewTool,
  buildRunCheckTool,
  buildUpsertBindingTool,
  buildUpsertQueryTool,
  buildUpsertViewTool,
} from "@/ai/authoring/tools/write-tools";
import {
  assertFocusedViewAccess,
  assertNoFocusedLayoutMutation,
  resolveScopedViewId,
} from "@/ai/authoring/tools/focused-guards";
import type { AuthoringScope, AuthoringToolName } from "@/ai/authoring/types";
import { redactSupersededToolOutputs } from "@/ai/authoring/messages/redact";
import { invalidateMutatedReads, type MutationDescriptor } from "@/ai/authoring/messages/invalidate-on-mutation";
import type { AuthoringRunCheckStateSnapshot } from "@/ai/authoring/contracts/session-state";

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
  initialLastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  dependencies: AuthoringDependencies;
}) {
  const focusedViewId = input.scope.kind === "focused" ? input.scope.viewId : null;
  const workingDraft = createWorkingDraftState(input.initialWorkingDraft);
  let datasourceListCache =
    input.datasources?.map((datasource) => ({ ...datasource })) ?? null;
  const skillCatalog = new Map(
    (input.skills ?? []).map((skill) => [skill.id, { ...skill }]),
  );
  const datasourceSchemaCache = new Map<string, DatasourceContext>();
  let lastRunCheckState: LastRunCheckState | null = input.initialLastRunCheckState
    ? {
        fingerprint: input.initialLastRunCheckState.fingerprint,
        signatures: [...input.initialLastRunCheckState.signatures],
        consecutive_repeat_count:
          input.initialLastRunCheckState.consecutiveRepeatCount,
      }
    : null;
  let latestProposalMeta: {
    suggestionId: string;
    kind: AiSuggestionKind;
    title: string;
    summary: string;
    patchSummary: string;
  } | null = null;

  const getDatasourceList = async (): Promise<DatasourceListItemSummary[]> => {
    if (datasourceListCache) {
      return datasourceListCache.map((datasource) => ({ ...datasource }));
    }

    const datasources = await input.dependencies.listDatasources();
    datasourceListCache = datasources.map((datasource) => ({
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

    const schema = await input.dependencies.loadDatasourceSchema(datasourceId);

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

  const getLastRunCheckStateSnapshot = (): AuthoringRunCheckStateSnapshot | null => {
    if (!lastRunCheckState) {
      return null;
    }

    return {
      fingerprint: lastRunCheckState.fingerprint,
      signatures: [...lastRunCheckState.signatures],
      consecutiveRepeatCount: lastRunCheckState.consecutive_repeat_count,
    };
  };

  const tools = {
    loadSkill: buildLoadSkillTool({
      skillCatalog,
      loadSkill: input.dependencies.loadSkill,
    }),
    loadSkillReference: buildLoadSkillReferenceTool({
      skillCatalog,
      loadSkillReference: input.dependencies.loadSkillReference,
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
    runCheck: buildRunCheckTool({
      dashboard: input.dashboard,
      workingDraft,
      checks: input.checks,
      focusedViewId,
      dependencies: input.dependencies,
      getLastRunCheckState: () => lastRunCheckState,
      setLastRunCheckState: (value) => {
        lastRunCheckState = value;
      },
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    upsertView: buildUpsertViewTool({
      dashboard: input.dashboard,
      checks: input.checks,
      focusedViewId,
      workingDraft,
      ensureRepairWindowOpen: () => ensureRepairWindowOpen("upsertView"),
      clearViewPhaseDraft,
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    upsertQuery: buildUpsertQueryTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      ensureRepairWindowOpen: () => ensureRepairWindowOpen("upsertQuery"),
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    upsertBinding: buildUpsertBindingTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      ensureRepairWindowOpen: () => ensureRepairWindowOpen("upsertBinding"),
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    deleteView: buildDeleteViewTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    deleteQuery: buildDeleteQueryTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
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
    composePatch: buildComposePatchTool({
      dashboard: input.dashboard,
      dependencies: input.dependencies,
      workingDraft,
      setLatestProposalMeta: (proposal) => {
        latestProposalMeta = proposal;
      },
      buildCandidateDocument,
    }),
    applyPatch: buildApplyPatchTool({
      dashboard: input.dashboard,
      dependencies: input.dependencies,
      messages: input.messages,
      workingDraft,
      resetWorkingDraft,
      recordMutation,
      getLatestProposalMeta: () => latestProposalMeta,
      buildCandidateDocument,
    }),
  } satisfies ToolSet;

  const selectedToolNames = new Set(
    input.activeTools ?? (Object.keys(tools) as AuthoringToolName[]),
  );
  const filteredTools = Object.fromEntries(
    Object.entries(tools).filter(([toolName]) =>
      selectedToolNames.has(toolName as AuthoringToolName),
    ),
  ) satisfies ToolSet;

  return {
    tools: filteredTools,
    getDraftSnapshot,
    getLastRunCheckStateSnapshot,
    getMessagesForModel: () => localMessages,
  };
}
