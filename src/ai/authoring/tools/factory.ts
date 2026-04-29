import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  DashboardDocument,
  DatasourceContext,
} from "@/contracts";
import type {
  AuthoringMessage,
  AuthoringSkillSummary,
  DatasourceListItemSummary,
  DraftStatusToolOutput,
  GetViewsToolInput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type {
  AuthoringTaskStateSnapshot,
  AuthoringWorkingDraftSnapshot,
} from "@/ai/authoring/contracts/session";
import type { AiSuggestionKind } from "@/ai/authoring/contracts/artifacts";
import {
  buildCandidateDocument,
  buildDocumentFingerprint,
} from "@/ai/authoring/tools/candidate-document";
import { removeBindingFromDocument } from "@/domain/dashboard/document";
import {
  buildViewListSummary,
} from "@/ai/authoring/messages/context-summary";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import {
  buildQueryDetail,
  buildViewDetail,
  findCheckSnapshot,
} from "@/ai/authoring/tools/detail-builders";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneDatasourceSchema,
  cloneQuery,
  cloneWorkingDraftOwnership,
  createEmptyWorkingDraftOwnership,
  createWorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import {
  MAX_AUTOREPAIR_ATTEMPTS,
  type LastRunCheckState,
} from "@/ai/authoring/tools/reliability";
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
  buildDraftStatus,
  buildGetDraftStatusTool,
} from "@/ai/authoring/tools/draft-status";
import {
  buildApplyPatchTool,
  buildComposePatchTool,
  buildDeleteQueryTool,
  buildDeleteViewTool,
  buildRunCheckTool,
  buildUpsertBindingTool,
  buildUpsertLayoutTool,
  buildUpsertQueryTool,
  buildUpsertViewTool,
} from "@/ai/authoring/tools/write-tools";
import { assertFocusedViewAccess } from "@/ai/authoring/tools/focused-guards";
import type { AuthoringScope, AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type { MutationDescriptor } from "@/ai/authoring/messages/invalidate-on-mutation";
import type { AuthoringRunCheckStateSnapshot } from "@/ai/authoring/contracts/session";
import type { AuthoringSkillReferenceCheck } from "@/ai/authoring/contracts/skill";
import type { AuthoringGoalV2, ContextStatusV2 } from "@/ai/authoring/v2/types";
import { buildContextStatusSnapshotV2 } from "@/ai/authoring/tools/context-status";

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
  initialLoadedSkillReferenceChecks?: AuthoringSkillReferenceCheck[] | null;
  getTaskState?: () => AuthoringTaskStateSnapshot | null;
  getActiveGoalId?: () => string | null | undefined;
  hasRuntimeApproval?: () => boolean;
  getBaseVersion?: () => number | undefined;
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
  const datasourceSchemaLoadedAt = new Map<string, string>();
  const loadedSkillReferenceChecks = new Map(
    (input.initialLoadedSkillReferenceChecks ?? []).map((check) => [
      check.reference_key,
      check,
    ]),
  );
  const loadedSkillReferenceLoadedAt = new Map(
    (input.initialLoadedSkillReferenceChecks ?? []).map((check) => [
      check.reference_key,
      new Date().toISOString(),
    ]),
  );
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
    datasourceSchemaLoadedAt.set(datasourceId, new Date().toISOString());
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
    workingDraft.ownership = createEmptyWorkingDraftOwnership();
  };

  const markWorkingDraftUpdated = () => {
    workingDraft.stagedAt = new Date().toISOString();
  };

  const pendingMutations: MutationDescriptor[] = [];

  const recordMutation = (mutation: MutationDescriptor) => {
    pendingMutations.push(mutation);
  };

  const drainMutations = (): MutationDescriptor[] => {
    const out = pendingMutations.splice(0, pendingMutations.length);
    return out;
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
    workingDraft.ownership = createEmptyWorkingDraftOwnership();
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
      ownership: cloneWorkingDraftOwnership(workingDraft.ownership),
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

  const getDraftStatusSnapshot = (): DraftStatusToolOutput => {
    const candidate = buildCandidateDocument(input.dashboard, workingDraft);
    return buildDraftStatus({
      dashboard: input.dashboard,
      candidate,
      draft: getDraftSnapshot(),
      taskState: input.getTaskState?.() ?? null,
      documentHash: buildDocumentFingerprint(candidate),
      lastRunCheckState: getLastRunCheckStateSnapshot(),
    });
  };

  const tools = {
    loadSkill: buildLoadSkillTool({
      skillCatalog,
      loadSkill: input.dependencies.loadSkill,
    }),
    loadSkillReference: buildLoadSkillReferenceTool({
      skillCatalog,
      loadSkillReference: input.dependencies.loadSkillReference,
      onLoaded: (reference) => {
        if (reference.check) {
          loadedSkillReferenceChecks.set(
            reference.check.reference_key,
            reference.check,
          );
          loadedSkillReferenceLoadedAt.set(
            reference.check.reference_key,
            new Date().toISOString(),
          );
        }
      },
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
    getDraftStatus: buildGetDraftStatusTool({
      dashboard: input.dashboard,
      workingDraft,
      getDraftSnapshot,
      getLastRunCheckState: getLastRunCheckStateSnapshot,
      getTaskState: input.getTaskState,
      buildCandidateDocument,
      buildDocumentFingerprint,
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
      getActiveGoalId: input.getActiveGoalId,
      ensureRepairWindowOpen: () => ensureRepairWindowOpen("upsertView"),
      clearViewPhaseDraft,
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
      getLoadedSkillReferenceChecks: () => [...loadedSkillReferenceChecks.values()],
    }),
    upsertQuery: buildUpsertQueryTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      getActiveGoalId: input.getActiveGoalId,
      ensureRepairWindowOpen: () => ensureRepairWindowOpen("upsertQuery"),
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
      getLoadedSkillReferenceChecks: () => [...loadedSkillReferenceChecks.values()],
    }),
    upsertBinding: buildUpsertBindingTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      getActiveGoalId: input.getActiveGoalId,
      ensureRepairWindowOpen: () => ensureRepairWindowOpen("upsertBinding"),
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
      getLoadedSkillReferenceChecks: () => [...loadedSkillReferenceChecks.values()],
    }),
    upsertLayout: buildUpsertLayoutTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      getActiveGoalId: input.getActiveGoalId,
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
      getLastRunCheckState: () => lastRunCheckState,
      getBaseVersion: input.getBaseVersion,
      setLatestProposalMeta: (proposal) => {
        latestProposalMeta = proposal;
      },
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    applyPatch: buildApplyPatchTool({
      dashboard: input.dashboard,
      dependencies: input.dependencies,
      messages: input.messages,
      workingDraft,
      resetWorkingDraft,
      recordMutation,
      getLatestProposalMeta: () => latestProposalMeta,
      hasRuntimeApproval: input.hasRuntimeApproval,
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
    getCandidateDocumentSnapshot: () => buildCandidateDocument(input.dashboard, workingDraft),
	    getContextStatusSnapshot: (
	      goal?: AuthoringGoalV2 | null,
	    ): ContextStatusV2 =>
	      buildContextStatusSnapshotV2({
	        goal,
	        datasourceListLoaded: Boolean(datasourceListCache),
	        datasourceSchemaCache,
	        datasourceSchemaLoadedAt,
	        loadedSkillReferenceChecks: loadedSkillReferenceChecks.values(),
	        loadedSkillReferenceLoadedAt,
	      }),
    getDraftSnapshot,
    getDraftStatusSnapshot,
    getLastRunCheckStateSnapshot,
    drainMutations,
  };
}
