import type {
  DashboardView,
  QueryDef,
  QueryParamType,
  ResultSchemaField,
} from "../../contracts";
import { collectTemplateFields } from "../../contracts/validation";

export function createBlankQuery(seed: number, view: DashboardView): QueryDef {
  const templateFields = collectTemplateFields(view.option_template);
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
    result_schema: resultSchema,
  };
}

function buildBlankQueryParams(
  tableName: string,
  hasTimeField: boolean,
) {
  const params = [];

  if (hasTimeField) {
    params.push(
      { name: "start_date", type: "date" as QueryParamType, required: true, cardinality: "scalar" as const },
      { name: "end_date", type: "date" as QueryParamType, required: true, cardinality: "scalar" as const },
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

function buildBlankQuerySelectFields(
  primaryDimension: string | undefined,
  metrics: string[],
) {
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

function buildBlankQueryWhereClauses(
  tableName: string,
  hasTimeField: boolean,
) {
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
