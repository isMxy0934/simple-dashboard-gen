import { createHash } from "node:crypto";
import type {
  Binding,
  DashboardDocument,
  DashboardLayoutItem,
  DashboardRendererSlot,
  DatasourceContext,
  DatasourceField,
  DatasourceTable,
  QueryDef,
  QueryParamType,
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
  buildMissingFieldMessage,
  buildMissingTableMessage,
  findDatasourceField,
  findDatasourceTable,
  quoteQualifiedSqlName,
  quoteSqlIdentifier,
  shortName,
  standardQueryType,
} from "@/ai/authoring/tools/datasource-schema-utils";
import {
  upsertBindingInDocument,
  upsertQueryInDocument,
  upsertViewInDocument,
} from "@/domain/dashboard/document";

const STAGE_CHART_TOOL_DESCRIPTION = [
  "Stage one complete chart transaction into the working draft.",
  "Use this as the normal write path for creating or revising a chart.",
  "The model supplies chart intent and datasource field mappings; runtime loads schema, generates SQL/query output, renderer, stable ids, bindings, and layout.",
  "Do not provide SQL, QueryDef.output, renderer.option_template, binding ids, or layout defaults.",
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
    JSON.stringify(input.fields),
    input.time_grain,
    JSON.stringify(input.sort),
    JSON.stringify(input.filters),
    input.target_view_id,
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
  if (typeof optionTemplate !== "object" || optionTemplate === null || Array.isArray(optionTemplate)) {
    throw new Error("Skill builder produced invalid renderer: option_template must be a non-null object.");
  }
  if (slots.length === 0) {
    throw new Error("Skill builder produced invalid renderer: slots must be non-empty.");
  }
  for (const slot of slots) {
    if (!pathExists(optionTemplate, slot.path)) {
      throw new Error(
        `Skill builder produced invalid renderer slot "${slot.id}": path "${slot.path}" does not exist in option_template.`,
      );
    }
  }
}

type ResolvedStageChartField = StageChartFieldInput & {
  result_field: string;
  source_field: string;
  source: DatasourceField;
};

type ResolvedStageChartFields = Partial<
  Record<StageChartFieldRole, ResolvedStageChartField>
>;

