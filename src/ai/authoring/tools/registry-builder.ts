import { Type, type Static } from "typebox";
import type {
  DeclareAuthoringGoalToolInput,
  DeclareAuthoringGoalToolOutput,
  GetViewsToolInput,
} from "@/ai/authoring/contracts/tool-io";
import type { AuthoringGoal } from "@/ai/authoring/contracts/progress";
import type { AuthoringDependencies } from "@/ai/authoring/runtime/dependencies";
import {
  buildViewListSummary,
} from "@/ai/authoring/messages/context-summary";
import {
  buildQueryDetail,
  buildViewDetail,
  findCheckSnapshot,
} from "@/ai/authoring/tools/detail-builders";
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
  buildGetDraftStatusTool,
} from "@/ai/authoring/tools/draft-status";
import {
  buildApplyPatchTool,
  buildComposePatchTool,
  buildRunCheckTool,
} from "@/ai/authoring/tools/write-tools";
import { buildStageChartTool } from "@/ai/authoring/tools/stage-chart-tool";
import { buildStageQueryTool } from "@/ai/authoring/tools/stage-query-tool";
import { buildStageDeleteTool } from "@/ai/authoring/tools/stage-delete-tool";
import { assertFocusedViewAccess } from "@/ai/authoring/tools/focused-guards";
import {
  buildCandidateDocument,
  buildDocumentFingerprint,
} from "@/ai/authoring/tools/candidate-document";
import { defineTool, type AuthoringToolSet } from "@/ai/authoring/tools/definition";
import type {
  AuthoringToolRuntimeContext,
  BuildAuthoringToolsInput,
} from "@/ai/authoring/tools/runtime-context";

interface BuildAuthoringToolRegistryInput {
  runtime: AuthoringToolRuntimeContext;
  dashboardId?: string | null;
  dependencies: AuthoringDependencies;
  findLatestDraftOutput?: BuildAuthoringToolsInput["findLatestDraftOutput"];
  findDraftOutputBySuggestionId?: BuildAuthoringToolsInput["findDraftOutputBySuggestionId"];
  getActiveGoalId?: BuildAuthoringToolsInput["getActiveGoalId"];
  getActiveGoal?: () => AuthoringGoal | null;
  getRuntimeApprovalContext?: BuildAuthoringToolsInput["getRuntimeApprovalContext"];
  getBaseVersion?: BuildAuthoringToolsInput["getBaseVersion"];
  onDeclareAuthoringGoal?: BuildAuthoringToolsInput["onDeclareAuthoringGoal"];
}

