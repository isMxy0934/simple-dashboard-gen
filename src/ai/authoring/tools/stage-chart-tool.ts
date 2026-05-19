import type {
  Binding,
  DashboardDocument,
  DatasourceContext,
  QueryDef,
} from "@/contracts";
import type {
  DraftStatusToolOutput,
  StageChartToolInput,
  StageChartToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import {
  buildBindingDetail,
} from "@/ai/authoring/contracts/tool-io";
import { getStageChartBuilder, listStageChartSkillIds } from "@/ai/authoring/skills/registry";
import { defineTool } from "@/ai/authoring/tools/definition";
import { stageChartInputSchema } from "@/ai/authoring/tools/schemas";
import {
  findDatasourceTable,
  buildMissingTableMessage,
} from "@/ai/authoring/tools/datasource-schema-utils";
import {
  upsertBindingInDocument,
  upsertQueryInDocument,
  upsertViewInDocument,
} from "@/domain/dashboard/document";
import { resolveViewPresentationContext } from "@/domain/dashboard/presentation-context";
import {
  cloneDocument,
  stableHash,
  buildStableStem,
  buildLayoutItem,
  assertRendererContract,
  resolveSourceFields,
} from "@/ai/authoring/tools/stage-chart-resolve";
import {
  buildQuery,
  buildBindings,
} from "@/ai/authoring/tools/stage-chart-query";
import type { WorkingDraftState } from "@/ai/authoring/tools/draft-state";
import { applyStagedChartToDraft } from "@/ai/authoring/tools/stage-chart-draft";
import {
  buildQueryDetail,
  buildViewDetail,
  findCheckSnapshot,
  resolveRequiredView,
} from "@/ai/authoring/tools/detail-builders";

const STAGE_CHART_TOOL_DESCRIPTION = [
  "Stage one complete chart transaction into the working draft.",
  "Use this as the normal write path for creating or revising a chart.",
  "The model supplies chart intent and datasource field mappings; runtime loads schema, generates SQL/query output, renderer, stable ids, bindings, and layout.",
  "Do not provide SQL, QueryDef.output, renderer.option_template, binding ids, or layout defaults.",
  "Use target_view_id for in-place revisions; use stageReplaceChart for delete-and-rebuild replacement work.",
  "For mock charts, provide mock_data or mock_value and field mappings.",
].join(" ");

export interface StageChartTransactionInput {
  toolInput: StageChartToolInput;
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
  baseDocument?: DashboardDocument;
  forcedViewId?: string;
}

export interface StageChartTransactionResult {
  output: StageChartToolOutput;
  candidate: DashboardDocument;
  viewId: string;
  query: QueryDef | null;
  bindings: Binding[];
}

export async function stageChartTransaction(
  input: StageChartTransactionInput,
): Promise<StageChartTransactionResult> {
  const { toolInput } = input;
  const builder = getStageChartBuilder(toolInput.skill_id);
  if (!builder) {
    const focusedView = input.focusedViewId
      ? input.dashboard.dashboard_spec.views.find((v) => v.id === input.focusedViewId)
      : null;
    const rendererKind = focusedView?.renderer?.kind ?? null;
    const availableIds = listStageChartSkillIds();
    const rendererHint = rendererKind
      ? ` The current view uses renderer_kind "${rendererKind}".`
      : "";
    throw new Error(
      `missing_skill: skill "${toolInput.skill_id}" is not loaded.${rendererHint}` +
        ` recoveryHint: call loadSkill with a skill id that matches the renderer_kind, then retry stageChart.` +
        ` Available skill ids: ${availableIds.join(", ")}.`,
    );
  }
  const beforeDocument =
    input.baseDocument ??
    input.buildCandidateDocument(input.dashboard, input.workingDraft);
  const beforeFingerprint = input.buildDocumentFingerprint(beforeDocument);
  const schema = await input.getDatasourceSchema(toolInput.datasource_id);
  const table = findDatasourceTable(schema, toolInput.table);
  if (!table) {
    throw new Error(buildMissingTableMessage(schema, toolInput.table));
  }
  const resolvedFields = resolveSourceFields({ table, fields: toolInput.fields });
  const stem = buildStableStem(toolInput);
  const viewId =
    input.forcedViewId ?? toolInput.target_view_id ?? input.focusedViewId ?? `v_${stem}`;
  const queryId = `q_${stem}`;
  const transactionId = `txn_${stableHash(`${viewId}|${queryId}|${toolInput.skill_id}`)}`;
  const query = buildQuery({ toolInput, queryId, schema, table, fields: resolvedFields });
  const themeId = resolveViewPresentationContext(beforeDocument).chartPresentation.themeId;
  const built = builder.build({
    title: toolInput.title,
    description: toolInput.description,
    queryOutput: query?.output ?? null,
    fields: resolvedFields as Record<string, { source_field: string; result_field: string; label?: string; type?: string; aggregation?: string }>,
    themeId,
  });
  assertRendererContract(
    built.renderer.slots,
    built.renderer.option_template,
    built.renderer.transforms,
  );
  let nextDocument = cloneDocument(beforeDocument);
  if (query) {
    nextDocument = upsertQueryInDocument(nextDocument, query);
  }
  nextDocument = upsertViewInDocument(nextDocument, {
    id: viewId, title: toolInput.title.trim(),
    description: toolInput.description?.trim() || undefined,
    renderer: built.renderer,
  }, {
    desktopItem: buildLayoutItem({ document: nextDocument, breakpoint: "desktop", viewId, defaults: built.layout.desktop, override: toolInput.layout?.desktop }),
    mobileItem: buildLayoutItem({ document: nextDocument, breakpoint: "mobile", viewId, defaults: built.layout.mobile, override: toolInput.layout?.mobile }),
  });
  const bindings = buildBindings({ toolInput, viewId, query, templates: built.bindings, fields: resolvedFields });
  for (const binding of bindings) {
    nextDocument = upsertBindingInDocument(nextDocument, binding);
  }
  const afterFingerprint = input.buildDocumentFingerprint(nextDocument);
  const alreadyStaged = beforeFingerprint === afterFingerprint;
  applyStagedChartToDraft({
    nextDocument,
    viewId,
    query,
    bindings,
    dataMode: toolInput.data_mode,
    ownerGoalId: toolInput.goal_id ?? input.getActiveGoalId?.(),
    workingDraft: input.workingDraft,
    markWorkingDraftUpdated: input.markWorkingDraftUpdated,
  });
  const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
  const view = resolveRequiredView(candidate, viewId);
  const queryDetail = query
    ? buildQueryDetail(candidate, candidate.query_defs.find((q) => q.id === query.id) ?? query)
    : undefined;
  const bindingDetails = candidate.bindings
    .filter((b) => bindings.some((created) => created.id === b.id))
    .map((b) => buildBindingDetail({ binding: b, view, query: b.query_id ? candidate.query_defs.find((q) => q.id === b.query_id) : undefined }));
  const draftStatus = input.buildDraftStatus();
  const output: StageChartToolOutput = {
    summary: alreadyStaged
      ? `Chart "${view.title}" was already staged by this transaction.`
      : `Staged chart "${view.title}" as one transaction.`,
    transaction_id: transactionId,
    stage: "staged",
    artifact_ids: { view_id: viewId, ...(query ? { query_id: query.id } : {}), binding_ids: bindings.map((b) => b.id) },
    blockers: draftStatus.blockers,
    view: buildViewDetail({ document: candidate, view, latestCheck: findCheckSnapshot(input.checks, view.id) }),
    ...(queryDetail ? { query: queryDetail } : {}),
    bindings: bindingDetails,
    draft_status: draftStatus,
  };
  return { output, candidate, viewId, query, bindings };
}

export function buildStageChartTool(input: {
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
    name: "stageChart",
    label: "Stage Chart",
    description: STAGE_CHART_TOOL_DESCRIPTION,
    contract: {
      parameters: [
        "Provide only skill_id, title, datasource_id, table, field role mappings, aggregation/filter/sort/limit intent, optional layout intent, optional mock data/value, and optional target view id.",
        "Every required renderer slot must be covered by the transaction for the active data mode.",
      ],
      prohibited: [
        "SQL, QueryDef.output, renderer.option_template, renderer slots, binding ids, and layout defaults; runtime owns these.",
      ],
      preconditions: [
        "Use an available chart skill id and known datasource table/field names before staging live charts.",
        "stageChart stages query, view, bindings, and layout atomically; if it fails, do not continue with dependent low-level writes.",
      ],
    },
    parameters: stageChartInputSchema,
    executionMode: "sequential",
    execute: async (toolInput: StageChartToolInput): Promise<StageChartToolOutput> => {
      const result = await stageChartTransaction({
        ...input,
        toolInput,
      });
      return result.output;
    },
  });
}
