import "server-only";

import type { JsonValue, QueryDef } from "../../contracts";
import { getRowsOutputSchema } from "../../domain/dashboard/contract-kernel";
import type { BindingRow } from "../../contracts";

export function compilePostgresSqlTemplate(
  sqlTemplate: string,
  params: Record<string, JsonValue>,
): { text: string; values: JsonValue[] } {
  const values: JsonValue[] = [];
  const text = sqlTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, paramName) => {
    if (!(paramName in params)) {
      throw new Error(`Missing SQL param: ${paramName}`);
    }
    values.push(params[paramName]);
    return `$${values.length}`;
  });

  return { text, values };
}

/**
 * Athena / Presto-style: embed literals (params must be JSON primitives only).
 */
export function compileAthenaSqlTemplate(
  sqlTemplate: string,
  params: Record<string, JsonValue>,
): string {
  return sqlTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, paramName) => {
    if (!(paramName in params)) {
      throw new Error(`Missing SQL param: ${paramName}`);
    }
    return formatAthenaLiteral(params[paramName]);
  });
}

function formatAthenaLiteral(value: JsonValue): string {
  if (value === null) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid numeric param for SQL literal.");
    }
    return String(value);
  }
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  throw new Error("Unsupported param type for Athena literal binding.");
}

export function assertReadOnlySql(text: string) {
  const normalized = text.trim().toLowerCase();

  if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
    throw new Error("Only SELECT or WITH queries are allowed.");
  }

  if (normalized.includes(";")) {
    throw new Error("Multiple SQL statements are not allowed.");
  }

  if (
    /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do)\b/i.test(
      normalized,
    )
  ) {
    throw new Error("Only read-only SQL is allowed.");
  }
}

export function normalizeQueryRowForBinding(
  row: Record<string, unknown>,
  query: QueryDef,
): BindingRow {
  const normalized: BindingRow = {};
  const schemaByField = new Map(
    getRowsOutputSchema(query).map((field) => [field.name, field]),
  );

  Object.entries(row).forEach(([key, value]) => {
    normalized[key] = normalizeFieldValue(value, schemaByField.get(key)?.type);
  });

  return normalized;
}

function normalizeFieldValue(
  value: unknown,
  expectedType?: ReturnType<typeof getRowsOutputSchema>[number]["type"],
): BindingRow[string] {
  if (value === null) {
    return null;
  }

  if (expectedType === "number") {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = Number(value);
      return Number.isFinite(normalized) ? normalized : value;
    }
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}