const dataModeSchema = Type.Union([
  Type.Literal("live"),
  Type.Literal("mock"),
  Type.Literal("undecided"),
]);
const declareViewGoalSchema = Type.Object(
  {
    summary: Type.Optional(Type.String({ minLength: 1 })),
    dataMode: Type.Optional(dataModeSchema),
    chartSkillId: Type.Optional(Type.String({ minLength: 1 })),
    requestedChartLabel: Type.Optional(Type.String({ minLength: 1 })),
    metrics: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    dimensions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    timeGrain: Type.Optional(
      Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month")]),
    ),
    datasourceId: Type.Optional(Type.String({ minLength: 1 })),
    table: Type.Optional(Type.String({ minLength: 1 })),
    targetViewId: Type.Optional(Type.String({ minLength: 1 })),
    targetViewTitle: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
const declareAuthoringGoalInputSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("set_data_mode"),
      Type.Literal("create_view"),
      Type.Literal("revise_view"),
      Type.Literal("create_dashboard"),
    ]),
    dataMode: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("mock")])),
    goal: Type.Optional(
      Type.Object(
        {
          ...declareViewGoalSchema.properties,
          views: Type.Optional(
            Type.Array(declareViewGoalSchema, { minItems: 1, maxItems: 8 }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

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

function normalizeDeclareAuthoringGoalInput(
  declaration: Static<typeof declareAuthoringGoalInputSchema>,
): DeclareAuthoringGoalToolInput {
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
}

function validateDeclaredChartSkill(
  declaration: DeclareAuthoringGoalToolInput,
  runtime: AuthoringToolRuntimeContext,
): string | null {
  const invalidSkill = (skillId: string | undefined) => {
    if (!skillId) {
      return null;
    }
    return skillId.startsWith("echarts-") && runtime.skillCatalog.has(skillId)
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
}

export function buildAuthoringToolRegistry(
  input: BuildAuthoringToolRegistryInput,
): AuthoringToolSet {
  const { runtime } = input;
  return {
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
        const invalidSkillId = validateDeclaredChartSkill(declaration, runtime);
        if (invalidSkillId) {
          return {
            accepted: false,
            declaredIntentKind: declaration.kind,
            declaration,
            message: `Chart skill "${invalidSkillId}" is not available. Use one of: ${[...runtime.skillCatalog.keys()].filter((id) => id.startsWith("echarts-")).join(", ") || "none"}.`,
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
      skillCatalog: runtime.skillCatalog,
      loadSkill: input.dependencies.loadSkill,
      onLoaded: (skill) => runtime.recordLoadedSkill(skill),
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
          document: buildCandidateDocument(runtime.dashboard, runtime.workingDraft),
          dashboardId: input.dashboardId,
          checks: runtime.checks,
        }),
    }),
    getDatasources: buildGetDatasourcesTool({
      getDatasourceList: runtime.getDatasourceList,
    }),
    getView: buildGetViewTool({
      dashboard: runtime.dashboard,
      dashboardId: input.dashboardId,
      checks: runtime.checks,
      workingDraft: runtime.workingDraft,
      buildCandidateDocument,
      buildViewSummary: ({ document, dashboardId, checks }) =>
        buildViewListSummary({ document, dashboardId, checks }),
      buildViewDetail,
      findCheckSnapshot,
      onBeforeResolve: (requestedViewId, requestedTitle) =>
        assertFocusedViewAccess({
          focusedViewId: runtime.focusedViewId,
          requestedViewId,
          action: requestedTitle ? "View title lookup" : "View access",
        }),
    }),
    getQuery: buildGetQueryTool({
      dashboard: runtime.dashboard,
      workingDraft: runtime.workingDraft,
      buildCandidateDocument,
      buildQueryDetail,
      onAfterResolve: (query, document) => {
        if (!runtime.focusedViewId) {
          return;
        }

        const usedByOtherViews = document.bindings.some(
          (binding) =>
            binding.query_id === query.id &&
            binding.view_id !== runtime.focusedViewId,
        );
        if (usedByOtherViews) {
          throw new Error(`Query "${query.id}" is not scoped to "${runtime.focusedViewId}".`);
        }
      },
    }),
    getBinding: buildGetBindingTool({
      dashboard: runtime.dashboard,
      workingDraft: runtime.workingDraft,
      buildCandidateDocument,
      onBeforeResolve: (viewId) =>
        assertFocusedViewAccess({
          focusedViewId: runtime.focusedViewId,
          requestedViewId: viewId,
          action: "Binding inspection",
        }),
    }),
    getDraftStatus: buildGetDraftStatusTool({
      dashboard: runtime.dashboard,
      workingDraft: runtime.workingDraft,
      getDraftSnapshot: runtime.getDraftSnapshot,
      getLastRunCheckState: runtime.getLastRunCheckStateSnapshot,
      getActiveGoal: input.getActiveGoal,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    listDatasourceTables: buildListDatasourceTablesTool({
      getDatasourceSchema: runtime.getDatasourceSchema,
    }),
    getTableSchema: buildGetTableSchemaTool({
      getDatasourceSchema: runtime.getDatasourceSchema,
    }),
    previewTableData: buildPreviewTableDataTool({
      getDatasourceSchema: runtime.getDatasourceSchema,
      executePreview: input.dependencies.executePreview,
    }),
    runCheck: buildRunCheckTool({
      dashboard: runtime.dashboard,
      workingDraft: runtime.workingDraft,
      checks: runtime.checks,
      focusedViewId: runtime.focusedViewId,
      dependencies: input.dependencies,
      getLastRunCheckState: runtime.getLastRunCheckState,
      setLastRunCheckState: runtime.setLastRunCheckState,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    stageChart: buildStageChartTool({
      dashboard: runtime.dashboard,
      checks: runtime.checks,
      focusedViewId: runtime.focusedViewId,
      workingDraft: runtime.workingDraft,
      getActiveGoalId: input.getActiveGoalId,
      markWorkingDraftUpdated: runtime.markWorkingDraftUpdated,
      buildCandidateDocument,
      buildDocumentFingerprint,
      buildDraftStatus: () =>
        runtime.getDraftStatusSnapshot(input.getActiveGoal?.() ?? null),
      getDatasourceSchema: runtime.getDatasourceSchema,
    }),
    stageQuery: buildStageQueryTool({
      dashboard: runtime.dashboard,
      focusedViewId: runtime.focusedViewId,
      workingDraft: runtime.workingDraft,
      markWorkingDraftUpdated: runtime.markWorkingDraftUpdated,
      buildDraftStatus: () =>
        runtime.getDraftStatusSnapshot(input.getActiveGoal?.() ?? null),
    }),
    stageDelete: buildStageDeleteTool({
      dashboard: runtime.dashboard,
      focusedViewId: runtime.focusedViewId,
      workingDraft: runtime.workingDraft,
      markWorkingDraftUpdated: runtime.markWorkingDraftUpdated,
      buildCandidateDocument,
      buildDocumentFingerprint,
      buildDraftStatus: () =>
        runtime.getDraftStatusSnapshot(input.getActiveGoal?.() ?? null),
    }),
    composePatch: buildComposePatchTool({
      dashboard: runtime.dashboard,
      focusedViewId: runtime.focusedViewId,
      dependencies: input.dependencies,
      workingDraft: runtime.workingDraft,
      getLastRunCheckState: runtime.getLastRunCheckState,
      getBaseVersion: input.getBaseVersion,
      setLatestProposalMeta: runtime.setLatestProposalMeta,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
    applyPatch: buildApplyPatchTool({
      dashboard: runtime.dashboard,
      dependencies: input.dependencies,
      workingDraft: runtime.workingDraft,
      resetWorkingDraft: runtime.resetWorkingDraft,
      getLatestProposalMeta: runtime.getLatestProposalMeta,
      findLatestDraftOutput: input.findLatestDraftOutput,
      findDraftOutputBySuggestionId: input.findDraftOutputBySuggestionId,
      getRuntimeApprovalContext: input.getRuntimeApprovalContext,
      buildCandidateDocument,
      buildDocumentFingerprint,
    }),
  } satisfies AuthoringToolSet;
}
