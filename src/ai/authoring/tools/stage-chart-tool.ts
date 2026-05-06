import { createHash } from "node:crypto";
import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRendererSlot,
  QueryDef,
} from "@/contracts";
import type {
  DraftStatusToolOutput,
  StageChartFieldInput,
  StageChartFieldRole,
  StageChartToolInput,
  StageChartToolOutput,
  ViewCheckSnapshot,
} from "@/ai/authoring/contracts/tool-io";
import {
  buildBindingDetail,
} from "@/ai/authoring/contracts/tool-io";
import type { MutationDescriptor } from "@/ai/authoring/contracts/mutations";
import type {
  StageChartFieldMappings,
  StageChartSlotBindingTemplate,
} from "@/ai/authoring/skills/contract";
import { getStageChartBuilder, listStageChartSkillIds } from "@/ai/authoring/skills/registry";
import {
  cloneBinding,
  cloneDashboardSpec,
  cloneQuery,
  markWorkingDraftArtifactOwner,
  type WorkingDraftState,
} from "@/ai/authoring/tools/draft-state";
import {
  buildQueryDetail,
  buildViewDetail,
  findCheckSnapshot,
  resolveRequiredView,
} from "@/ai/authoring/tools/detail-builders";
import { tool } from "@/ai/authoring/tools/definition";
import { stageChartInputSchema } from "@/ai/authoring/tools/schemas";
import {
  upsertBindingInDocument,
  upsertQueryInDocument,
  upsertViewInDocument,
} from "@/domain/dashboard/document";

const STAGE_CHART_TOOL_DESCRIPTION = [
  "Stage one complete chart transaction into the working draft.",
  "Use this as the normal write path for creating or revising a chart.",
  "The model supplies business intent, SQL/query output, and field mappings; the runtime skill builder creates renderer.option_template, slots, stable ids, bindings, and layout.",
  "Do not use low-level upsertQuery/upsertView/upsertBinding for ordinary chart creation.",
  "For live charts, provide query.sql_template, query.output, and the mapped query result fields.",
  "For mock charts, provide mock_data or mock_value and field mappings.",
].join(" ");

