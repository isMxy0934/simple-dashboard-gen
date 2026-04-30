import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type {
  DashboardDocument,
  DatasourceContext,
} from "@/contracts";
import type {
  AuthoringMessage,
  AuthoringSkillSummary,
  DeclareAuthoringGoalToolInput,
  DeclareAuthoringGoalToolOutput,
  DatasourceListItemSummary,
  DraftStatusToolOutput,
  GetViewsToolInput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringWorkingDraftSnapshot } from "@/ai/authoring/contracts/session";
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
  MAX_REPEAT_FAILURE_ATTEMPTS,
  type LastRunCheckState,
} from "@/ai/authoring/tools/reliability";
import {
  buildDeleteBindingTool,
  buildGetBindingTool,
  buildGetDatasourcesTool,
  buildGetQueryTool,
  buildGetSchemaByDatasourceTool,
  buildGetViewTool,
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
  getActiveGoalId?: () => string | null | undefined;
  getActiveGoal?: () => AuthoringGoalV2 | null;
  hasRuntimeApproval?: () => boolean;
  getBaseVersion?: () => number | undefined;
  onDeclareAuthoringGoal?: (
    declaration: DeclareAuthoringGoalToolInput,
  ) => Promise<DeclareAuthoringGoalToolOutput> | DeclareAuthoringGoalToolOutput;
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
  const loadedSkillContent = new Map<string, string>();
  const loadedSkillLoadedAt = new Map<string, string>();
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

  const assertRepeatFailureWindowOpen = (toolName: "upsertView" | "upsertQuery" | "upsertBinding") => {
    if (
      lastRunCheckState &&
      lastRunCheckState.consecutive_repeat_count >= MAX_REPEAT_FAILURE_ATTEMPTS
    ) {
      throw new Error(
        `Repeat failure limit reached after repeated ${toolName} attempts. The same reliability failures are still present, so stop retrying and explain the issue.`,
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
      activeGoal: input.getActiveGoal?.() ?? null,
      documentHash: buildDocumentFingerprint(candidate),
      lastRunCheckState: getLastRunCheckStateSnapshot(),
    });
  };

  const declareViewGoalSchema = z.object({
    summary: z.string().min(1).optional(),
    dataMode: z.enum(["live", "mock", "undecided"]).optional(),
    chartSkillId: z.string().min(1).optional().describe("Canonical chart skill id from the available echarts-* skill metadata, for example echarts-line."),
    requestedChartLabel: z.string().min(1).optional().describe("User-facing chart label from the request, for trace/explanation only."),
    metrics: z.array(z.string().min(1)).optional(),
    dimensions: z.array(z.string().min(1)).optional(),
    timeGrain: z.enum(["day", "week", "month"]).optional(),
    datasourceId: z.string().min(1).optional(),
    table: z.string().min(1).optional(),
    targetViewId: z.string().min(1).optional(),
    targetViewTitle: z.string().min(1).optional(),
  }).strict();
  const declareAuthoringGoalInputSchema = z.object({
    kind: z.enum([
      "set_data_mode",
      "create_view",
      "revise_view",
      "create_dashboard",
    ]),
    dataMode: z.enum(["live", "mock"]).optional(),
    goal: declareViewGoalSchema.extend({
      views: z.array(declareViewGoalSchema).min(1).max(8).optional(),
    }).optional(),
    reason: z.string().optional(),
  }).strict().superRefine((value, ctx) => {
    if (value.kind === "set_data_mode" && !value.dataMode) {
      ctx.addIssue({
        code: "custom",
        path: ["dataMode"],
        message: "dataMode is required when kind is set_data_mode.",
      });
    }
    if (
      (value.kind === "create_view" ||
        value.kind === "revise_view" ||
        value.kind === "create_dashboard") &&
      !value.goal
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["goal"],
        message: "goal is required when declaring an authoring goal.",
      });
    }
    if (
      value.kind === "create_dashboard" &&
      (!value.goal?.views || value.goal.views.length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["goal", "views"],
        message: "goal.views is required when kind is create_dashboard.",
      });
    }
  });

  const normalizeDeclareAuthoringGoalInput = (
    declaration: z.infer<typeof declareAuthoringGoalInputSchema>,
  ): DeclareAuthoringGoalToolInput => {
    if (declaration.kind === "set_data_mode") {
      if (!declaration.dataMode) {
        throw new Error("declareAuthoringGoal requires dataMode for set_data_mode.");
      }
      return {
        kind: "set_data_mode",
        dataMode: declaration.dataMode,
        ...(declaration.reason ? { reason: declaration.reason } : {}),
      };
    }

    if (!declaration.goal) {
      throw new Error("declareAuthoringGoal requires goal for authoring declarations.");
    }

    if (declaration.kind === "create_dashboard") {
      const { views, ...goal } = declaration.goal;
      if (!views?.length) {
        throw new Error("declareAuthoringGoal requires goal.views for create_dashboard.");
      }
      return {
        kind: "create_dashboard",
        goal: { ...goal, views },
        ...(declaration.reason ? { reason: declaration.reason } : {}),
      };
    }

    const { views: _views, ...goal } = declaration.goal;
    return {
      kind: declaration.kind,
      goal,
      ...(declaration.reason ? { reason: declaration.reason } : {}),
    };
  };

  const validateDeclaredChartSkill = (
    declaration: DeclareAuthoringGoalToolInput,
  ): string | null => {
    const invalidSkill = (skillId: string | undefined) => {
      if (!skillId) {
        return null;
      }
      return skillId.startsWith("echarts-") && skillCatalog.has(skillId)
        ? null
        : skillId;
    };
    if (declaration.kind === "set_data_mode") {
      return null;
    }
    if (declaration.kind === "create_dashboard") {
      return (
        invalidSkill(declaration.goal.chartSkillId) ??
        declaration.goal.views.map((view) => invalidSkill(view.chartSkillId)).find(Boolean) ??
        null
      );
    }
    return invalidSkill(declaration.goal.chartSkillId);
  };

  const tools = {
    declareAuthoringGoal: tool({
      description:
        "Declare a concrete dashboard authoring goal after understanding the user request. This does not edit the dashboard; it hands structured intent to the V2 workflow runtime. Use canonical kind values and a chartSkillId from the available echarts-* skills.",
      inputSchema: declareAuthoringGoalInputSchema,
      execute: async (rawDeclaration): Promise<DeclareAuthoringGoalToolOutput> => {
        const declaration = normalizeDeclareAuthoringGoalInput(rawDeclaration);
        const invalidSkillId = validateDeclaredChartSkill(declaration);
        if (invalidSkillId) {
          return {
            accepted: false,
            declaredIntentKind: declaration.kind,
            message: `Chart skill "${invalidSkillId}" is not available. Use one of: ${[...skillCatalog.keys()].filter((id) => id.startsWith("echarts-")).join(", ") || "none"}.`,
          };
        }
        if (!input.onDeclareAuthoringGoal) {
          return {
            accepted: false,
            declaredIntentKind: declaration.kind,
            message: "No authoring goal declaration handler is available.",
          };
        }
        return input.onDeclareAuthoringGoal(declaration);
      },
    }),
    loadSkill: buildLoadSkillTool({
      skillCatalog,
      loadSkill: input.dependencies.loadSkill,
      onLoaded: (skill) => {
        loadedSkillContent.set(skill.skill_id, skill.content);
        loadedSkillLoadedAt.set(skill.skill_id, new Date().toISOString());
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
      getActiveGoal: input.getActiveGoal,
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
      assertRepeatFailureWindowOpen: () => assertRepeatFailureWindowOpen("upsertView"),
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
      getActiveGoalId: input.getActiveGoalId,
      assertRepeatFailureWindowOpen: () => assertRepeatFailureWindowOpen("upsertQuery"),
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    upsertBinding: buildUpsertBindingTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      getActiveGoalId: input.getActiveGoalId,
      assertRepeatFailureWindowOpen: () => assertRepeatFailureWindowOpen("upsertBinding"),
      markWorkingDraftUpdated,
      recordMutation,
      buildCandidateDocument,
      buildDocumentFingerprint,
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
    getCandidateDocumentFingerprintSnapshot: () =>
      buildDocumentFingerprint(buildCandidateDocument(input.dashboard, workingDraft)),
	    getContextStatusSnapshot: (
	      goal?: AuthoringGoalV2 | null,
	    ): ContextStatusV2 =>
	      buildContextStatusSnapshotV2({
	        goal,
	        datasourceListLoaded: Boolean(datasourceListCache),
	        datasourceSchemaCache,
	        datasourceSchemaLoadedAt,
	        skillCatalog: skillCatalog.values(),
	        loadedSkillContent,
	        loadedSkillLoadedAt,
	      }),
    getDraftSnapshot,
    getDraftStatusSnapshot,
    getLastRunCheckStateSnapshot,
    drainMutations,
  };
}
