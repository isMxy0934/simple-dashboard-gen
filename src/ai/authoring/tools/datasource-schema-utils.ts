import type {
  DatasourceContext,
  DatasourceField,
  DatasourceTable,
  QueryParamType,
} from "@/contracts";
import type {
  DatasourceTableSummary,
  GetTableSchemaToolOutput,
  TableSchemaFieldSummary,
} from "@/ai/authoring/contracts/tool-io";

export function shortName(name: string): string {
  return name.split(".").filter(Boolean).at(-1) ?? name;
}

export function findDatasourceTable(
  schema: DatasourceContext,
  tableName: string,
): DatasourceTable | null {
  const normalized = tableName.trim().toLowerCase();
  return schema.tables.find((table) => {
    const full = table.name.toLowerCase();
    return full === normalized || shortName(full) === normalized;
  }) ?? null;
}

export function findDatasourceField(
  table: DatasourceTable,
  fieldName: string,
): DatasourceField | null {
  const normalized = fieldName.trim().toLowerCase();
  return table.fields.find((field) => {
    const full = field.name.toLowerCase();
    return full === normalized || shortName(full) === normalized;
  }) ?? null;
}

export function listTableSummaries(
  schema: DatasourceContext,
): DatasourceTableSummary[] {
  return schema.tables.map((table) => ({
    name: table.name,
    ...(table.description ? { description: table.description } : {}),
    field_count: table.fields.length,
  }));
}

export function standardQueryType(field: DatasourceField): QueryParamType {
  if (field.type === "date" || field.type === "datetime") {
    return field.type;
  }
  if (field.type === "number" || field.type === "boolean" || field.type === "string") {
    return field.type;
  }
  return "string";
}

export function summarizeTableField(
  field: DatasourceField,
): TableSchemaFieldSummary {
  return {
    name: shortName(field.name),
    qualified_name: field.name,
    standard_type: field.type,
    ...(field.database_type ? { database_type: field.database_type } : {}),
    nullable: field.nullable ?? true,
    ...(field.semantic_type ? { semantic_type: field.semantic_type } : {}),
    ...(field.filterable !== undefined ? { filterable: field.filterable } : {}),
    ...(field.aggregations ? { available_aggregations: field.aggregations } : {}),
    ...(field.description ? { description: field.description } : {}),
    ...(field.comment ? { comment: field.comment } : {}),
    ...(field.primary_key !== undefined ? { primary_key: field.primary_key } : {}),
    ...(field.indexed !== undefined ? { indexed: field.indexed } : {}),
  };
}

export function buildTableSchemaOutput(input: {
  schema: DatasourceContext;
  table: DatasourceTable;
}): GetTableSchemaToolOutput {
  return {
    datasource_id: input.schema.datasource_id,
    dialect: input.schema.dialect,
    table: {
      name: input.table.name,
      ...(input.table.description ? { description: input.table.description } : {}),
    },
    field_count: input.table.fields.length,
    fields: input.table.fields.map(summarizeTableField),
  };
}

export function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteQualifiedSqlName(name: string): string {
  return name
    .split(".")
    .filter(Boolean)
    .map(quoteSqlIdentifier)
    .join(".");
}

export function buildMissingTableMessage(
  schema: DatasourceContext,
  tableName: string,
): string {
  return `Table "${tableName}" was not found. Available tables: ${schema.tables.map((table) => table.name).join(", ") || "none"}.`;
}

export function buildMissingFieldMessage(
  table: DatasourceTable,
  fieldName: string,
): string {
  return `Field "${fieldName}" was not found in table "${table.name}". Available fields: ${table.fields.map((field) => shortName(field.name)).join(", ") || "none"}.`;
}
