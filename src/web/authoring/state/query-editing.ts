import { isLiveBinding, reconcileBindingShape } from "../../../domain/dashboard/bindings";
import { collectTemplateFieldsFromView } from "../../../domain/dashboard/contract-kernel";
import {
  getQueryById,
  getViewById,
  upsertBindingInDocument,
  upsertQueryInDocument,
} from "../../../domain/dashboard/document";
import type {
  DashboardDocument,
  QueryDef,
  QueryParamDef,
  QueryParamType,
  QueryOutput,
  ResultSchemaField,
} from "../../../contracts";

export function addBlankQueryToDashboard(
  document: DashboardDocument,
  viewId: string,
): { document: DashboardDocument; queryId: string | null } {
  const view = getViewById(document, viewId);
  if (!view) {
    return { document, queryId: null };
  }

  const seed = document.query_defs.length + 1;
  const query = createBlankQuery(seed, view);
  return {
    document: upsertQueryInDocument(document, query),
    queryId: query.id,
  };
}

export function updateQueryMeta(
  document: DashboardDocument,
  queryId: string,
  field: "id" | "name" | "datasource_id" | "sql_template",
  value: string,
): { document: DashboardDocument; queryId: string } {
  const query = getQueryById(document, queryId);
  if (!query) {
    return { document, queryId };
  }

  const nextQuery = {
    ...query,
    [field]: value,
  };
  const nextDocument = upsertQueryInDocument(document, nextQuery, {
    previousQueryId: field === "id" ? query.id : undefined,
  });

  return {
    document: nextDocument,
    queryId: nextQuery.id,
  };
}

export function applyQueryShape(
  document: DashboardDocument,
  queryId: string,
  params: QueryParamDef[],
  output: QueryOutput,
): DashboardDocument {
  const query = getQueryById(document, queryId);
  if (!query) {
    return document;
  }

  const nextQuery = {
    ...query,
    params,
    output,
  };
  let nextDocument = upsertQueryInDocument(document, nextQuery);

  nextDocument.bindings.forEach((binding) => {
    if (!isLiveBinding(binding) || binding.query_id !== nextQuery.id) {
      return;
    }

    const view = getViewById(nextDocument, binding.view_id);
    if (!view) {
      return;
    }

    nextDocument = upsertBindingInDocument(
      nextDocument,
      reconcileBindingShape(binding, view, nextQuery),
    );
  });

  return nextDocument;
}

function createBlankQuery(seed: number, view: DashboardDocument["dashboard_spec"]["views"][number]): QueryDef {
  const templateFields = collectTemplateFieldsFromView(view);
  const resultSchema =
    templateFields.length > 0
      ? templateFields.map<ResultSchemaField>((field) => ({
          name: field,
          type: inferFieldType(field),
          nullable: false,
        }))
      : [{ name: "value", type: "number" as QueryParamType, nullable: false }];
  const hasTimeField = templateFields.includes("week_start");
  const primaryDimension = hasTimeField
    ? "week_start"
    : templateFields.find((field) => field === "region" || field === "channel");
  const metrics = templateFields.filter(
    (field) => field !== primaryDimension && field !== "week_start",
  );
  const tableName =
    templateFields.includes("channel") || templateFields.includes("conversion_rate")
      ? "sales_quality"
      : "sales_weekly_fact";
  const selectFields = buildBlankQuerySelectFields(primaryDimension, metrics);
  const whereClauses = buildBlankQueryWhereClauses(tableName, hasTimeField);
  const groupBy =
    primaryDimension && metrics.length > 0 ? ` group by ${primaryDimension}` : "";
  const orderBy = primaryDimension
    ? ` order by ${primaryDimension}${primaryDimension === "week_start" ? " asc" : ""}`
    : "";

  return {
    id: `q_custom_${seed}`,
    name: `${view.title} Query`,
    datasource_id: "ds_sales_weekly",
    sql_template: `select ${selectFields.join(", ")} from ${tableName}${whereClauses}${groupBy}${orderBy}`.trim(),
    params: buildBlankQueryParams(tableName, hasTimeField),
    output: {
      kind: "rows",
      schema: resultSchema,
    },
  };
}

function buildBlankQueryParams(tableName: string, hasTimeField: boolean) {
  const params = [];

  if (hasTimeField) {
    params.push(
      {
        name: "start_date",
        type: "date" as QueryParamType,
        required: true,
        cardinality: "scalar" as const,
      },
      {
        name: "end_date",
        type: "date" as QueryParamType,
        required: true,
        cardinality: "scalar" as const,
      },
    );
  }

  if (tableName === "sales_weekly_fact") {
    params.push({
      name: "region",
      type: "string" as QueryParamType,
      required: true,
      cardinality: "scalar" as const,
      default_value: "all",
    });
  }

  return params;
}

function buildBlankQuerySelectFields(primaryDimension: string | undefined, metrics: string[]) {
  const fields: string[] = [];

  if (primaryDimension) {
    fields.push(primaryDimension);
  }

  if (metrics.length === 0) {
    fields.push("count(*) as value");
    return fields;
  }

  metrics.forEach((metric) => {
    fields.push(`${metric === "conversion_rate" ? "avg" : "sum"}(${metric}) as ${metric}`);
  });

  return fields;
}

function buildBlankQueryWhereClauses(tableName: string, hasTimeField: boolean) {
  const clauses: string[] = [];

  if (hasTimeField) {
    clauses.push("week_start >= {{start_date}}", "week_start < {{end_date}}");
  }

  if (tableName === "sales_weekly_fact") {
    clauses.push("({{region}} = 'all' or region = {{region}})");
  }

  return clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "";
}

function inferFieldType(fieldName: string): QueryParamType {
  const normalized = fieldName.toLowerCase();
  if (normalized.includes("date") || normalized.includes("week")) {
    return "date";
  }

  if (
    normalized.includes("region") ||
    normalized.includes("channel") ||
    normalized.includes("label") ||
    normalized.includes("name")
  ) {
    return "string";
  }

  return "number";
}
