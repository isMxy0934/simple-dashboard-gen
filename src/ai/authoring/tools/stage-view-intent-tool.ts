import type {
  DashboardDocument,
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

const STAGE_VIEW_INTENT_TOOL_DESCRIPTION = [
  "Stage one complete semantic view transaction into the working draft.",
  "Use this as the normal write path for creating or revising a dashboard view from business intent.",
  "Provide view_kind, title, datasource/table, field role mappings, aggregation/filter/sort/limit intent, and optional mock data/value.",
  "Do not provide skill ids, recipe ids, renderer contracts, layout, style ids, SQL, bindings, or query output.",
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
    ...(input.toolInput.target_view_id
      ? { target_view_id: input.toolInput.target_view_id }
      : {}),
    datasource_id: input.toolInput.datasource_id,
    table: input.toolInput.table,
    ...(input.toolInput.data_mode ? { data_mode: input.toolInput.data_mode } : {}),
    fields: toStageChartFields(input.toolInput.fields),
    ...(timeGrain ? { time_grain: timeGrain } : {}),
    ...(input.toolInput.sort ? { sort: input.toolInput.sort } : {}),
    ...(typeof input.toolInput.limit === "number" ? { limit: input.toolInput.limit } : {}),
    ...(input.toolInput.filters ? { filters: input.toolInput.filters } : {}),
    ...(input.toolInput.mock_data ? { mock_data: input.toolInput.mock_data } : {}),
    ...(input.toolInput.mock_value !== undefined
      ? { mock_value: input.toolInput.mock_value }
      : {}),
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
        "Runtime compiles the semantic view intent into the active design kit renderer and stages query, view, bindings, and layout atomically.",
      ],
      prohibited: [
        "skill_id, recipe_id, renderer, renderer slots, layout, view_style_id, SQL, QueryDef.output, and binding ids; runtime owns these.",
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
      const viewId = toolInput.target_view_id ?? input.focusedViewId ?? undefined;
      const viewIntent = buildViewIntent(toolInput);
      const compilePlan = compileDashboardViewIntent({
        dashboard: beforeDocument,
        viewId,
        title: toolInput.title,
        description: toolInput.description,
        intent: viewIntent,
      });
      const chartInput = toStageChartInput({
        toolInput,
        skillId: compilePlan.recipeId,
      });
      const result = await stageChartTransaction({
        ...input,
        baseDocument: beforeDocument,
        toolInput: chartInput,
        viewIntent,
      });
      return {
        ...result.output,
        summary: result.output.summary.replace(/^Staged chart/, "Staged view intent"),
        view_kind: viewIntent.view_kind,
      };
    },
  });
}
