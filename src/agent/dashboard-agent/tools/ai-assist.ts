import type {
  Binding,
  DashboardDocument,
  DatasourceField,
  DatasourceTable,
  DashboardView,
  DatasourceContext,
  QueryDef,
  QueryParamDef,
  QueryParamType,
  ResultSchemaField,
} from "@/contracts";
import type {
  AiSuggestion,
  AiSuggestionKind,
  ContractPatch,
  ContractPatchOperation,
  GenerateDataInput,
} from "./artifacts";
import { cloneDashboardDocument } from "@/domain/dashboard/document";
import {
  createBindingForView,
  createMockBindingForView,
} from "@/domain/dashboard/bindings";
import { collectEChartsTemplateFieldsFromView } from "@/renderers/echarts/summary";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function generateDataSuggestion(
  input: GenerateDataInput,
): Promise<AiSuggestion> {
  await delay(550);

  const useMockBindings = shouldGenerateMockBindings(input.prompt);

  if (!input.datasourceContext && !useMockBindings) {
    throw new Error(
      "DatasourceContext is unavailable, so AI data generation is disabled.",
    );
  }

  if (input.currentDocument.dashboard_spec.views.length === 0) {
    throw new Error(
      "Current draft has no views yet. Apply a layout draft before asking for query_defs and bindings.",
    );
  }

  const nextDocument = cloneDashboardDocument(input.currentDocument);
  const queryDefs = useMockBindings
    ? []
    : buildQueryDefsForViews(
        nextDocument.dashboard_spec.views,
        input.datasourceContext as DatasourceContext,
      );
  const bindings = useMockBindings
    ? buildMockBindingsForViews(nextDocument.dashboard_spec.views)
    : buildBindingsForViews(nextDocument.dashboard_spec.views, queryDefs);

  nextDocument.query_defs = queryDefs;
  nextDocument.bindings = bindings;

  return {
    id: `data-${Date.now()}`,
    kind: "data",
    title: "AI Query And Binding Draft",
    summary: useMockBindings
      ? "Generated mock bindings so the current views can preview with AI-filled rows."
      : "Generated query_defs and bindings from the PostgreSQL datasource snapshot, then mapped them onto the current views.",
    details: [
      useMockBindings
        ? "Used AI-generated sample rows for mock binding mode."
        : `Used datasource "${input.datasourceContext?.datasource_id}" with dialect "${input.datasourceContext?.dialect}".`,
      `Prepared ${queryDefs.length} query definitions and ${bindings.length} bindings for the current canvas.`,
      useMockBindings
        ? "Bound the current views to AI-generated mock rows so the layout can be reviewed before wiring live SQL."
        : "Built query_defs and bindings directly from the active datasource metadata and the current view templates.",
    ],
    patch: buildPatchFromDocument(input.currentDocument, nextDocument, "data"),
    dashboard: nextDocument,
  };
}