function resolveField(
  fields: ResolvedStageChartFields,
  role: StageChartFieldRole,
): ResolvedStageChartField | null {
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

function requiredRole(input: {
  fields: ResolvedStageChartFields;
  role: StageChartFieldRole;
  label: string;
}): ResolvedStageChartField {
  const field = resolveField(input.fields, input.role);
  if (!field) {
    throw new Error(`stageChart requires fields.${input.label}.source_field.`);
  }
  return field;
}

function defaultAggregation(field: DatasourceField): string {
  if (field.aggregations?.includes("avg")) {
    return field.name.toLowerCase().includes("rate") ? "avg" : field.aggregations[0] ?? "sum";
  }
  return field.aggregations?.[0] ?? "sum";
}

function normalizeAggregation(field: DatasourceField, requested?: string): string {
  const aggregation = (requested ?? defaultAggregation(field)).toLowerCase();
  if (!["sum", "avg", "count", "min", "max"].includes(aggregation)) {
    throw new Error(`Unsupported aggregation "${aggregation}". Use sum, avg, count, min, or max.`);
  }
  if (aggregation !== "count" && field.type !== "number") {
    throw new Error(`Aggregation "${aggregation}" requires a numeric field; "${shortName(field.name)}" is ${field.type}.`);
  }
  return aggregation;
}

function literalSql(value: string | number | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Filter value must be a finite number.");
    }
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function filterOperator(op: NonNullable<StageChartToolInput["filters"]>[number]["op"]): string {
  switch (op) {
    case "eq":
      return "=";
    case "neq":
      return "<>";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
  }
}

function buildWhereClause(input: {
  table: DatasourceTable;
  filters: StageChartToolInput["filters"];
}): string {
  if (!input.filters?.length) {
    return "";
  }
  const clauses = input.filters.map((filter) => {
    const field = findDatasourceField(input.table, filter.field);
    if (!field) {
      throw new Error(buildMissingFieldMessage(input.table, filter.field));
    }
    return `${quoteSqlIdentifier(shortName(field.name))} ${filterOperator(filter.op)} ${literalSql(filter.value)}`;
  });
  return ` where ${clauses.join(" and ")}`;
}

function timeExpression(input: {
  schema: DatasourceContext;
  field: DatasourceField;
  timeGrain?: StageChartToolInput["time_grain"];
}): { sql: string; type: QueryParamType } {
  const source = quoteSqlIdentifier(shortName(input.field.name));
  if (!input.timeGrain || input.timeGrain === "day") {
    return { sql: source, type: standardQueryType(input.field) };
  }
  if (input.schema.dialect !== "postgres") {
    throw new Error(`time_grain "${input.timeGrain}" is only supported for postgres in stageChart.`);
  }
  if (input.field.type !== "date" && input.field.type !== "datetime") {
    throw new Error(`time_grain requires a date or datetime field; "${shortName(input.field.name)}" is ${input.field.type}.`);
  }
  return {
    sql: `date_trunc('${input.timeGrain}', ${source})::date`,
    type: "date",
  };
}

function metricExpression(field: ResolvedStageChartField): string {
  const aggregation = normalizeAggregation(field.source, field.aggregation);
  const source = quoteSqlIdentifier(shortName(field.source.name));
  return aggregation === "count"
    ? `count(${source})`
    : `${aggregation}(${source})`;
}

function selectAlias(sql: string, alias: string): string {
  return `${sql} as ${quoteSqlIdentifier(alias)}`;
}

function outputField(input: {
  name: string;
  type: QueryParamType;
  nullable?: boolean;
}) {
  return {
    name: input.name,
    type: input.type,
    nullable: input.nullable ?? true,
  };
}

function resolveSourceFields(input: {
  table: DatasourceTable;
  fields: StageChartToolInput["fields"];
}): ResolvedStageChartFields {
  const out: ResolvedStageChartFields = {};
  const setField = (role: StageChartFieldRole, alias: string) => {
    const fieldInput = input.fields[role];
    if (!fieldInput) {
      return;
    }
    const source = findDatasourceField(input.table, fieldInput.source_field);
    if (!source) {
      throw new Error(buildMissingFieldMessage(input.table, fieldInput.source_field));
    }
    out[role] = {
      ...fieldInput,
      source_field: source.name,
      result_field: alias,
      type: fieldInput.type ?? standardQueryType(source),
      aggregation: fieldInput.aggregation,
      source,
    };
  };
  setField("time", "time_value");
  setField("category", "category_name");
  setField("metric", "metric_value");
  setField("value", "metric_value");
  if (!out.value && out.metric) {
    out.value = { ...out.metric };
  }
  if (!out.metric && out.value) {
    out.metric = { ...out.value };
  }
  return out;
}

function buildResultSelector(input: {
  query: QueryDef;
  bindingTemplate: StageChartSlotBindingTemplate;
  field: ResolvedStageChartField;
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
  field: ResolvedStageChartField;
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
  fields: ResolvedStageChartFields;
}): Binding[] {
  const mode = input.toolInput.data_mode ?? (input.query ? "live" : "mock");
  if (mode === "live" && !input.query) {
    throw new Error("stageChart live mode requires runtime-generated query support for the selected chart skill.");
  }

  return input.templates.map((template) => {
    const field = resolveField(input.fields, template.field_role);
    if (!field) {
      throw new Error(
        `stageChart requires fields.${template.field_role}.source_field for skill slot "${template.slot_id}".`,
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
  schema: DatasourceContext;
  table: DatasourceTable;
  fields: ResolvedStageChartFields;
}): QueryDef | null {
  const mode = input.toolInput.data_mode ?? "live";
  if (mode === "mock") {
    return null;
  }
  const tableSql = quoteQualifiedSqlName(input.table.name);
  const whereClause = buildWhereClause({
    table: input.table,
    filters: input.toolInput.filters,
  });
  const limit = input.toolInput.limit;

  if (input.toolInput.skill_id === "echarts-line") {
    const time = requiredRole({ fields: input.fields, role: "time", label: "time" });
    const metric = requiredRole({ fields: input.fields, role: "metric", label: "metric" });
    const timeSql = timeExpression({
      schema: input.schema,
      field: time.source,
      timeGrain: input.toolInput.time_grain,
    });
    const sql = [
      `select ${selectAlias(timeSql.sql, time.result_field)}, ${selectAlias(metricExpression(metric), metric.result_field)}`,
      ` from ${tableSql}`,
      whereClause,
      " group by 1",
      ` order by 1 ${input.toolInput.sort?.direction ?? "asc"}`,
      limit ? ` limit ${limit}` : "",
    ].join("");
    return {
      id: input.queryId,
      name: input.toolInput.title,
      datasource_id: input.toolInput.datasource_id,
      sql_template: sql,
      params: [],
      output: {
        kind: "rows",
        schema: [
          outputField({ name: time.result_field, type: timeSql.type, nullable: time.source.nullable ?? true }),
          outputField({ name: metric.result_field, type: "number", nullable: true }),
        ],
      },
    };
  }

  if (input.toolInput.skill_id === "echarts-bar") {
    const category = requiredRole({ fields: input.fields, role: "category", label: "category" });
    const metric = requiredRole({ fields: input.fields, role: "metric", label: "metric" });
    const sortDirection = input.toolInput.sort?.direction ?? "desc";
    const sql = [
      `select ${selectAlias(quoteSqlIdentifier(shortName(category.source.name)), category.result_field)}, ${selectAlias(metricExpression(metric), metric.result_field)}`,
      ` from ${tableSql}`,
      whereClause,
      " group by 1",
      ` order by 2 ${sortDirection}`,
      ` limit ${limit ?? 10}`,
    ].join("");
    return {
      id: input.queryId,
      name: input.toolInput.title,
      datasource_id: input.toolInput.datasource_id,
      sql_template: sql,
      params: [],
      output: {
        kind: "rows",
        schema: [
          outputField({ name: category.result_field, type: standardQueryType(category.source), nullable: category.source.nullable ?? true }),
          outputField({ name: metric.result_field, type: "number", nullable: true }),
        ],
      },
    };
  }

  if (
    input.toolInput.skill_id === "echarts-kpi-text" ||
    input.toolInput.skill_id === "echarts-kpi-gauge"
  ) {
    const value = requiredRole({ fields: input.fields, role: "value", label: "value" });
    return {
      id: input.queryId,
      name: input.toolInput.title,
      datasource_id: input.toolInput.datasource_id,
      sql_template: `select ${selectAlias(metricExpression(value), value.result_field)} from ${tableSql}${whereClause}`,
      params: [],
      output: {
        kind: "scalar",
        value_type: "number",
      },
    };
  }

  throw new Error(`Unsupported stageChart skill "${input.toolInput.skill_id}".`);
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
  getDatasourceSchema: (datasourceId: string) => Promise<DatasourceContext>;
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
      const schema = await input.getDatasourceSchema(toolInput.datasource_id);
      const table = findDatasourceTable(schema, toolInput.table);
      if (!table) {
        throw new Error(buildMissingTableMessage(schema, toolInput.table));
      }
      const resolvedFields = resolveSourceFields({
        table,
        fields: toolInput.fields,
      });
      const stem = buildStableStem(toolInput);
      const viewId = input.focusedViewId ?? toolInput.target_view_id ?? `v_${stem}`;
      const queryId = `q_${stem}`;
      const transactionId = `txn_${stableHash(`${viewId}|${queryId}|${toolInput.skill_id}`)}`;
      const query = buildQuery({ toolInput, queryId, schema, table, fields: resolvedFields });
      const built = builder.build({
        title: toolInput.title,
        description: toolInput.description,
        queryOutput: query?.output ?? null,
        fields: resolvedFields as StageChartFieldMappings,
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
        fields: resolvedFields,
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