function cloneDocument(document: DashboardDocument): DashboardDocument {
  return JSON.parse(JSON.stringify(document)) as DashboardDocument;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function slugify(value: string): string {
  const ascii = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return ascii || "chart";
}

function buildStableStem(input: StageChartToolInput): string {
  const seed = [
    input.goal_id,
    input.skill_id,
    input.title,
    input.datasource_id,
    input.table,
    input.query?.sql_template,
  ]
    .filter(Boolean)
    .join("|");
  return `${slugify(input.title)}_${stableHash(seed)}`;
}

function buildLayoutItem(input: {
  document: DashboardDocument;
  breakpoint: "desktop" | "mobile";
  viewId: string;
  defaults: Pick<DashboardLayoutItem, "w" | "h">;
  override?: Partial<DashboardLayoutItem>;
}): DashboardLayoutItem {
  const layout = input.document.dashboard_spec.layout[input.breakpoint];
  const cols = layout?.cols ?? (input.breakpoint === "mobile" ? 4 : 12);
  const nextY = (layout?.items ?? []).reduce(
    (maxY, item) => Math.max(maxY, item.y + item.h),
    0,
  );
  return {
    view_id: input.viewId,
    x: input.override?.x ?? 0,
    y: input.override?.y ?? nextY,
    w: input.override?.w ?? Math.min(input.defaults.w, cols),
    h: input.override?.h ?? input.defaults.h,
  };
}

function pathExists(value: unknown, path: string): boolean {
  const parts = path.match(/[^.[\]]+|\[(\d+)\]/g) ?? [];
  let current = value;
  for (const rawPart of parts) {
    const indexMatch = rawPart.match(/^\[(\d+)\]$/);
    const key: string | number = indexMatch ? Number(indexMatch[1]) : rawPart;
    if (typeof key === "number") {
      if (!Array.isArray(current) || key < 0 || key >= current.length) {
        return false;
      }
      current = current[key];
      continue;
    }
    if (typeof current !== "object" || current === null || !(key in current)) {
      return false;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

function assertRendererContract(slots: DashboardRendererSlot[], optionTemplate: unknown) {
  for (const slot of slots) {
    if (!pathExists(optionTemplate, slot.path)) {
      throw new Error(
        `Skill builder produced invalid renderer slot "${slot.id}": path "${slot.path}" does not exist in option_template.`,
      );
    }
  }
}

function resolveField(
  fields: StageChartFieldMappings,
  role: StageChartFieldRole,
): StageChartFieldInput | null {
  const direct = fields[role];
  if (direct) {
    return direct;
  }
  if (role === "metric") {
    return fields.value ?? null;
  }
  if (role === "value") {
    return fields.metric ?? null;
  }
  return null;
}

function buildResultSelector(input: {
  query: QueryDef;
  bindingTemplate: StageChartSlotBindingTemplate;
  field: StageChartFieldInput;
}): string | null {
  if (input.query.output.kind !== "rows") {
    return null;
  }
  if (input.bindingTemplate.value_kind === "array") {
    return `rows[].${input.field.result_field}`;
  }
  return `rows[0].${input.field.result_field}`;
}

function assertFieldExistsInQueryOutput(input: {
  query: QueryDef | null;
  bindingTemplate: StageChartSlotBindingTemplate;
  field: StageChartFieldInput;
}) {
  const output = input.query?.output;
  if (!output || (output.kind !== "rows" && output.kind !== "object")) {
    return;
  }
  if (output.schema.some((field) => field.name === input.field.result_field)) {
    return;
  }

  throw new Error(
    `stageChart field "${input.field.result_field}" for slot "${input.bindingTemplate.slot_id}" was not found in query.output.schema.`,
  );
}

function buildBindings(input: {
  toolInput: StageChartToolInput;
  viewId: string;
  query: QueryDef | null;
  templates: StageChartSlotBindingTemplate[];
}): Binding[] {
  const mode = input.toolInput.data_mode ?? (input.query ? "live" : "mock");
  if (mode === "live" && !input.query) {
    throw new Error("stageChart live mode requires query.sql_template and query.output.");
  }

  return input.templates.map((template) => {
    const field = resolveField(input.toolInput.fields, template.field_role);
    if (!field) {
      throw new Error(
        `stageChart requires fields.${template.field_role}.result_field for skill slot "${template.slot_id}".`,
      );
    }
    assertFieldExistsInQueryOutput({
      query: input.query,
      bindingTemplate: template,
      field,
    });

    const bindingId = `b_${slugify(input.viewId)}_${slugify(template.slot_id)}`;
    if (mode === "mock") {
      return {
        id: bindingId,
        view_id: input.viewId,
        slot_id: template.slot_id,
        mode: "mock",
        ...(template.value_kind === "scalar"
          ? { mock_value: input.toolInput.mock_value ?? 0 }
          : {
              mock_data:
                input.toolInput.mock_data ?? {
                  rows: [{ [field.result_field]: template.value_kind === "array" ? "Sample" : 0 }],
                },
            }),
      };
    }

    return {
      id: bindingId,
      view_id: input.viewId,
      slot_id: template.slot_id,
      mode: "live",
      query_id: input.query?.id,
      param_mapping: {},
      result_selector: buildResultSelector({
        query: input.query as QueryDef,
        bindingTemplate: template,
        field,
      }),
    };
  });
}

function buildQuery(input: {
  toolInput: StageChartToolInput;
  queryId: string;
}): QueryDef | null {
  const query = input.toolInput.query;
  if (!query) {
    return null;
  }
  const datasourceId = query.datasource_id ?? input.toolInput.datasource_id;
  if (!datasourceId) {
    throw new Error("stageChart query requires datasource_id either at top level or inside query.");
  }
  return {
    id: query.query_id ?? input.queryId,
    name: query.name ?? input.toolInput.title,
    datasource_id: datasourceId,
    sql_template: query.sql_template,
    params: query.params ?? [],
    output: query.output,
  };
}

export function buildStageChartTool(input: {
  dashboard: DashboardDocument;
  checks?: ViewCheckSnapshot[] | null;
  focusedViewId: string | null;
  workingDraft: WorkingDraftState;
  getActiveGoalId?: () => string | null | undefined;
  markWorkingDraftUpdated: () => void;
  recordMutation: (mutation: MutationDescriptor) => void;
  buildCandidateDocument: (
    dashboard: DashboardDocument,
    workingDraft: WorkingDraftState,
  ) => DashboardDocument;
  buildDocumentFingerprint: (document: DashboardDocument) => string;
  buildDraftStatus: () => DraftStatusToolOutput;
}) {
  return tool({
    description: STAGE_CHART_TOOL_DESCRIPTION,
    inputSchema: stageChartInputSchema,
    execute: async (toolInput: StageChartToolInput): Promise<StageChartToolOutput> => {
      const builder = getStageChartBuilder(toolInput.skill_id);
      if (!builder) {
        throw new Error(
          `Unsupported chart skill "${toolInput.skill_id}". Use one of: ${listStageChartSkillIds().join(", ")}.`,
        );
      }

      const beforeDocument = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const beforeFingerprint = input.buildDocumentFingerprint(beforeDocument);
      const stem = buildStableStem(toolInput);
      const viewId = input.focusedViewId ?? toolInput.target_view_id ?? `v_${stem}`;
      const queryId = toolInput.query?.query_id ?? `q_${stem}`;
      const transactionId = `txn_${stableHash(`${viewId}|${queryId}|${toolInput.skill_id}`)}`;
      const query = buildQuery({ toolInput, queryId });
      const built = builder.build({
        title: toolInput.title,
        description: toolInput.description,
        queryOutput: query?.output ?? null,
        fields: toolInput.fields,
      });
      assertRendererContract(built.renderer.slots, built.renderer.option_template);

      let nextDocument = cloneDocument(beforeDocument);
      if (query) {
        nextDocument = upsertQueryInDocument(nextDocument, query);
      }
      nextDocument = upsertViewInDocument(
        nextDocument,
        {
          id: viewId,
          title: toolInput.title.trim(),
          description: toolInput.description?.trim() || undefined,
          renderer: built.renderer,
        },
        {
          desktopItem: buildLayoutItem({
            document: nextDocument,
            breakpoint: "desktop",
            viewId,
            defaults: built.layout.desktop,
            override: toolInput.layout?.desktop,
          }),
          mobileItem: buildLayoutItem({
            document: nextDocument,
            breakpoint: "mobile",
            viewId,
            defaults: built.layout.mobile,
            override: toolInput.layout?.mobile,
          }),
        },
      );

      const bindings = buildBindings({
        toolInput,
        viewId,
        query,
        templates: built.bindings,
      });
      for (const binding of bindings) {
        nextDocument = upsertBindingInDocument(nextDocument, binding);
      }

      const afterFingerprint = input.buildDocumentFingerprint(nextDocument);
      const alreadyStaged = beforeFingerprint === afterFingerprint;

      const ownerGoalId = toolInput.goal_id ?? input.getActiveGoalId?.();
      input.workingDraft.dashboardSpec = cloneDashboardSpec(nextDocument.dashboard_spec);
      input.workingDraft.queryDefs = nextDocument.query_defs.map(cloneQuery);
      input.workingDraft.bindings = nextDocument.bindings.map(cloneBinding);
      input.workingDraft.bindingMode = toolInput.data_mode ?? (query ? "live" : "mock");
      input.workingDraft.dirtyViewIds.add(viewId);
      input.workingDraft.layoutTouched = true;
      if (query) {
        input.workingDraft.dirtyQueryIds.add(query.id);
      }
      for (const binding of bindings) {
        input.workingDraft.dirtyBindingIds.add(binding.id);
      }
      markWorkingDraftArtifactOwner({
        workingDraft: input.workingDraft,
        goalId: ownerGoalId,
        artifactKind: "view",
        artifactId: viewId,
      });
      markWorkingDraftArtifactOwner({
        workingDraft: input.workingDraft,
        goalId: ownerGoalId,
        artifactKind: "layout",
        artifactId: viewId,
      });
      if (query) {
        markWorkingDraftArtifactOwner({
          workingDraft: input.workingDraft,
          goalId: ownerGoalId,
          artifactKind: "query",
          artifactId: query.id,
        });
      }
      for (const binding of bindings) {
        markWorkingDraftArtifactOwner({
          workingDraft: input.workingDraft,
          goalId: ownerGoalId,
          artifactKind: "binding",
          artifactId: binding.id,
        });
      }

      input.markWorkingDraftUpdated();
      input.recordMutation({ kind: "view", view_id: viewId });
      input.recordMutation({ kind: "layout", view_id: viewId });
      if (query) {
        input.recordMutation({ kind: "query", query_id: query.id, affected_view_ids: [viewId] });
      }
      for (const binding of bindings) {
        input.recordMutation({ kind: "binding", binding_id: binding.id, view_id: viewId });
      }

      const candidate = input.buildCandidateDocument(input.dashboard, input.workingDraft);
      const view = resolveRequiredView(candidate, viewId);
      const queryDetail = query
        ? buildQueryDetail(candidate, candidate.query_defs.find((candidateQuery) => candidateQuery.id === query.id) ?? query)
        : undefined;
      const bindingDetails = candidate.bindings
        .filter((binding) => bindings.some((created) => created.id === binding.id))
        .map((binding) =>
          buildBindingDetail({
            binding,
            view,
            query: binding.query_id
              ? candidate.query_defs.find((candidateQuery) => candidateQuery.id === binding.query_id)
              : undefined,
          }),
        );
      const draftStatus = input.buildDraftStatus();

      return {
        summary: alreadyStaged
          ? `Chart "${view.title}" was already staged by this transaction.`
          : `Staged chart "${view.title}" as one transaction.`,
        transaction_id: transactionId,
        stage: "staged",
        artifact_ids: {
          view_id: viewId,
          ...(query ? { query_id: query.id } : {}),
          binding_ids: bindings.map((binding) => binding.id),
        },
        blockers: draftStatus.blockers,
        view: buildViewDetail({
          document: candidate,
          view,
          latestCheck: findCheckSnapshot(input.checks, view.id),
        }),
        ...(queryDetail ? { query: queryDetail } : {}),
        bindings: bindingDetails,
        draft_status: draftStatus,
      };
    },
  });
}