export function buildPatchFromDocument(
  currentDocument: DashboardDocument,
  nextDocument: DashboardDocument,
  kind: AiSuggestionKind,
): ContractPatch {
  const operations: ContractPatchOperation[] = [];
  const currentViews = new Map(
    currentDocument.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const nextViews = new Map(
    nextDocument.dashboard_spec.views.map((view) => [view.id, view]),
  );
  const currentQueries = new Map(
    currentDocument.query_defs.map((query) => [query.id, query]),
  );
  const nextQueries = new Map(
    nextDocument.query_defs.map((query) => [query.id, query]),
  );
  const currentBindings = new Map(
    currentDocument.bindings.map((binding) => [binding.id, binding]),
  );
  const nextBindings = new Map(
    nextDocument.bindings.map((binding) => [binding.id, binding]),
  );

  for (const view of nextDocument.dashboard_spec.views) {
    const previous = currentViews.get(view.id);
    operations.push({
      op: previous ? "update" : "add",
      path: `dashboard_spec.views.${view.id}`,
      summary: previous
        ? `Update view "${view.title}".`
        : `Add view "${view.title}".`,
    });
  }

  for (const view of currentDocument.dashboard_spec.views) {
    if (!nextViews.has(view.id)) {
      operations.push({
        op: "remove",
        path: `dashboard_spec.views.${view.id}`,
        summary: `Remove view "${view.title}".`,
      });
    }
  }

  if (
    JSON.stringify(currentDocument.dashboard_spec.layout) !==
    JSON.stringify(nextDocument.dashboard_spec.layout)
  ) {
    operations.push({
      op: "update",
      path: "dashboard_spec.layout",
      summary:
        kind === "layout"
          ? "Refresh desktop/mobile layout positions for the active canvas."
          : "Adjust layout references to keep views and bindings aligned.",
    });
  }

  for (const query of nextDocument.query_defs) {
    const previous = currentQueries.get(query.id);
    operations.push({
      op: previous ? "upsert" : "add",
      path: `query_defs.${query.id}`,
      summary: previous
        ? `Update query "${query.name}" (${query.id}).`
        : `Add query "${query.name}" (${query.id}).`,
    });
  }

  for (const query of currentDocument.query_defs) {
    if (!nextQueries.has(query.id)) {
      operations.push({
        op: "remove",
        path: `query_defs.${query.id}`,
        summary: `Remove query "${query.name}" (${query.id}).`,
      });
    }
  }

  for (const binding of nextDocument.bindings) {
    const previous = currentBindings.get(binding.id);
    operations.push({
      op: previous ? "upsert" : "add",
      path: `bindings.${binding.id}`,
      summary: previous
        ? `Update binding for view "${binding.view_id}".`
        : `Add binding for view "${binding.view_id}".`,
    });
  }

  for (const binding of currentDocument.bindings) {
    if (!nextBindings.has(binding.id)) {
      operations.push({
        op: "remove",
        path: `bindings.${binding.id}`,
        summary: `Remove binding for view "${binding.view_id}".`,
      });
    }
  }

  const uniqueOperations = dedupePatchOperations(operations);
  return {
    summary:
      kind === "layout"
        ? `Prepare ${uniqueOperations.length} layout-side contract updates.`
        : `Prepare ${uniqueOperations.length} data-side contract updates.`,
    operations: uniqueOperations,
  };
}

function dedupePatchOperations(
  operations: ContractPatchOperation[],
): ContractPatchOperation[] {
  const seen = new Set<string>();
  return operations.filter((operation) => {
    const key = `${operation.op}:${operation.path}:${operation.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildQueryDefsForViews(
  views: DashboardView[],
  datasourceContext: DatasourceContext,
): QueryDef[] {
  return views.map((view) => buildQueryForView(view, datasourceContext));
}

export function buildBindingsForViews(
  views: DashboardView[],
  queryDefs: QueryDef[],
): Binding[] {
  const queryById = new Map(queryDefs.map((query) => [query.id, query]));

  return views.map((view) => {
    const queryId = buildQueryIdForView(view.id);
    const query = queryById.get(queryId);
    if (!query) {
      throw new Error(`Missing AI query draft for ${view.id}.`);
    }

    return createBindingForView(view, query);
  });
}

export function buildMockBindingsForViews(views: DashboardView[]): Binding[] {
  return views.map((view) => createMockBindingForView(view));
}

export function shouldGenerateMockBindings(prompt: string) {
  return /(mock|sample|demo|placeholder|假的|模拟|样例|示例数据|mock 数据)/i.test(prompt);
}

function buildQueryForView(
  view: DashboardView,
  datasourceContext: DatasourceContext,
): QueryDef {
  const fields = collectEChartsTemplateFieldsFromView(view);
  const table = selectTableForView(fields, datasourceContext);
  const queryId = buildQueryIdForView(view.id);
  const params = buildQueryParamsForTable(table);
  const timeField = hasField(table, "week_start") ? "week_start" : undefined;
  const dimensionField = selectDimensionField(fields, table, timeField);
  const metricFields = selectMetricFields(fields, table);
  const selectFields = buildSelectFields(dimensionField, metricFields);
  const whereClause = buildWhereClause(table, timeField);
  const groupClause =
    dimensionField && metricFields.length > 0 ? ` group by ${dimensionField}` : "";
  const orderClause = buildOrderClause(dimensionField, metricFields);
  const sqlTemplate =
    `select ${selectFields.join(", ")} from ${table.name}${whereClause}${groupClause}${orderClause}`.trim();

  return {
    id: queryId,
    name: `${view.title} Query`,
    datasource_id: datasourceContext.datasource_id,
    sql_template: sqlTemplate,
    params,
    output: {
      kind: "rows",
      schema: buildResultSchema(dimensionField, metricFields, table),
    },
  };
}

function buildQueryIdForView(viewId: string) {
  return `q_${viewId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function selectTableForView(
  fields: string[],
  datasourceContext: DatasourceContext,
): DatasourceTable {
  const tables = datasourceContext.tables.filter((table) =>
    table.fields.some((field) => fields.includes(field.name)),
  );

  const exactMatch = tables.find((table) =>
    fields.every((field) => table.fields.some((candidate) => candidate.name === field)),
  );
  if (exactMatch) {
    return exactMatch;
  }

  const bestScore = [...tables].sort((left, right) => {
    const leftScore = countMatchingFields(left, fields);
    const rightScore = countMatchingFields(right, fields);
    return rightScore - leftScore;
  })[0];

  if (bestScore) {
    return bestScore;
  }

  return datasourceContext.tables[0];
}

function countMatchingFields(table: DatasourceTable, fields: string[]) {
  return fields.filter((field) =>
    table.fields.some((candidate) => candidate.name === field),
  ).length;
}

function hasField(table: DatasourceTable, fieldName: string) {
  return table.fields.some((field) => field.name === fieldName);
}

function selectDimensionField(
  fields: string[],
  table: DatasourceTable,
  timeField?: string,
) {
  if (timeField && fields.includes(timeField)) {
    return timeField;
  }

  return fields.find((field) => {
    const datasourceField = table.fields.find((candidate) => candidate.name === field);
    return datasourceField?.semantic_type === "dimension";
  });
}

function selectMetricFields(fields: string[], table: DatasourceTable) {
  const metrics = fields.filter((field) => {
    const datasourceField = table.fields.find((candidate) => candidate.name === field);
    return datasourceField?.semantic_type === "metric";
  });

  if (metrics.length > 0) {
    return metrics;
  }

  const fallback = table.fields.find((field) => field.semantic_type === "metric");
  return fallback ? [fallback.name] : [];
}

function buildQueryParamsForTable(table: DatasourceTable): QueryParamDef[] {
  const params: QueryParamDef[] = [];

  if (hasField(table, "week_start")) {
    params.push(
      { name: "start_date", type: "date", required: true, cardinality: "scalar" },
      { name: "end_date", type: "date", required: true, cardinality: "scalar" },
    );
  }

  if (hasField(table, "region")) {
    params.push({
      name: "region",
      type: "string",
      required: true,
      cardinality: "scalar",
      default_value: "all",
    });
  }

  return params;
}

function buildSelectFields(
  dimensionField: string | undefined,
  metricFields: string[],
) {
  const fields: string[] = [];
  if (dimensionField) {
    fields.push(dimensionField);
  }
  metricFields.forEach((metric) => {
    fields.push(`${metric === "conversion_rate" ? "avg" : "sum"}(${metric}) as ${metric}`);
  });

  if (fields.length === 0) {
    fields.push("count(*) as value");
  }

  return fields;
}

function buildWhereClause(
  table: DatasourceTable,
  timeField?: string,
) {
  const clauses: string[] = [];
  if (timeField) {
    clauses.push(`${timeField} >= {{start_date}}`, `${timeField} < {{end_date}}`);
  }
  if (hasField(table, "region")) {
    clauses.push("({{region}} = 'all' or region = {{region}})");
  }
  return clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "";
}

function buildOrderClause(
  dimensionField: string | undefined,
  metricFields: string[],
) {
  if (!dimensionField) {
    return "";
  }

  if (dimensionField === "week_start") {
    return " order by week_start asc";
  }

  if (metricFields[0]) {
    return ` order by ${metricFields[0]} desc`;
  }

  return ` order by ${dimensionField} asc`;
}

function buildResultSchema(
  dimensionField: string | undefined,
  metricFields: string[],
  table: DatasourceTable,
): ResultSchemaField[] {
  const result: ResultSchemaField[] = [];

  if (dimensionField) {
    result.push({
      name: dimensionField,
      type: getFieldType(table, dimensionField),
      nullable: false,
    });
  }

  metricFields.forEach((metric) => {
    result.push({
      name: metric,
      type: getFieldType(table, metric),
      nullable: false,
    });
  });

  if (result.length === 0) {
    result.push({
      name: "value",
      type: "number",
      nullable: false,
    });
  }

  return result;
}

function getFieldType(table: DatasourceTable, fieldName: string): QueryParamType {
  const field = table.fields.find((candidate) => candidate.name === fieldName);
  return (field?.type as QueryParamType | undefined) ?? "string";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
