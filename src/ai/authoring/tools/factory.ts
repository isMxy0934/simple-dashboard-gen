import { Type, type Static } from "typebox";
import type {
  DashboardDocument,
  DatasourceContext,
} from "@/contracts";
import type {
  AuthoringSkillSummary,
  AuthoringDraftOutput,
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
import type { LastRunCheckState } from "@/ai/authoring/tools/reliability";
import {
  buildGetBindingTool,
  buildGetDatasourcesTool,
  buildGetQueryTool,
  buildGetTableSchemaTool,
  buildGetViewTool,
  buildListDatasourceTablesTool,
  buildLoadSkillTool,
  buildPreviewTableDataTool,
} from "@/ai/authoring/tools/shared-tools";
import {
  buildDraftStatus,
  buildGetDraftStatusTool,
} from "@/ai/authoring/tools/draft-status";
import {
  buildApplyPatchTool,
  buildComposePatchTool,
  buildRunCheckTool,
} from "@/ai/authoring/tools/write-tools";
import { buildStageChartTool } from "@/ai/authoring/tools/stage-chart-tool";
import { buildStageDeleteTool } from "@/ai/authoring/tools/stage-delete-tool";
import { assertFocusedViewAccess } from "@/ai/authoring/tools/focused-guards";
import type { AuthoringScope, AuthoringToolName } from "@/ai/authoring/contracts/runtime";
import type { AuthoringRunCheckStateSnapshot } from "@/ai/authoring/contracts/session";
import type { AuthoringGoal, ContextStatus } from "@/ai/authoring/contracts/progress";
import { buildContextStatusSnapshot } from "@/ai/authoring/tools/context-status";
import { defineTool, type AuthoringToolSet } from "@/ai/authoring/tools/definition";

export function buildAuthoringTools(input: {
  scope: AuthoringScope;
  activeTools?: AuthoringToolName[];
  dashboard: DashboardDocument;
  dashboardId?: string | null;
  datasources?: DatasourceListItemSummary[] | null;
  skills?: AuthoringSkillSummary[] | null;
  checks?: ViewCheckSnapshot[] | null;
  initialWorkingDraft?: AuthoringWorkingDraftSnapshot | null;
  initialLastRunCheckState?: AuthoringRunCheckStateSnapshot | null;
  findLatestDraftOutput?: () => AuthoringDraftOutput | null;
  findDraftOutputBySuggestionId?: (suggestionId: string) => AuthoringDraftOutput | null;
  getActiveGoalId?: () => string | null | undefined;
  getActiveGoal?: () => AuthoringGoal | null;
  getRuntimeApprovalContext?: () => {
    approved: boolean;
    proposalId?: string | null;
    baseVersion?: number | null;
    pendingProposalId?: string | null;
    pendingProposalBaseVersion?: number | null;
    draftFingerprint?: string | null;
  } | null | undefined;
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

  const markWorkingDraftUpdated = () => {
    workingDraft.stagedAt = new Date().toISOString();
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

  const dataModeSchema = Type.Union([Type.Literal("live"), Type.Literal("mock"), Type.Literal("undecided")]);
  const declareViewGoalSchema = Type.Object({
    summary: Type.Optional(Type.String({ minLength: 1 })),
    dataMode: Type.Optional(dataModeSchema),
    chartSkillId: Type.Optional(Type.String({ minLength: 1 })),
    requestedChartLabel: Type.Optional(Type.String({ minLength: 1 })),
    metrics: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    dimensions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    timeGrain: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month")])),
    datasourceId: Type.Optional(Type.String({ minLength: 1 })),
    table: Type.Optional(Type.String({ minLength: 1 })),
    targetViewId: Type.Optional(Type.String({ minLength: 1 })),
    targetViewTitle: Type.Optional(Type.String({ minLength: 1 })),
  }, { additionalProperties: false });
  const declareAuthoringGoalInputSchema = Type.Object({
    kind: Type.Union([
      Type.Literal("set_data_mode"),
      Type.Literal("create_view"),
      Type.Literal("revise_view"),
      Type.Literal("create_dashboard"),
    ]),
    dataMode: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("mock")])),
    goal: Type.Optional(Type.Object({
      ...declareViewGoalSchema.properties,
      views: Type.Optional(Type.Array(declareViewGoalSchema, { minItems: 1, maxItems: 8 })),
    }, { additionalProperties: false })),
    reason: Type.Optional(Type.String()),
  }, { additionalProperties: false });

  function validateAuthoringGoalDeclaration(
    value: Static<typeof declareAuthoringGoalInputSchema>,
  ): string[] {
    const errors: string[] = [];
    if (value.kind === "set_data_mode" && !value.dataMode) {
      errors.push("dataMode is required when kind is set_data_mode.");
    }
    if (
      (value.kind === "create_view" ||
        value.kind === "revise_view" ||
        value.kind === "create_dashboard") &&
      !value.goal
    ) {
      errors.push("goal is required when declaring an authoring goal.");
    }
    if (
      value.kind === "create_dashboard" &&
      (!value.goal?.views || value.goal.views.length === 0)
    ) {
      errors.push("goal.views is required when kind is create_dashboard.");
    }
    return errors;
  }

  const normalizeDeclareAuthoringGoalInput = (
    declaration: Static<typeof declareAuthoringGoalInputSchema>,
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
    declareAuthoringGoal: defineTool({
      name: "declareAuthoringGoal",
      label: "Declare Authoring Goal",
      description:
        "Declare a concrete dashboard authoring goal after understanding the user request. This does not edit the dashboard; it records structured intent facts for later context and trace. Use canonical kind values and a chartSkillId from the available echarts-* skills.",
      parameters: declareAuthoringGoalInputSchema,
      execute: async (rawDeclaration): Promise<DeclareAuthoringGoalToolOutput> => {
        const crossFieldErrors = validateAuthoringGoalDeclaration(rawDeclaration);
        if (crossFieldErrors.length > 0) {
          throw new Error(crossFieldErrors.join(" "));
        }
        const declaration = normalizeDeclareAuthoringGoalInput(rawDeclaration);
        const invalidSkillId = validateDeclaredChartSkill(declaration);
        if (invalidSkillId) {
          return {
            accepted: false,
            declaredIntentKind: declaration.kind,
            declaration,
            message: `Chart skill "${invalidSkillId}" is not available. Use one of: ${[...skillCatalog.keys()].filter((id) => id.startsWith("echarts-")).join(", ") || "none"}.`,
          };
        }
        if (!input.onDeclareAuthoringGoal) {
          return {
            accepted: false,
            declaredIntentKind: declaration.kind,
            declaration,
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
    getViews: defineTool({
      name: "getViews",
      label: "Get Views",
      description:
        "Get the dashboard view list with binding/query/check summary for each view.",
      parameters: Type.Object(
        { reason: Type.Optional(Type.String()) },
        { additionalProperties: false },
      ),
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
    listDatasourceTables: buildListDatasourceTablesTool({
      getDatasourceSchema,
    }),
    getTableSchema: buildGetTableSchemaTool({
      getDatasourceSchema,
    }),
    previewTableData: buildPreviewTableDataTool({
      getDatasourceSchema,
      executePreview: input.dependencies.executePreview,
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
    stageChart: buildStageChartTool({
      dashboard: input.dashboard,
      checks: input.checks,
      focusedViewId,
      workingDraft,
      getActiveGoalId: input.getActiveGoalId,
      markWorkingDraftUpdated,
      buildCandidateDocument,
      buildDocumentFingerprint,
      buildDraftStatus: getDraftStatusSnapshot,
      getDatasourceSchema,
    }),
    stageDelete: buildStageDeleteTool({
      dashboard: input.dashboard,
      focusedViewId,
      workingDraft,
      markWorkingDraftUpdated,
      buildCandidateDocument,
      buildDocumentFingerprint,
      buildDraftStatus: getDraftStatusSnapshot,
    }),
    composePatch: buildComposePatchTool({
      dashboard: input.dashboard,
      focusedViewId,
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
      workingDraft,
      resetWorkingDraft,
      getLatestProposalMeta: () => latestProposalMeta,
      findLatestDraftOutput: input.findLatestDraftOutput,
      findDraftOutputBySuggestionId: input.findDraftOutputBySuggestionId,
      getRuntimeApprovalContext: input.getRuntimeApprovalContext,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
  } satisfies AuthoringToolSet;

  const selectedToolNames = new Set(
    input.activeTools ?? (Object.keys(tools) as AuthoringToolName[]),
  );
  const filteredTools = Object.fromEntries(
    Object.entries(tools).filter(([toolName]) =>
      selectedToolNames.has(toolName as AuthoringToolName),
    ),
  ) satisfies AuthoringToolSet;

  return {
    tools: filteredTools,
    getCandidateDocumentSnapshot: () => buildCandidateDocument(input.dashboard, workingDraft),
    getCandidateDocumentFingerprintSnapshot: () =>
      buildDocumentFingerprint(buildCandidateDocument(input.dashboard, workingDraft)),
    getContextStatusSnapshot: (
      goal?: AuthoringGoal | null,
    ): ContextStatus =>
      buildContextStatusSnapshot({
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
  };
}
