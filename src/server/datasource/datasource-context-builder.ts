import "server-only";

import type { DatasourceContext, DatasourceField, DatasourceMetric } from "../../contracts";
import type { IntrospectedSchema } from "./postgres-introspect";

function inferSemanticType(
  columnName: string,
  dataType: string,
): "time" | "dimension" | "metric" | undefined {
  const lower = columnName.toLowerCase();
  const dt = dataType.toLowerCase();

  if (
    lower.includes("date") ||
    lower.includes("time") ||
    dt.includes("timestamp") ||
    dt === "date"
  ) {
    return "time";
  }

  if (
    dt.includes("int") ||
    dt.includes("decimal") ||
    dt.includes("double") ||
    dt.includes("float") ||
    dt === "bigint" ||
    dt === "smallint"
  ) {
    return "metric";
  }

  if (
    lower === "id" ||
    lower.endsWith("_id") ||
    lower.includes("name") ||
    lower.includes("region") ||
    lower.includes("category") ||
    lower.includes("status")
  ) {
    return "dimension";
  }

  return "dimension";
}

function mapLooseType(dataType: string): string {
  const dt = dataType.toLowerCase();
  if (dt.includes("timestamp") || dt === "date") {
    return dt.includes("date") && !dt.includes("time") ? "date" : "datetime";
  }
  if (
    dt.includes("int") ||
    dt.includes("decimal") ||
    dt.includes("double") ||
    dt.includes("float") ||
    dt === "bigint"
  ) {
    return "number";
  }
  if (dt === "boolean" || dt === "bool") {
    return "boolean";
  }
  return "string";
}

function buildMetricsFromFields(fields: DatasourceField[]): DatasourceMetric[] {
  const metrics: DatasourceMetric[] = [];
  for (const field of fields) {
    if (field.semantic_type !== "metric") {
      continue;
    }
    metrics.push({
      id: field.name,
      label: field.name,
      description: field.description,
      default_aggregation: field.name.toLowerCase().includes("rate") ? "avg" : "sum",
    });
  }
  return metrics;
}

/**
 * Build agent-facing datasource context from introspection (custom DBs).
 * Uses qualified field names `schema.table.column` to keep names unique.
 */
export function buildDatasourceContextFromIntrospection(
  datasourceId: string,
  dialect: "postgres" | "athena",
  schemas: IntrospectedSchema[],
): DatasourceContext {
  const tables: DatasourceContext["tables"] = [];
  const allowedTables: string[] = [];
  const allowedFields: string[] = [];

  for (const schema of schemas) {
    for (const table of schema.tables) {
      const tableKey = `${schema.name}.${table.name}`;
      allowedTables.push(tableKey);

      const fields: DatasourceField[] = table.columns.map((col) => {
        const fieldName = `${schema.name}.${table.name}.${col.name}`;
        const semantic = inferSemanticType(col.name, col.data_type);
        const field: DatasourceField = {
          name: fieldName,
          type: mapLooseType(col.data_type),
          database_type: col.data_type,
          nullable: col.nullable ?? true,
          semantic_type: semantic,
          filterable: semantic === "time" || semantic === "dimension",
          aggregations:
            semantic === "metric"
              ? col.name.toLowerCase().includes("rate")
                ? ["avg"]
                : ["sum", "avg"]
              : undefined,
          description: col.comment ?? `${table.name}.${col.name}`,
          ...(col.comment ? { comment: col.comment } : {}),
          ...(col.primary_key !== undefined ? { primary_key: col.primary_key } : {}),
          ...(col.indexed !== undefined ? { indexed: col.indexed } : {}),
        };
        allowedFields.push(fieldName);
        return field;
      });

      tables.push({
        name: tableKey,
        description: table.comment ?? `Table ${table.name} in ${schema.name}`,
        fields,
      });
    }
  }

  const metrics = buildMetricsFromFields(tables.flatMap((t) => t.fields));

  return {
    datasource_id: datasourceId,
    dialect,
    tables,
    metrics,
    visibility_scope: {
      allowed_tables: allowedTables,
      allowed_fields: allowedFields,
    },
  };
}
