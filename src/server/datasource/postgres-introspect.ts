import "server-only";

import type { Pool } from "pg";

export interface IntrospectedColumn {
  name: string;
  data_type: string;
}

export interface IntrospectedTable {
  name: string;
  columns: IntrospectedColumn[];
}

export interface IntrospectedSchema {
  name: string;
  tables: IntrospectedTable[];
}

interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
}

const SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "pg_catalog",
  "pg_toast",
]);

/**
 * Introspect Postgres schemas/tables/columns for management UI (read-only).
 */
export async function introspectPostgresSchemas(pool: Pool): Promise<IntrospectedSchema[]> {
  const result = await pool.query<ColumnRow>(
    `
      select
        table_schema,
        table_name,
        column_name,
        data_type
      from information_schema.columns
      where table_schema not in ('information_schema', 'pg_catalog', 'pg_toast')
        and table_schema not like 'pg_%'
      order by table_schema asc, table_name asc, ordinal_position asc
    `,
  );

  const schemaMap = new Map<string, Map<string, IntrospectedColumn[]>>();

  for (const row of result.rows) {
    if (SYSTEM_SCHEMAS.has(row.table_schema)) {
      continue;
    }
    let tables = schemaMap.get(row.table_schema);
    if (!tables) {
      tables = new Map();
      schemaMap.set(row.table_schema, tables);
    }
    let cols = tables.get(row.table_name);
    if (!cols) {
      cols = [];
      tables.set(row.table_name, cols);
    }
    cols.push({
      name: row.column_name,
      data_type: row.data_type,
    });
  }

  const schemas: IntrospectedSchema[] = [];
  for (const [schemaName, tableMap] of [...schemaMap.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const tables: IntrospectedTable[] = [];
    for (const [tableName, columns] of [...tableMap.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      tables.push({ name: tableName, columns });
    }
    schemas.push({ name: schemaName, tables });
  }

  return schemas;
}
