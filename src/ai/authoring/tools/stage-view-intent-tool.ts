import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DatasourceContext,
} from "@/contracts";
import type { DashboardViewIntent } from "@/contracts/dashboard-view-intent";
import type {
  DraftStatusToolOutput,
  StageChartFieldInput,
  StageChartToolInput,
  StageViewIntentToolInput,
  StageViewIntentToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import { defineTool } from "@/ai/authoring/tools/definition";
import { stageViewIntentInputSchema } from "@/ai/authoring/tools/schemas";
import {
  stageChartTransaction,
} from "@/ai/authoring/tools/stage-chart-tool";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";
import { compileDashboardViewIntent } from "@/ai/authoring/view-intent/compiler";
import { resolveRequiredView } from "@/ai/authoring/tools/detail-builders";
import {
  getLayoutItemsForView,
  removeQueryFromDocument,
  removeViewFromDocument,
} from "@/domain/dashboard/document";
import { isLiveBinding } from "@/domain/dashboard/bindings";

const STAGE_VIEW_INTENT_TOOL_DESCRIPTION = [
  "Stage one complete semantic view transaction into the working draft.",
  "Use this as the normal write path for creating or revising a dashboard view from business intent.",
  "Provide view_kind, title, datasource/table, field role mappings, aggregation/filter/sort/limit intent, and optional mock data/value.",
  "Do not provide renderer implementation identifiers, renderer contracts, layout, style ids, SQL, bindings, or query output.",
].join(" ");

function buildViewIntent(input: StageViewIntentToolInput): DashboardViewIntent {
  return {
    view_kind: input.view_kind,
    datasource_id: input.datasource_id,
    table: input.table,
    data_mode: input.data_mode ?? "live",
    fields: input.fields,
    ...(input.sort ? { sort: input.sort } : {}),
    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
    ...(input.filters ? { filters: input.filters } : {}),
    ...(input.mock_data ? { mock_data: input.mock_data } : {}),
    ...(input.mock_value !== undefined ? { mock_value: input.mock_value } : {}),
  };
}

function toStageChartFields(
  fields: StageViewIntentToolInput["fields"],
): StageChartToolInput["fields"] {
  const out: StageChartToolInput["fields"] = {};
  for (const role of ["time", "category", "metric", "value", "series"] as const) {
    const field = fields[role];
    if (!field) {
      continue;
    }
    const { time_grain: _timeGrain, ...chartField } = field;
    out[role] = chartField satisfies StageChartFieldInput;
  }
  return out;
}

function toStageChartInput(input: {
  toolInput: StageViewIntentToolInput;
  skillId: string;
  layout?: StageChartToolInput["layout"];
  targetViewId?: string;
}): StageChartToolInput {
  const timeGrain = input.toolInput.fields.time?.time_grain;
  return {
    ...(input.toolInput.goal_id ? { goal_id: input.toolInput.goal_id } : {}),
    ...(input.toolInput.reason !== undefined ? { reason: input.toolInput.reason } : {}),
    skill_id: input.skillId,
    title: input.toolInput.title,
    ...(input.toolInput.description !== undefined
      ? { description: input.toolInput.description }
      : {}),
    ...(input.targetViewId
      ? { target_view_id: input.targetViewId }
      : {}),
    datasource_id: input.toolInput.datasource_id,
    table: input.toolInput.table,
    ...(input.toolInput.data_mode ? { data_mode: input.toolInput.data_mode } : {}),
    fields: toStageChartFields(input.toolInput.fields),
    ...(timeGrain ? { time_grain: timeGrain } : {}),
    ...(input.toolInput.sort ? { sort: input.toolInput.sort } : {}),
    ...(typeof input.toolInput.limit === "number" ? { limit: input.toolInput.limit } : {}),
    ...(input.toolInput.filters ? { filters: input.toolInput.filters } : {}),
    ...(input.layout ? { layout: input.layout } : {}),
    ...(input.toolInput.mock_data ? { mock_data: input.toolInput.mock_data } : {}),
    ...(input.toolInput.mock_value !== undefined
      ? { mock_value: input.toolInput.mock_value }
      : {}),
  };
}

function layoutOverrideFromItem(
  item: DashboardLayoutItem | undefined,
): Partial<DashboardLayoutItem> | undefined {
  if (!item) {
    return undefined;
  }
  return {
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  };
}

function liveQueryIdsForBindings(bindings: Binding[]): string[] {
  return [
    ...new Set(
      bindings
        .filter((binding) => isLiveBinding(binding))
        .map((binding) => binding.query_id),
    ),
  ];
}

function buildTargetReplacementBase(input: {
  document: DashboardDocument;
  targetViewId: string;
}): {
  baseDocument: DashboardDocument;
  layout?: StageChartToolInput["layout"];
  removedBindingIds: string[];
  removedPrivateQueryIds: string[];
} {
  resolveRequiredView(input.document, input.targetViewId);
  const oldLayout = getLayoutItemsForView(input.document, input.targetViewId);
  const removedBindings = input.document.bindings.filter(
    (binding) => binding.view_id === input.targetViewId,
  );
  const removedBindingIds = removedBindings.map((binding) => binding.id);
  const removedPrivateQueryIds = liveQueryIdsForBindings(removedBindings).filter(
    (queryId) =>
      !input.document.bindings.some(
        (binding) =>
          binding.view_id !== input.targetViewId &&
          isLiveBinding(binding) &&
          binding.query_id === queryId,
      ),
  );

  let baseDocument = removeViewFromDocument(input.document, input.targetViewId);
  for (const queryId of removedPrivateQueryIds) {
    baseDocument = removeQueryFromDocument(baseDocument, queryId);
  }
  const desktop = layoutOverrideFromItem(oldLayout.desktop);
  const mobile = layoutOverrideFromItem(oldLayout.mobile);
  const layout: StageChartToolInput["layout"] = {
    ...(desktop ? { desktop } : {}),
    ...(mobile ? { mobile } : {}),
  };

  return {
    baseDocument,
    ...(Object.keys(layout).length > 0 ? { layout } : {}),
    removedBindingIds,
    removedPrivateQueryIds,
  };
}

export function buildStageViewIntentTool(input: {
  dashboard: DashboardDocument;
  checks?: ViewCheckSnapshot[] | null;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  getActiveGoalId?: () => string | null | undefined;
  markWorkingDraftUpdated: () => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
  buildDraftStatus: () => DraftStatusToolOutput;
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
}) {
  return defineTool({
    name: "stageViewIntent",
    label: "Stage View Intent",
    description: STAGE_VIEW_INTENT_TOOL_DESCRIPTION,
    contract: {
      parameters: [
        "Provide only semantic view_kind, title, datasource_id, table, field role mappings, aggregation/filter/sort/limit intent, optional mock data/value, and optional target view id.",
        "Runtime compiles the semantic view intent through the active dashboard template and stages query, view, bindings, and layout atomically.",
      ],
      prohibited: [
        "renderer implementation identifiers, renderer, renderer slots, layout, view_style_id, SQL, QueryDef.output, and binding ids; runtime owns these.",
      ],
      preconditions: [
        "Use a supported semantic view_kind and known datasource table/field names before staging live views.",
      ],
    },
    parameters: stageViewIntentInputSchema,
    executionMode: "sequential",
    execute: async (
      toolInput: StageViewIntentToolInput,
    ): Promise<StageViewIntentToolOutput> => {
      const beforeDocument = input.buildCandidateDocument(
        input.dashboard,
        input.workingDraft,
      );
      const explicitTargetViewId = toolInput.target_view_id;
      const focusedTargetViewId =
        input.focusedViewId &&
        beforeDocument.dashboard_spec.views.some(
          (view) => view.id === input.focusedViewId,
        )
          ? input.focusedViewId
          : undefined;
      const replacementTargetViewId = explicitTargetViewId ?? focusedTargetViewId;
      const viewId = replacementTargetViewId ?? undefined;
      if (
        explicitTargetViewId &&
        input.focusedViewId &&
        explicitTargetViewId !== input.focusedViewId
      ) {
        throw new Error(
          `Focused replacement can only replace the selected view "${input.focusedViewId}".`,
        );
      }
      const viewIntent = buildViewIntent(toolInput);
      const compilePlan = compileDashboardViewIntent({
        dashboard: beforeDocument,
        viewId,
        title: toolInput.title,
        description: toolInput.description,
        intent: viewIntent,
      });
      const replacement = replacementTargetViewId
        ? buildTargetReplacementBase({
            document: beforeDocument,
            targetViewId: replacementTargetViewId,
          })
        : null;
      const chartInput = toStageChartInput({
        toolInput,
        skillId: compilePlan.recipeId,
        layout: replacement?.layout,
        targetViewId: replacementTargetViewId,
      });
      const result = await stageChartTransaction({
        ...input,
        baseDocument: replacement?.baseDocument ?? beforeDocument,
        toolInput: chartInput,
        forcedViewId: replacementTargetViewId,
        viewIntent,
        preserveLayoutY: Boolean(replacement),
      });
      for (const queryId of replacement?.removedPrivateQueryIds ?? []) {
        input.workingDraft.dirtyQueryIds.add(queryId);
      }
      for (const bindingId of replacement?.removedBindingIds ?? []) {
        input.workingDraft.dirtyBindingIds.add(bindingId);
      }
      if (replacement) {
        input.markWorkingDraftUpdated();
      }
      const draftStatus = replacement
        ? input.buildDraftStatus()
        : result.output.draft_status;
      return {
        ...result.output,
        summary: result.output.summary.replace(/^Staged chart/, "Staged view intent"),
        blockers: draftStatus.blockers,
        draft_status: draftStatus,
        view_kind: viewIntent.view_kind,
      };
    },
  });
}
